import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { InMemorySigner } from "@taquito/signer";

import { objktClient } from "@/lib/objkt";
import { bytesToSign, computeParamHash, issueNonce, type NonceEnvelope } from "@/lib/battle/auth";
import { getSql } from "@/lib/battle/store";
import { POST } from "./route";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/21'/0'";

type ObjktClientStub = { request: (document: string, variables?: Record<string, unknown>) => Promise<unknown> };

function withObjktStub(stub: ObjktClientStub["request"], fn: () => Promise<void>): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

async function testSigner() {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: MNEMONIC, derivationPath: DERIVATION_PATH });
  return { signer, publicKey: await signer.publicKey(), address: await signer.publicKeyHash() };
}

async function buildSignedBody(
  signer: Awaited<ReturnType<typeof testSigner>>["signer"],
  publicKey: string,
  address: string,
  action: string,
  params: ReadonlyArray<string | number | boolean>,
): Promise<{ envelope: NonceEnvelope; publicKey: string; signature: string; claimedAddress: string }> {
  const envelope = issueNonce();
  const bytes = bytesToSign(envelope, action, params);
  const { prefixSig } = await signer.sign(bytes);
  return { envelope, publicKey, signature: prefixSig, claimedAddress: address };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/battle/refresh", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function cleanupWallet(wallet: string) {
  const sql = getSql();
  await sql`DELETE FROM holdings_syncs WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${wallet}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallets WHERE address = ${wallet}`;
  // Every test in this file shares one wallet (fixed derivation path) -- reset
  // its rate-limit bucket too, so a fast rerun of this file never accumulates
  // toward the route's per-wallet budget across runs.
  await sql`DELETE FROM rate_limits WHERE bucket_key = ${`refresh:${wallet}`}`;
}

function tokenHolderRow(contract: string, tokenId: number, supply = 5) {
  return { quantity: 1, token: { fa_contract: contract, token_id: String(tokenId), supply, description: "" } };
}

test("POST /api/battle/refresh: materializes current holdings without touching opted_in", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    await withObjktStub(
      async () => ({ token_holder: [tokenHolderRow("KT1Refresh", 1), tokenHolderRow("KT1Refresh", 2, 50)] }),
      async () => {
        const response = await POST(postRequest(body));
        const json = await response.json();
        assert.equal(response.status, 200, JSON.stringify(json));
        assert.deepEqual(json, { refreshed: true });
      },
    );

    const [walletRow] = await sql<{ opted_in: boolean }>`SELECT opted_in FROM wallets WHERE address = ${address}`;
    assert.equal(walletRow.opted_in, true, "refresh must never flip opted_in itself");

    const holdings = await sql<{ card_key: string }>`SELECT card_key FROM wallet_holdings WHERE wallet = ${address} ORDER BY card_key`;
    assert.deepEqual(holdings.map((r) => r.card_key), ["KT1Refresh:1", "KT1Refresh:2"]);
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: missing signature fields are rejected before any upstream work", async () => {
  const response = await POST(postRequest({}));
  assert.equal(response.status, 400);
});

test("POST /api/battle/refresh: a signature made for a different action fails verification", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    // Signed for "opt-in", submitted against the refresh route.
    const body = await buildSignedBody(signer, publicKey, address, "opt-in", []);
    const response = await POST(postRequest(body));
    assert.equal(response.status, 401);
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: a concurrent holdings_generation change invalidates the snapshot before settlement", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    await withObjktStub(
      async () => {
        // A competing sync (or opt-out) bumps the generation mid-flight, after
        // this request already captured its own snapshot's starting generation.
        await sql`UPDATE wallets SET holdings_generation = holdings_generation + 1 WHERE address = ${address}`;
        return { token_holder: [tokenHolderRow("KT1Race", 1)] };
      },
      async () => {
        const response = await POST(postRequest(body));
        const json = await response.json();
        assert.equal(response.status, 409, JSON.stringify(json));
        assert.equal(json.error, "stale_holdings_generation");
      },
    );

    assert.equal((await sql`SELECT * FROM wallet_holdings WHERE wallet = ${address}`).length, 0, "a stale promotion must not write any holdings");
    const [attempt] = await sql<{ retryable: boolean | null }>`SELECT retryable FROM battle_attempts WHERE nonce = ${body.envelope.mac}`;
    assert.equal(attempt.retryable, true, "a lost generation race is operational timing, not a business rule the caller broke");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: a collection larger than one page bounds work per request and resumes on resubmission", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    const PAGE_SIZE = 100;
    const TOTAL_CARDS = 4 * PAGE_SIZE + 50; // 5 pages: 4 full + 1 partial, exceeding MAX_PAGES_PER_INVOCATION (4)

    const stub = async (_doc: string, variables?: Record<string, unknown>) => {
      const offset = Number(variables?.offset ?? 0);
      const remaining = Math.max(0, TOTAL_CARDS - offset);
      const count = Math.min(PAGE_SIZE, remaining);
      return {
        token_holder: Array.from({ length: count }, (_, i) => tokenHolderRow("KT1Big", offset + i)),
      };
    };

    await withObjktStub(stub, async () => {
      const first = await POST(postRequest(body));
      assert.equal(first.status, 202, "4 full pages must exhaust the per-invocation page budget before completing");
      const firstJson = await first.json();
      assert.deepEqual(firstJson, { status: "in_progress" });

      // The client resubmits the identical signed body -- authenticateAndClaim
      // reclaims the same attempt by nonce and resumes from its stored cursor.
      const second = await POST(postRequest(body));
      const secondJson = await second.json();
      assert.equal(second.status, 200, JSON.stringify(secondJson));
      assert.deepEqual(secondJson, { refreshed: true });
    });

    const holdings = await sql`SELECT card_key FROM wallet_holdings WHERE wallet = ${address}`;
    assert.equal(holdings.length, TOTAL_CARDS, "resuming must complete the full traversal, not just the first invocation's pages");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: malformed JSON body is rejected before any upstream work", async () => {
  const response = await POST(
    new NextRequest("http://localhost/api/battle/refresh", {
      method: "POST",
      body: "{not valid json",
      headers: { "Content-Type": "application/json" },
    }),
  );
  assert.equal(response.status, 400);
  const json = await response.json();
  assert.equal(json.error, "invalid_json_body");
});

test("POST /api/battle/refresh: a genuinely live attempt is reported as in-progress, not reclaimed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    // Simulate another worker already holding this exact attempt with a
    // still-live lease -- authenticateAndClaim must not reclaim it.
    await sql`
      INSERT INTO battle_attempts (nonce, wallet, action, param_hash, issued_at, retry_until, status, generation, lease_expires_at)
      VALUES (${body.envelope.mac}, ${address}, 'refresh', ${computeParamHash([])}, now(), now() + interval '15 minutes', 'pending', 0, now() + interval '1 minute')
    `;

    const response = await POST(postRequest(body));
    assert.equal(response.status, 409);
    const json = await response.json();
    assert.deepEqual(json, { error: "attempt_in_progress", retryable: true });
    assert.equal(response.headers.get("Retry-After"), "2");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: a completed attempt replays its exact stored response, no upstream work repeated", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    await sql`
      INSERT INTO battle_attempts (nonce, wallet, action, param_hash, issued_at, retry_until, status, generation, response, status_code, completed_at)
      VALUES (${body.envelope.mac}, ${address}, 'refresh', ${computeParamHash([])}, now(), now() + interval '15 minutes', 'completed', 0, ${JSON.stringify({ refreshed: true })}::jsonb, 200, now())
    `;

    let objktCalled = false;
    await withObjktStub(
      async () => {
        objktCalled = true;
        return { token_holder: [] };
      },
      async () => {
        const response = await POST(postRequest(body));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { refreshed: true });
      },
    );
    assert.equal(objktCalled, false, "a terminal replay must never repeat the upstream holdings fetch");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: an upstream holdings fetch failure is a retryable 503, not silently swallowed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    await withObjktStub(
      async () => {
        throw new Error("OBJKT unavailable");
      },
      async () => {
        const response = await POST(postRequest(body));
        const json = await response.json();
        assert.equal(response.status, 503, JSON.stringify(json));
        assert.equal(json.error, "holdings_unavailable");
        assert.equal(json.retryable, true);
      },
    );
    const [attempt] = await sql<{ retryable: boolean | null }>`SELECT retryable FROM battle_attempts WHERE nonce = ${body.envelope.mac}`;
    assert.equal(attempt.retryable, true, "an upstream outage is operational timing, not a business rule the caller broke");
  } finally {
    console.error = originalConsoleError;
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: a takeover mid-request is reported as sync_superseded, not silently retried forever", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
    await withObjktStub(
      async () => {
        // A takeover reclaims this exact attempt (mirrors reclaimAttempt)
        // between this request's claim and its own staging write.
        await sql`UPDATE battle_attempts SET generation = generation + 1, lease_expires_at = now() + interval '1 minute' WHERE nonce = ${body.envelope.mac}`;
        return { token_holder: [tokenHolderRow("KT1Superseded", 1)] };
      },
      async () => {
        const response = await POST(postRequest(body));
        const json = await response.json();
        assert.equal(response.status, 409, JSON.stringify(json));
        assert.equal(json.error, "sync_superseded");
        assert.equal(json.retryable, true);
      },
    );
    // The route's own failAttempt call still carries the OLD generation it
    // started with, so its generation-scoped WHERE clause is a no-op here --
    // exactly the point: a stale (superseded) caller reporting failure must
    // never overwrite the newer generation's state.
    const [attempt] = await sql<{ status: string; generation: string }>`SELECT status, generation FROM battle_attempts WHERE nonce = ${body.envelope.mac}`;
    assert.equal(attempt.generation, "1", "the newer generation this request was superseded by must be untouched");
    assert.equal(attempt.status, "pending", "a stale caller's failure report must never overwrite the newer generation's state");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/refresh: a wallet past its request budget is rate-limited before any attempt row is claimed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    await withObjktStub(
      async () => ({ token_holder: [] }), // cheapest deterministic within-budget response: an empty (single-page, complete) refresh
      async () => {
        // route.ts's RATE_LIMIT_MAX_REQUESTS is 20 -- confirms the limiter
        // is actually wired into this route (after auth, before upstream
        // work), not just that the underlying primitive works in isolation.
        for (let i = 0; i < 20; i += 1) {
          const body = await buildSignedBody(signer, publicKey, address, "refresh", []);
          const response = await POST(postRequest(body));
          assert.notEqual(response.status, 429, `request ${i + 1} of 20 should be within budget`);
        }

        const overBudget = await buildSignedBody(signer, publicKey, address, "refresh", []);
        const response = await POST(postRequest(overBudget));
        assert.equal(response.status, 429);
        const json = await response.json();
        assert.equal(json.error, "rate_limited");

        const [attempt] = await sql<{ status: string }>`
          SELECT status FROM battle_attempts WHERE nonce = ${overBudget.envelope.mac}
        `;
        assert.equal(attempt, undefined, "an over-budget request must never claim a permanent attempt row");
      },
    );
  } finally {
    await cleanupWallet(address);
  }
});
