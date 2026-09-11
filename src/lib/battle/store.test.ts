import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSql,
  resetConnectionForTests,
  claimOrLookupAttempt,
  reclaimAttempt,
  renewLease,
  releaseLeaseForContinuation,
  completeAttempt,
  failAttempt,
  checkRateLimit,
  type AttemptIdentity,
} from "./store";

const TEST_WALLET = "tz1TestWallet00000000000000000000000";
const TEST_CARD_KEY = "KT1TestContract00000000000000000000:1";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM wallets WHERE address = ${TEST_WALLET}`;
}

function identity(overrides: Partial<AttemptIdentity> = {}): AttemptIdentity {
  return { wallet: TEST_WALLET, action: "random", paramHash: "hash-a", ...overrides };
}

async function clearAttempt(nonce: string) {
  const sql = getSql();
  await sql`DELETE FROM battle_attempts WHERE nonce = ${nonce}`;
}

test("store: wallet_card_progress happy path", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${TEST_WALLET})`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source)
      VALUES (${TEST_WALLET}, ${TEST_CARD_KEY}, 0, 5, 120, 'test')
    `;
    const rows = await sql<{ xp: string }>`
      SELECT xp FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    assert.equal(Number(rows[0].xp), 0);
  } finally {
    await cleanup();
  }
});

test("store: two concurrent relative-XP updates both land", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${TEST_WALLET})`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source)
      VALUES (${TEST_WALLET}, ${TEST_CARD_KEY}, 0, 5, 120, 'test')
    `;
    await Promise.all([
      sql`UPDATE wallet_card_progress SET xp = xp + 10 WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}`,
      sql`UPDATE wallet_card_progress SET xp = xp + 20 WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}`,
    ]);
    const rows = await sql<{ xp: string }>`
      SELECT xp FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    assert.equal(Number(rows[0].xp), 30);
  } finally {
    await cleanup();
  }
});

test("store: a connection failure surfaces a clear error rather than hanging", async () => {
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://bad:bad@localhost:1/doesnotexist";
  resetConnectionForTests();
  try {
    await assert.rejects(async () => {
      const sql = getSql();
      await sql`SELECT 1`;
    });
  } finally {
    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
    resetConnectionForTests();
  }
});

test("U1b: first claim inserts a fresh pending attempt", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const result = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(result.kind, "claimed");
    if (result.kind === "claimed") {
      assert.equal(result.row.status, "pending");
      assert.equal(result.row.generation, "0");
    }
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: identity mismatch never returns another identity's result", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    await claimOrLookupAttempt(nonce, identity({ action: "random" }), new Date());
    const result = await claimOrLookupAttempt(nonce, identity({ action: "challenge" }), new Date());
    assert.equal(result.kind, "identity_mismatch");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a live pending attempt reports in-flight, not absent or failed", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    await claimOrLookupAttempt(nonce, identity(), new Date());
    const result = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(result.kind, "in_progress");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: concurrent initial claims -- exactly one becomes the claimant", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const [a, b] = await Promise.all([
      claimOrLookupAttempt(nonce, identity(), new Date()),
      claimOrLookupAttempt(nonce, identity(), new Date()),
    ]);
    const kinds = [a.kind, b.kind].sort();
    assert.deepEqual(kinds, ["claimed", "in_progress"]);
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a completed terminal attempt returns its original response, not fresh work", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await completeAttempt(nonce, claimed.row.generation, { ok: true }, 200);

    const result = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(result.kind, "terminal");
    if (result.kind === "terminal") {
      assert.equal(result.row.status, "completed");
      assert.deepEqual(result.row.response, { ok: true });
    }
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a retryable failed attempt can be reclaimed at a new generation", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await failAttempt(nonce, claimed.row.generation, { error: "upstream_unavailable" }, 503, true);

    const reclaimed = await reclaimAttempt(nonce, identity());
    assert.ok(reclaimed);
    assert.equal(reclaimed?.generation, "1");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a non-retryable failed attempt cannot be reclaimed", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await failAttempt(nonce, claimed.row.generation, { error: "self_challenge" }, 400, false);

    const reclaimed = await reclaimAttempt(nonce, identity());
    assert.equal(reclaimed, null);
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: simultaneous reclaimers of the same failed attempt -- only one succeeds", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await failAttempt(nonce, claimed.row.generation, { error: "timeout" }, 503, true);

    const [a, b] = await Promise.all([
      reclaimAttempt(nonce, identity()),
      reclaimAttempt(nonce, identity()),
    ]);
    const succeeded = [a, b].filter((r) => r !== null);
    assert.equal(succeeded.length, 1, "exactly one reclaimer should win");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: an expired pending lease can be taken over by a new worker", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  const sql = getSql();
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    // Force the lease into the past to simulate a dead worker.
    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${nonce}`;

    const reclaimed = await reclaimAttempt(nonce, identity());
    assert.ok(reclaimed);
    assert.equal(reclaimed?.generation, "1");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: renewal fails once a lease has expired and been taken over", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  const sql = getSql();
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    const originalGeneration = claimed.row.generation;

    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${nonce}`;
    const takeover = await reclaimAttempt(nonce, identity());
    assert.ok(takeover);

    const staleRenewal = await renewLease(nonce, originalGeneration);
    assert.equal(staleRenewal, false, "the original worker's stale generation must not renew");

    const freshRenewal = await renewLease(nonce, takeover!.generation);
    assert.equal(freshRenewal, true);
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a stale worker's fail callback cannot overwrite a newer generation's completed result", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  const sql = getSql();
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    const originalGeneration = claimed.row.generation;

    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${nonce}`;
    const takeover = await reclaimAttempt(nonce, identity());
    assert.ok(takeover);
    await completeAttempt(nonce, takeover!.generation, { ok: true }, 200);

    const staleFailWrite = await failAttempt(nonce, originalGeneration, { error: "late" }, 503, true);
    assert.equal(staleFailWrite, false);

    const rows = await sql<{ status: string }>`SELECT status FROM battle_attempts WHERE nonce = ${nonce}`;
    assert.equal(rows[0].status, "completed");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: a bounded work slice can checkpoint and release without failing", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;

    const released = await releaseLeaseForContinuation(nonce, claimed.row.generation);
    assert.equal(released, true);

    const reclaimed = await reclaimAttempt(nonce, identity());
    assert.ok(reclaimed, "a released lease should immediately be reclaimable for continuation");
  } finally {
    await clearAttempt(nonce);
  }
});

test("U1b: reclaim fails once the retry deadline has passed", async (t) => {
  const nonce = `nonce-${t.name}-${Date.now()}`;
  const sql = getSql();
  try {
    const claimed = await claimOrLookupAttempt(nonce, identity(), new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;
    await failAttempt(nonce, claimed.row.generation, { error: "timeout" }, 503, true);
    await sql`UPDATE battle_attempts SET retry_until = now() - interval '1 second' WHERE nonce = ${nonce}`;

    const reclaimed = await reclaimAttempt(nonce, identity());
    assert.equal(reclaimed, null, "an attempt past its retry deadline must not be reclaimable");
  } finally {
    await clearAttempt(nonce);
  }
});

test("checkRateLimit: allows up to the max within a window, then blocks, then resets on the next window", async (t) => {
  const key = `ratelimit-${t.name}-${Date.now()}`;
  const sql = getSql();
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await checkRateLimit(key, 60, 3), true, `request ${i + 1} of 3 should be within budget`);
    }
    assert.equal(await checkRateLimit(key, 60, 3), false, "the 4th request in the same window must be rejected");

    // Simulate the window having already elapsed.
    await sql`UPDATE rate_limits SET window_started_at = now() - interval '61 seconds' WHERE bucket_key = ${key}`;
    assert.equal(await checkRateLimit(key, 60, 3), true, "a new window must reset the count, not carry the old one forward");
  } finally {
    await sql`DELETE FROM rate_limits WHERE bucket_key = ${key}`;
  }
});
