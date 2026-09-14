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
const DERIVATION_PATH = "m/44'/1729'/20'/0'";

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
  return new NextRequest("http://localhost/api/battle/opt-in", {
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
  await sql`DELETE FROM rate_limits WHERE bucket_key = ${`optin:${wallet}`}`;
}

test("POST /api/battle/opt-in: opting in with real holdings materializes progress rows and sets opted_in", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    const body = await buildSignedBody(signer, publicKey, address, "opt-in", [true]);
    await withObjktStub(
      async () => ({
        token_holder: [
          { quantity: 1, token: { fa_contract: "KT1OptIn", token_id: "1", supply: 5, description: "one" } },
          { quantity: 1, token: { fa_contract: "KT1OptIn", token_id: "2", supply: 50, description: "two" } },
        ],
      }),
      async () => {
        const response = await POST(postRequest({ ...body, optedIn: true }));
        const json = await response.json();
        assert.equal(response.status, 200, JSON.stringify(json));
        assert.equal(json.optedIn, true);
      },
    );

    const [walletRow] = await sql<{ opted_in: boolean }>`SELECT opted_in FROM wallets WHERE address = ${address}`;
    assert.equal(walletRow.opted_in, true);

    const progress = await sql<{ card_key: string }>`SELECT card_key FROM wallet_card_progress WHERE wallet = ${address} ORDER BY card_key`;
    assert.deepEqual(progress.map((r) => r.card_key), ["KT1OptIn:1", "KT1OptIn:2"]);

    const holdings = await sql`SELECT card_key FROM wallet_holdings WHERE wallet = ${address}`;
    assert.equal(holdings.length, 2);
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/opt-in: opting out excludes the wallet from future matching while preserving progress", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${address}, true)`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source)
      VALUES (${address}, 'KT1OptOut:1', 500, 5, 50, 'test')
    `;

    const body = await buildSignedBody(signer, publicKey, address, "opt-in", [false]);
    const response = await POST(postRequest({ ...body, optedIn: false }));
    assert.equal(response.status, 200);

    const [walletRow] = await sql<{ opted_in: boolean }>`SELECT opted_in FROM wallets WHERE address = ${address}`;
    assert.equal(walletRow.opted_in, false);

    const [progressRow] = await sql<{ xp: string }>`SELECT xp FROM wallet_card_progress WHERE wallet = ${address} AND card_key = 'KT1OptOut:1'`;
    assert.equal(Number(progressRow.xp), 500, "previously-earned progress must remain unchanged");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/opt-in: flipping the signed boolean fails verification", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    // Signed for optedIn=true, but the request body claims optedIn=false.
    const body = await buildSignedBody(signer, publicKey, address, "opt-in", [true]);
    const response = await POST(postRequest({ ...body, optedIn: false }));
    assert.equal(response.status, 401);
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/opt-in: a wallet past its request budget is rate-limited before any attempt row is claimed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    // Opting out is a cheap, deterministic within-budget response that needs
    // no objkt stub or holdings sync -- the rate limit check runs before any
    // of that either way (route.ts's RATE_LIMIT_MAX_REQUESTS is 20),
    // confirming the limiter is actually wired into this route (after auth,
    // before upstream work).
    for (let i = 0; i < 20; i += 1) {
      const body = await buildSignedBody(signer, publicKey, address, "opt-in", [false]);
      const response = await POST(postRequest({ ...body, optedIn: false }));
      assert.notEqual(response.status, 429, `request ${i + 1} of 20 should be within budget`);
    }

    const overBudget = await buildSignedBody(signer, publicKey, address, "opt-in", [false]);
    const response = await POST(postRequest({ ...overBudget, optedIn: false }));
    assert.equal(response.status, 429);
    const json = await response.json();
    assert.equal(json.error, "rate_limited");

    const [attempt] = await sql<{ status: string }>`
      SELECT status FROM battle_attempts WHERE nonce = ${overBudget.envelope.mac}
    `;
    assert.equal(attempt, undefined, "an over-budget request must never claim a permanent attempt row");
  } finally {
    await cleanupWallet(address);
  }
});

test("participation: a completed opt-in replay cannot undo a later opt-out", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const enable = await buildSignedBody(signer, publicKey, address, "opt-in", [true]);
    await withObjktStub(async () => ({ token_holder: [] }), async () => {
      assert.equal((await POST(postRequest({ ...enable, optedIn: true }))).status, 200);
    });
    const disable = await buildSignedBody(signer, publicKey, address, "opt-in", [false]);
    assert.equal((await POST(postRequest({ ...disable, optedIn: false }))).status, 200);
    assert.deepEqual(await (await POST(postRequest({ ...enable, optedIn: true }))).json(), { optedIn: true });
    const [row] = await getSql()`SELECT opted_in FROM wallets WHERE address = ${address}`;
    assert.equal(row.opted_in, false);
  } finally { await cleanupWallet(address); }
});

test("participation: concurrent opt-out invalidates a snapshot before opt-in settlement", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const enable = await buildSignedBody(signer, publicKey, address, "opt-in", [true]);
    const disable = await buildSignedBody(signer, publicKey, address, "opt-in", [false]);
    await withObjktStub(async () => {
      assert.equal((await POST(postRequest({ ...disable, optedIn: false }))).status, 200);
      return { token_holder: [{ quantity: 1, token: { fa_contract: "KT1Race", token_id: "1", supply: 5, description: "" } }] };
    }, async () => {
      const response = await POST(postRequest({ ...enable, optedIn: true }));
      assert.equal(response.status, 409);
    });
    const sql = getSql();
    const [row] = await sql`SELECT opted_in FROM wallets WHERE address = ${address}`;
    assert.equal(row.opted_in, false);
    assert.equal((await sql`SELECT * FROM wallet_holdings WHERE wallet = ${address}`).length, 0);
    assert.equal((await sql`SELECT * FROM wallet_card_progress WHERE wallet = ${address}`).length, 0);
    const [attempt] = await sql`SELECT status, status_code FROM battle_attempts WHERE nonce = ${enable.envelope.mac}`;
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.status_code, 409);
  } finally { await cleanupWallet(address); }
});

test("participation: a failure saving the response rolls back participation and promotion", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    // A CHECK constraint supplies a real failure after promotion and opted_in update.
    await sql`ALTER TABLE battle_attempts ADD CONSTRAINT review_reject_participation_completion CHECK (status != 'completed' OR action != 'opt-in')`;
    const enable = await buildSignedBody(signer, publicKey, address, "opt-in", [true]);
    await withObjktStub(async () => ({ token_holder: [{ quantity: 1, token: { fa_contract: "KT1Rollback", token_id: "1", supply: 5, description: "" } }] }), async () => {
      assert.equal((await POST(postRequest({ ...enable, optedIn: true }))).status, 500);
    });
    const [wallet] = await sql`SELECT opted_in, holdings_generation FROM wallets WHERE address = ${address}`;
    assert.equal(wallet.opted_in, false);
    assert.equal(wallet.holdings_generation, 0);
    assert.equal((await sql`SELECT * FROM wallet_holdings WHERE wallet = ${address}`).length, 0);
    assert.equal((await sql`SELECT * FROM wallet_card_progress WHERE wallet = ${address}`).length, 0);
    const [attempt] = await sql`SELECT status FROM battle_attempts WHERE nonce = ${enable.envelope.mac}`;
    assert.equal(attempt.status, "pending");
  } finally {
    await sql`ALTER TABLE battle_attempts DROP CONSTRAINT IF EXISTS review_reject_participation_completion`;
    await cleanupWallet(address);
  }
});
