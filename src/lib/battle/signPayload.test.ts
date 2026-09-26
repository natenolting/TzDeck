import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySigner } from "@taquito/signer";
import { NextRequest } from "next/server";

import { GET as issueSession } from "@/app/api/battle/session/route";
import { verifySignedAction } from "./auth";
import { bytesToSign, computeParamHash, type NonceEnvelope, type ProtocolInfo } from "./signPayload";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const ENVELOPE: NonceEnvelope = { timestamp: 1_700_000_000_000, random: "abc123", mac: "deadbeef" };
const PROTOCOL: ProtocolInfo = { appId: "tzdeck-test", protocolVersion: 1 };
const PARAMS = ["KT1Contract:1", "tz1Target", 42, true];

// These literals were produced by the separate server and browser builders
// this module replaced, which agreed byte for byte. A change here breaks every
// signature a wallet made under the old bytes, including attempts mid-retry.
test("bytesToSign produces exactly the bytes wallets have always signed", async () => {
  assert.equal(
    await bytesToSign(ENVELOPE, PROTOCOL, "challenge", PARAMS),
    "05010000006b5b312c22747a6465636b2d74657374222c226465616462656566222c226368616c6c656e6765222c2263663935336431343139656532353962363462363634663362323338303032323035643030646630353161346634393565656338303362323764326539356362225d",
  );
});

test("computeParamHash produces exactly the hashes the attempt ledger has always stored", async () => {
  assert.equal(await computeParamHash(PARAMS), "cf953d1419ee259b64b664f3b238002205d00df051a4f495eec803b27d2e95cb");
  assert.equal(await computeParamHash([]), "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
});

test("the server verifies a signature over the bytes the browser builds from a real session", async () => {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: "test test test test test test test test test test test junk" });
  const publicKey = await signer.publicKey();
  const address = await signer.publicKeyHash();

  // WalletContext's own steps: fetch a session, build the bytes, have the wallet sign them.
  const response = await issueSession(
    new NextRequest("http://localhost/api/battle/session", { headers: { "x-forwarded-for": "203.0.113.140" } }),
  );
  const session: NonceEnvelope & ProtocolInfo = await response.json();
  const envelope: NonceEnvelope = { timestamp: session.timestamp, random: session.random, mac: session.mac };
  const bytes = await bytesToSign(envelope, { appId: session.appId, protocolVersion: session.protocolVersion }, "trainer", ["KT1Card:7", "common"]);
  const { prefixSig } = await signer.sign(bytes);

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature: prefixSig,
    claimedAddress: address,
    action: "trainer",
    actionParams: ["KT1Card:7", "common"],
  });

  assert.deepEqual(result, { ok: true, wallet: address, nonce: envelope.mac });
});
