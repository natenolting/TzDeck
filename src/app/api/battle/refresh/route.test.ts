import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { InMemorySigner } from "@taquito/signer";

import { objktClient } from "@/lib/objkt";
import { bytesToSign, issueNonce, type NonceEnvelope } from "@/lib/battle/auth";
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
