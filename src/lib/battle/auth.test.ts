import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySigner } from "@taquito/signer";

import { canonicalEncode, isImplicitAccountPublicKey, issueNonce, verifyEnvelope, verifySignedAction, getPublicProtocolInfo } from "./auth";
import { bytesToSign, type NonceEnvelope } from "./signPayload";
import { claimOrLookupAttempt, completeAttempt, getSql, type AttemptIdentity } from "./store";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

async function testSigner() {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: TEST_MNEMONIC });
  const publicKey = await signer.publicKey();
  const address = await signer.publicKeyHash();
  return { signer, publicKey, address };
}

async function signAction(
  signer: Awaited<ReturnType<typeof testSigner>>["signer"],
  envelope: NonceEnvelope,
  action: string,
  params: ReadonlyArray<string | number | boolean>,
) {
  const bytes = await bytesToSign(envelope, getPublicProtocolInfo(), action, params);
  const result = await signer.sign(bytes);
  return result.prefixSig;
}

test("canonicalEncode: no delimiter-collision ambiguity between adjacent variable-length fields", () => {
  const a = canonicalEncode(["12", "3456"]);
  const b = canonicalEncode(["123", "456"]);
  assert.notEqual(a, b, "JSON array encoding must not let two different field splits collide");
});

test("verifySignedAction: happy path -- valid signature, fresh nonce, matching bytes authenticates", async () => {
  const { signer, publicKey, address } = await testSigner();
  const envelope = issueNonce();
  const params = ["KT1Contract:1"];
  const signature = await signAction(signer, envelope, "random", params);

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: address,
    action: "random",
    actionParams: params,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.wallet, address);
});

test("verifySignedAction: a signature valid for one action fails when replayed against a different action", async () => {
  const { signer, publicKey, address } = await testSigner();
  const envelope = issueNonce();
  const signature = await signAction(signer, envelope, "opt-in", []);

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: address,
    action: "random",
    actionParams: ["KT1Contract:1"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "signature_invalid");
});

test("verifySignedAction: a signature valid for one set of params fails when replayed against different params", async () => {
  const { signer, publicKey, address } = await testSigner();
  const envelope = issueNonce();
  const signature = await signAction(signer, envelope, "challenge", ["KT1Contract:1", "tz1Victim"]);

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: address,
    action: "challenge",
    actionParams: ["KT1Contract:1", "tz1DifferentTarget"],
  });
  assert.equal(result.ok, false);
});

test("verifyEnvelope: a nonce past its freshness window is rejected as expired, not a MAC mismatch", () => {
  const envelope = issueNonce();
  const farFuture = envelope.timestamp + 10 * 60 * 1000; // 10 minutes later, past the 5-minute window
  const check = verifyEnvelope(envelope, farFuture);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "expired");
});

test("verifyEnvelope: a tampered MAC is rejected distinctly from expiry", () => {
  const envelope = issueNonce();
  const tampered: NonceEnvelope = { ...envelope, mac: "0".repeat(envelope.mac.length) };
  const check = verifyEnvelope(tampered);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.reason, "mac_mismatch");
});

test("verifySignedAction: an expired-but-authentic envelope still verifies signature/address, returning the wallet+nonce for replay lookup", async () => {
  const { signer, publicKey, address } = await testSigner();
  const envelope = issueNonce();
  const params = ["KT1Contract:1"];
  const signature = await signAction(signer, envelope, "random", params);
  const farFuture = envelope.timestamp + 10 * 60 * 1000; // past the 5-minute freshness window

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: address,
    action: "random",
    actionParams: params,
    now: farFuture,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "expired");
    if (result.reason === "expired") {
      assert.equal(result.wallet, address);
      assert.equal(result.nonce, envelope.mac);
    }
  }
});

test("verifySignedAction: a tampered MAC is rejected outright, even if it would otherwise also look expired", async () => {
  const envelope = issueNonce();
  const tampered: NonceEnvelope = { ...envelope, mac: "0".repeat(envelope.mac.length) };
  const result = await verifySignedAction({
    envelope: tampered,
    publicKey: "edpkIrrelevant",
    signature: "edsigIrrelevant",
    claimedAddress: "tz1Irrelevant0000000000000000000000",
    action: "random",
    actionParams: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "envelope_invalid");
});

test("verifySignedAction: signature valid but doesn't match the derived address is rejected", async () => {
  const { signer, publicKey } = await testSigner();
  const envelope = issueNonce();
  const signature = await signAction(signer, envelope, "random", []);

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: "tz1SomeoneElsesAddress00000000000000",
    action: "random",
    actionParams: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "address_mismatch");
});

test("verifySignedAction: malformed signature is rejected gracefully, not thrown", async () => {
  const { publicKey, address } = await testSigner();
  const envelope = issueNonce();

  const result = await verifySignedAction({
    envelope,
    publicKey,
    signature: "not-a-real-signature",
    claimedAddress: address,
    action: "random",
    actionParams: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "malformed");
});

test("verifySignedAction: no usable public key (abstracted account) gets a distinct rejection reason", async () => {
  const envelope = issueNonce();
  const result = await verifySignedAction({
    envelope,
    publicKey: "sig-not-an-implicit-account-key",
    signature: "edsig-irrelevant",
    claimedAddress: "KT1SomeContractWallet00000000000000",
    action: "random",
    actionParams: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unsupported_wallet_type");
});

test("isImplicitAccountPublicKey: recognizes edpk/sppk/p2pk, rejects everything else", () => {
  assert.equal(isImplicitAccountPublicKey("edpkAbc"), true);
  assert.equal(isImplicitAccountPublicKey("sppkAbc"), true);
  assert.equal(isImplicitAccountPublicKey("p2pkAbc"), true);
  assert.equal(isImplicitAccountPublicKey("nonsense"), false);
});

test("integration: a retried request short-circuits via battle_attempts without re-verifying signature or re-resolving combat", async () => {
  const { signer, publicKey, address } = await testSigner();
  const envelope = issueNonce();
  const params = ["KT1Contract:1"];
  const signature = await signAction(signer, envelope, "random", params);

  const verifyResult = await verifySignedAction({
    envelope,
    publicKey,
    signature,
    claimedAddress: address,
    action: "random",
    actionParams: params,
  });
  assert.equal(verifyResult.ok, true);
  if (!verifyResult.ok) return;

  const identity: AttemptIdentity = { wallet: address, action: "random", paramHash: "irrelevant-for-this-test" };
  const sql = getSql();
  try {
    const claimed = await claimOrLookupAttempt(verifyResult.nonce, identity, new Date(envelope.timestamp));
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await completeAttempt(verifyResult.nonce, claimed.row.generation, { outcome: "win" }, 200);

    // A second presentation of the same nonce+signature is recognized as a
    // retry via the ledger lookup, before any fresh verification would run.
    const retryLookup = await claimOrLookupAttempt(verifyResult.nonce, identity, new Date(envelope.timestamp));
    assert.equal(retryLookup.kind, "terminal");
    if (retryLookup.kind === "terminal") {
      assert.deepEqual(retryLookup.row.response, { outcome: "win" });
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE nonce = ${verifyResult.nonce}`;
  }
});
