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
