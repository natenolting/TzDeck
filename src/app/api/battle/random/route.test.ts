import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { InMemorySigner } from "@taquito/signer";

import { objktClient } from "@/lib/objkt";
import { bytesToSign, issueNonce, type NonceEnvelope } from "@/lib/battle/auth";
import { getSql } from "@/lib/battle/store";
import { POST } from "./route";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const ATTACKER_CARD_KEY = "KT1RouteAttacker00000000000000000:1";
const DEFENDER_CARD_KEY = "KT1RouteDefender00000000000000000:1";

type ObjktClientStub = { request: (document: string, variables?: Record<string, unknown>) => Promise<unknown> };

function withObjktStub(stub: ObjktClientStub["request"], fn: () => Promise<void>): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

/**
 * Always reports the queried token as held with balance 1. Shaped to satisfy
 * both ownership.ts's query (reads only `quantity`) and holdings.ts's
 * fetchBattleTokenMetadata (also reads `token.supply`/`token.description`),
 * since both hit this same stubbed client.
 */
function alwaysHeldStub(): ObjktClientStub["request"] {
  return async () => ({ token_holder: [{ quantity: 1, token: { supply: 5, description: "A test description." } }] });
}

// A fixed, well-known test mnemonic. Node's test runner may run separate
// test files concurrently against the same real Postgres instance, so this
// file uses its own derivation path -- a distinct wallet address from every
// other test file reusing this mnemonic, avoiding cross-file interference.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/10'/0'";

async function testSigner() {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: TEST_MNEMONIC, derivationPath: DERIVATION_PATH });
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
  return new NextRequest("http://localhost/api/battle/random", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function cleanupWallet(wallet: string) {
  const sql = getSql();
  await sql`DELETE FROM battle_log WHERE attacker_wallet = ${wallet} OR defender_wallet = ${wallet}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallets WHERE address = ${wallet}`;
  // Every test in this file shares one wallet (fixed derivation path) -- reset
  // its rate-limit bucket too, so a fast rerun of this file never accumulates
  // toward the route's per-wallet budget across runs.
  await sql`DELETE FROM rate_limits WHERE bucket_key = ${`random:${wallet}`}`;
}

test("POST /api/battle/random: happy path resolves a battle against an eligible opponent", async () => {
  const { signer, publicKey, address } = await testSigner();
  const defenderWallet = `tz1Defender${randomUUID().slice(0, 20)}`;
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${defenderWallet}, true)`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
      VALUES (${defenderWallet}, ${DEFENDER_CARD_KEY}, 5, 50, 'test')
    `;
    await sql`INSERT INTO wallet_holdings (wallet, card_key) VALUES (${defenderWallet}, ${DEFENDER_CARD_KEY})`;

    const body = await buildSignedBody(signer, publicKey, address, "random", [ATTACKER_CARD_KEY]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY }));
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.ok(["win", "draw"].includes(json.outcome));
    });
  } finally {
    await cleanupWallet(address);
    await cleanupWallet(defenderWallet);
  }
});

test("POST /api/battle/random: missing signature is rejected with 401, no downstream work", async () => {
  const response = await POST(
    postRequest({
      attackerCardKey: ATTACKER_CARD_KEY,
      envelope: issueNonce(),
      publicKey: "edpkGarbage",
      signature: "not-a-signature",
      claimedAddress: "tz1Whoever0000000000000000000000000",
    }),
  );
  assert.equal(response.status, 401);
});

test("POST /api/battle/random: a card not held by the attacker is rejected before matchmaking runs", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const body = await buildSignedBody(signer, publicKey, address, "random", [ATTACKER_CARD_KEY]);
    await withObjktStub(
      async () => ({ token_holder: [] }),
      async () => {
        const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY }));
        assert.equal(response.status, 409);
        const json = await response.json();
        assert.equal(json.error, "attacker_card_not_held");
      },
    );
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/random: no eligible opponent returns a clean no_match result, no allowance consumed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    // No opted-in wallets in the pool at all.
    const body = await buildSignedBody(signer, publicKey, address, "random", [ATTACKER_CARD_KEY]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY }));
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.outcome, "no_match");
    });

    const [walletRow] = await sql<{ attack_count: number } | undefined>`SELECT attack_count FROM wallets WHERE address = ${address}`;
    if (walletRow) assert.equal(walletRow.attack_count, 0, "a failed search must not consume the attack allowance");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/random: a wallet past its request budget is rate-limited, persisted as a retryable attempt failure", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await withObjktStub(alwaysHeldStub(), async () => {
      // route.ts's RATE_LIMIT_MAX_REQUESTS is 10 -- confirms the limiter is
      // actually wired into this route (after auth, before upstream work),
      // not just that the underlying primitive works in isolation.
      for (let i = 0; i < 10; i += 1) {
        const body = await buildSignedBody(signer, publicKey, address, "random", [ATTACKER_CARD_KEY]);
        const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY }));
        assert.notEqual(response.status, 429, `request ${i + 1} of 10 should be within budget`);
      }

      const overBudget = await buildSignedBody(signer, publicKey, address, "random", [ATTACKER_CARD_KEY]);
      const response = await POST(postRequest({ ...overBudget, attackerCardKey: ATTACKER_CARD_KEY }));
      assert.equal(response.status, 429);
      const json = await response.json();
      assert.equal(json.error, "rate_limited");

      const [attempt] = await sql<{ status: string; retryable: boolean | null; status_code: number | null }>`
        SELECT status, retryable, status_code FROM battle_attempts WHERE nonce = ${overBudget.envelope.mac}
      `;
      assert.equal(attempt.status, "failed");
      assert.equal(attempt.retryable, true, "a rate limit is operational timing, not a business rule the caller broke");
      assert.equal(attempt.status_code, 429);
    });
  } finally {
    await cleanupWallet(address);
  }
});
