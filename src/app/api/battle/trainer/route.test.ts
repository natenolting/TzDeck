import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { InMemorySigner } from "@taquito/signer";

import { objktClient } from "@/lib/objkt";
import { issueNonce, getPublicProtocolInfo } from "@/lib/battle/auth";
import { bytesToSign, type NonceEnvelope } from "@/lib/battle/signPayload";
import { getSql } from "@/lib/battle/store";
import { TRAINER_LEVEL_UNLOCK } from "@/lib/battle/rules";
import { POST } from "./route";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const ATTACKER_CARD_KEY = "KT1TrainerRouteAttacker000000000000:1";

type ObjktClientStub = { request: (document: string, variables?: Record<string, unknown>) => Promise<unknown> };

function withObjktStub(stub: ObjktClientStub["request"], fn: () => Promise<void>): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

function alwaysHeldStub(): ObjktClientStub["request"] {
  return async () => ({ token_holder: [{ quantity: 1, token: { supply: 100, description: "A test description." } }] });
}

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/11'/0'";

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
  const bytes = await bytesToSign(envelope, getPublicProtocolInfo(), action, params);
  const { prefixSig } = await signer.sign(bytes);
  return { envelope, publicKey, signature: prefixSig, claimedAddress: address };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/battle/trainer", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function ledgerRow(wallet: string) {
  const sql = getSql();
  const [row] = await sql`
    SELECT status, retryable, status_code, response FROM battle_attempts WHERE wallet = ${wallet} AND action = 'trainer'
  `;
  return row;
}

async function cleanupWallet(wallet: string) {
  const sql = getSql();
  await sql`DELETE FROM battle_log WHERE attacker_wallet = ${wallet}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallets WHERE address = ${wallet}`;
  await sql`DELETE FROM rate_limits WHERE bucket_key = ${`trainer:${wallet}`}`;
}

test("POST /api/battle/trainer: happy path resolves a battle against the common trainer", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const body = await buildSignedBody(signer, publicKey, address, "trainer", [ATTACKER_CARD_KEY, "common"]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, trainerTier: "common" }));
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.ok(["win", "draw"].includes(json.outcome));
      assert.equal(json.trainerTier, "common");
    });
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/trainer: missing signature is rejected with 401", async () => {
  const response = await POST(
    postRequest({
      attackerCardKey: ATTACKER_CARD_KEY,
      trainerTier: "common",
      envelope: issueNonce(),
      publicKey: "edpkGarbage",
      signature: "not-a-signature",
      claimedAddress: "tz1Whoever0000000000000000000000000",
    }),
  );
  assert.equal(response.status, 401);
});

test("POST /api/battle/trainer: an invalid trainerTier is rejected with 400 before authentication runs", async () => {
  const response = await POST(
    postRequest({
      attackerCardKey: ATTACKER_CARD_KEY,
      trainerTier: "mythic",
      envelope: issueNonce(),
      publicKey: "edpkGarbage",
      signature: "not-a-signature",
      claimedAddress: "tz1Whoever0000000000000000000000000",
    }),
  );
  assert.equal(response.status, 400);
  const json = await response.json();
  assert.equal(json.error, "missing_required_fields");
});

test("POST /api/battle/trainer: a card not held by the attacker is rejected before combat runs", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const body = await buildSignedBody(signer, publicKey, address, "trainer", [ATTACKER_CARD_KEY, "common"]);
    await withObjktStub(
      async () => ({ token_holder: [] }),
      async () => {
        const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, trainerTier: "common" }));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: "attacker_card_not_held", retryable: false });
        assert.deepEqual(await ledgerRow(address), {
          status: "failed",
          retryable: false,
          status_code: 409,
          response: { error: "attacker_card_not_held", retryable: false },
        });
      },
    );
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/trainer: an ownership check nobody can answer is retryable, on the wire and in the ledger", async () => {
  const { signer, publicKey, address } = await testSigner();
  const originalFetch = globalThis.fetch;
  try {
    const body = await buildSignedBody(signer, publicKey, address, "trainer", [ATTACKER_CARD_KEY, "common"]);
    // Only TzKT goes down: the Neon driver talks to the database over fetch too.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).includes("api.tzkt.io")) throw new Error("TzKT unreachable");
      return originalFetch(input, init);
    }) as typeof fetch;
    await withObjktStub(
      async () => {
        throw new Error("OBJKT unreachable");
      },
      async () => {
        const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, trainerTier: "common" }));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "ownership_unverifiable", retryable: true });
        assert.deepEqual(await ledgerRow(address), {
          status: "failed",
          retryable: true,
          status_code: 503,
          response: { error: "ownership_unverifiable", retryable: true },
        });
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupWallet(address);
  }
});

test("POST /api/battle/trainer: a locked tier is rejected before combat runs, on a never-battled (level 1) card", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    assert.ok(TRAINER_LEVEL_UNLOCK.legendary > 1, "sanity: legendary must be locked for a level-1 card");
    const body = await buildSignedBody(signer, publicKey, address, "trainer", [ATTACKER_CARD_KEY, "legendary"]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, trainerTier: "legendary" }));
      assert.equal(response.status, 409);
      const json = await response.json();
      assert.equal(json.error, "trainer_tier_locked");
    });
  } finally {
    await cleanupWallet(address);
  }
});
