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

const ATTACKER_CARD_KEY = "KT1ChallengeAttacker0000000000000:1";
const DEFENDER_CARD_KEY = "KT1ChallengeDefender0000000000000:1";
// Distinct derivation path from other test files reusing this same mnemonic
// (Node's test runner may run separate test files concurrently against the
// same real Postgres instance).
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/11'/0'";

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
  return async () => ({ token_holder: [{ quantity: 1, token: { supply: 5, description: "A test description." } }] });
}

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
  return new NextRequest("http://localhost/api/battle/challenge", {
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
}

test("POST /api/battle/challenge: happy path resolves a battle against the named, opted-in wallet", async () => {
  const { signer, publicKey, address } = await testSigner();
  const defenderWallet = `tz1ChallengeDefender${randomUUID().slice(0, 12)}`;
  const sql = getSql();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${defenderWallet}, true)`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
      VALUES (${defenderWallet}, ${DEFENDER_CARD_KEY}, 5, 50, 'test')
    `;
    await sql`INSERT INTO wallet_holdings (wallet, card_key) VALUES (${defenderWallet}, ${DEFENDER_CARD_KEY})`;

    const body = await buildSignedBody(signer, publicKey, address, "challenge", [ATTACKER_CARD_KEY, defenderWallet]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, defenderWallet }));
      const json = await response.json();
      assert.equal(response.status, 200, JSON.stringify(json));
      assert.ok(["win", "draw"].includes(json.outcome));
    });
  } finally {
    await cleanupWallet(address);
    await cleanupWallet(defenderWallet);
  }
});

test("POST /api/battle/challenge: a self-challenge is rejected", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    const body = await buildSignedBody(signer, publicKey, address, "challenge", [ATTACKER_CARD_KEY, address]);
    const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, defenderWallet: address }));
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(json.error, "self_challenge");
  } finally {
    await cleanupWallet(address);
  }
});

test("POST /api/battle/challenge: a target that hasn't opted in is rejected with a clear reason, no re-roll", async () => {
  const { signer, publicKey, address } = await testSigner();
  const notOptedInWallet = `tz1NotOptedIn${randomUUID().slice(0, 15)}`;
  try {
    const body = await buildSignedBody(signer, publicKey, address, "challenge", [ATTACKER_CARD_KEY, notOptedInWallet]);
    await withObjktStub(alwaysHeldStub(), async () => {
      const response = await POST(postRequest({ ...body, attackerCardKey: ATTACKER_CARD_KEY, defenderWallet: notOptedInWallet }));
      assert.equal(response.status, 409);
      const json = await response.json();
      assert.equal(json.error, "target_not_eligible");
    });
  } finally {
    await cleanupWallet(address);
  }
});
