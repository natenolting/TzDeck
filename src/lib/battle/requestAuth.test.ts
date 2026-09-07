import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySigner } from "@taquito/signer";

import { bytesToSign, computeParamHash, issueNonce } from "./auth";
import { authenticateAndClaim } from "./requestAuth";
import { getSql } from "./store";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/12'/0'";

async function testSigner() {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: MNEMONIC, derivationPath: DERIVATION_PATH });
  return { signer, publicKey: await signer.publicKey(), address: await signer.publicKeyHash() };
}

test("authenticateAndClaim: a released (expired) lease is reclaimed on the next request rather than reported as permanently in-progress", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["some-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;

    // Simulate a worker releasing (or losing) its lease for bounded continuation.
    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${first.nonce}`;

    const second = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(second.outcome, "claimed", "an expired lease should be reclaimed, not reported as forever in-progress");
    if (second.outcome === "claimed") {
      assert.equal(second.generation, "1", "reclaiming should advance the generation");
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: a genuinely live lease is reported as in-progress, not reclaimed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["some-other-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(first.outcome, "claimed");

    const second = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(second.outcome, "in_progress");
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});
