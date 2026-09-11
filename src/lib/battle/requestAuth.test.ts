import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySigner } from "@taquito/signer";

import { bytesToSign, computeParamHash, issueNonce } from "./auth";
import { authenticateAndClaim } from "./requestAuth";
import { failAttempt, getSql } from "./store";

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

test("authenticateAndClaim: an expired envelope still retrieves an already-completed result", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["expired-replay-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;
    await sql`
      UPDATE battle_attempts SET status = 'completed', response = ${JSON.stringify({ optedIn: true })}::jsonb, status_code = 200
      WHERE nonce = ${first.nonce} AND generation = ${first.generation}::bigint
    `;

    // Resubmitting the SAME envelope well past its 5-minute freshness window
    // -- retry_until (15 minutes) is meant to outlive that window precisely
    // so a slow client can still retrieve the result.
    const farFuture = envelope.timestamp + 10 * 60 * 1000;
    const replay = await authenticateAndClaim(body, "opt-in", params, { now: farFuture });
    assert.equal(replay.outcome, "terminal", "an expired envelope must still resolve to the terminal result, not a fresh rejection");
    if (replay.outcome === "terminal") {
      assert.deepEqual(replay.row.response, { optedIn: true });
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: a still-pending attempt with an expired lease is reclaimed after its envelope's freshness window closes", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["expired-pending-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(first.outcome, "claimed"); // still pending -- never completed or failed
    if (first.outcome !== "claimed") return;

    // Simulate the lease (60s) having actually expired in real time, as a
    // crashed or slow worker would leave it.
    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${first.nonce}`;

    // Well past the 5-minute envelope freshness window too, but still
    // within the 15-minute retry horizon, so the same signature can
    // continue it.
    const farFuture = envelope.timestamp + 10 * 60 * 1000;
    const resumed = await authenticateAndClaim(body, "opt-in", params, { now: farFuture });
    assert.equal(resumed.outcome, "claimed", "envelope freshness gates creating a NEW attempt, not continuing an existing one within its retry horizon");
    if (resumed.outcome === "claimed") {
      assert.equal(resumed.generation, "1", "reclaiming should advance the generation");
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: a retryable failure is reclaimed after its envelope's freshness window closes, within the retry horizon", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["expired-retryable-param"];
  const bytes = bytesToSign(envelope, "random", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "random", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;
    await failAttempt(first.nonce, first.generation, { error: "ownership_unverifiable" }, 503, true);

    const farFuture = envelope.timestamp + 10 * 60 * 1000;
    const resumed = await authenticateAndClaim(body, "random", params, { now: farFuture });
    assert.equal(resumed.outcome, "claimed", "a retryable failure must still be reclaimable past envelope freshness, within its retry horizon");
    if (resumed.outcome === "claimed") {
      assert.equal(resumed.generation, "1");
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: an expired envelope is rejected once the attempt's own retry horizon has also closed", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["expired-past-retry-deadline-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "opt-in", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;

    // retry_until is set from the real clock at claim time (15 minutes
    // out), independent of the `now` test seam below -- simulate it having
    // actually closed, alongside a long-expired lease.
    await sql`
      UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second', retry_until = now() - interval '1 second'
      WHERE nonce = ${first.nonce}
    `;

    // Past the 5-minute envelope freshness window too.
    const farFuture = envelope.timestamp + 10 * 60 * 1000;
    const rejected = await authenticateAndClaim(body, "opt-in", params, { now: farFuture });
    assert.equal(rejected.outcome, "rejected", "there is nothing left to continue once the retry horizon itself has closed");
    if (rejected.outcome === "rejected") assert.equal(rejected.reason, "nonce_expired");
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: an expired envelope for a nonce with no existing attempt cannot create one", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["expired-absent-nonce-param"];
  const bytes = bytesToSign(envelope, "opt-in", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    // Never claimed fresh -- the very first request for this nonce arrives
    // after its freshness window has already closed.
    const farFuture = envelope.timestamp + 10 * 60 * 1000;
    const result = await authenticateAndClaim(body, "opt-in", params, { now: farFuture });
    assert.equal(result.outcome, "rejected");
    if (result.outcome === "rejected") assert.equal(result.reason, "nonce_expired");

    const rows = await sql`SELECT nonce FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
    assert.equal(rows.length, 0, "an expired envelope must never create a new attempt row");
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: a retryable failure (transient upstream error) is reclaimed on resubmission, not reported as permanently terminal", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["retryable-failure-param"];
  const bytes = bytesToSign(envelope, "random", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "random", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;
    // Simulate a route marking this attempt failed-but-retryable (e.g. an
    // upstream ownership check timing out) -- as failAttempt itself does.
    await failAttempt(first.nonce, first.generation, { error: "ownership_unverifiable" }, 503, true);

    const second = await authenticateAndClaim(body, "random", params);
    assert.equal(second.outcome, "claimed", "a retryable failure must reach reclaimAttempt, not be reported as terminal");
    if (second.outcome === "claimed") {
      assert.equal(second.generation, "1", "reclaiming should advance the generation");
    }
  } finally {
    await sql`DELETE FROM battle_attempts WHERE wallet = ${address} AND param_hash = ${computeParamHash(params)}`;
  }
});

test("authenticateAndClaim: a non-retryable failure is reported as terminal, replaying its recorded error", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  const envelope = issueNonce();
  const params = ["non-retryable-failure-param"];
  const bytes = bytesToSign(envelope, "random", params);
  const { prefixSig } = await signer.sign(bytes);
  const body = { envelope, publicKey, signature: prefixSig, claimedAddress: address };

  try {
    const first = await authenticateAndClaim(body, "random", params);
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;
    await failAttempt(first.nonce, first.generation, { error: "self_challenge" }, 409, false);

    const second = await authenticateAndClaim(body, "random", params);
    assert.equal(second.outcome, "terminal");
    if (second.outcome === "terminal") {
      assert.deepEqual(second.row.response, { error: "self_challenge" });
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
