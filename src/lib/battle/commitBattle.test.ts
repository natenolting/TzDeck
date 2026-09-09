import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { decayScaledAward } from "./rules";
import {
  claimOrLookupAttempt,
  commitBattle,
  getSql,
  type AttemptIdentity,
  type CommitBattleParams,
  type CommitBattleResult,
} from "./store";

const ATTACKER = "tz1CommitBattleAttacker00000000000000";
const DEFENDER = "tz1CommitBattleDefender00000000000000";

async function cleanup() {
  const sql = getSql();
  for (const wallet of [ATTACKER, DEFENDER]) {
    await sql`DELETE FROM battle_log WHERE attacker_wallet = ${wallet} OR defender_wallet = ${wallet}`;
    await sql`DELETE FROM battle_attempts WHERE wallet = ${wallet}`;
    await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
    await sql`DELETE FROM wallets WHERE address = ${wallet}`;
  }
}

async function seedWallets() {
  const sql = getSql();
  await sql`INSERT INTO wallets (address, opted_in) VALUES (${ATTACKER}, false)`;
  await sql`INSERT INTO wallets (address, opted_in) VALUES (${DEFENDER}, true)`;
}

async function seedProgress(wallet: string, cardKey: string, xp = 0, version = 0) {
  const sql = getSql();
  await sql`
    INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source, progress_version)
    VALUES (${wallet}, ${cardKey}, ${xp}, 5, 50, 'test', ${version})
  `;
}

async function claimFreshAttempt(wallet: string, action = "random"): Promise<{ nonce: string; generation: string }> {
  const nonce = randomUUID();
  const identity: AttemptIdentity = { wallet, action, paramHash: "test" };
  const claimed = await claimOrLookupAttempt(nonce, identity, new Date());
  assert.equal(claimed.kind, "claimed");
  if (claimed.kind !== "claimed") throw new Error("unreachable");
  return { nonce, generation: claimed.row.generation };
}

function baseParams(overrides: Partial<CommitBattleParams> & Pick<CommitBattleParams, "nonce" | "generation">): CommitBattleParams {
  return {
    attackerWallet: ATTACKER,
    attackerCardKey: "KT1A:1",
    attackerExpectedVersion: "0",
    attackerSeedEditions: 5,
    attackerSeedDescriptionLength: 50,
    attackerSeedSource: "test",
    defenderWallet: DEFENDER,
    defenderCardKey: "KT1B:1",
    defenderExpectedVersion: "0",
    outcome: "win",
    winnerWallet: ATTACKER,
    winnerCardKey: "KT1A:1",
    loserWallet: DEFENDER,
    loserCardKey: "KT1B:1",
    loserRecoveryReason: "defensive",
    baseXpAward: 100,
    rulesVersion: "v1",
    rngSeed: "seed",
    inputs: {},
    ...overrides,
  };
}

function isCommitted(result: CommitBattleResult): boolean {
  return result.statusCode === 200;
}

function errorOf(result: CommitBattleResult): string | undefined {
  return (result.response as { error?: string })?.error;
}

test("decay parity: SQL's inline decay formula matches rules.ts's decayScaledAward for a range of counts", async () => {
  const sql = getSql();
  for (const decayCount of [0, 1, 2, 3, 5, 10, 20]) {
    const [row] = await sql<{ award: string }>`
      SELECT GREATEST(1, ROUND(100 * GREATEST(0.1, POWER(0.5, ${decayCount})))) AS award
    `;
    assert.equal(Number(row.award), decayScaledAward(100, decayCount), `mismatch at decayCount=${decayCount}`);
  }
});

test("commit_battle: a win commits XP to the winner, recovery to the loser, cap increments, a decay upsert, and a log row", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(baseParams({ nonce, generation }));
    assert.equal(isCommitted(result), true);
    const response = result.response as { winner: string; xpAwarded: number; winnerNewXp: string; loserRecoveryUntil: string };
    assert.equal(response.winner, "attacker");
    assert.equal(Number(response.winnerNewXp), 100);
    assert.ok(response.loserRecoveryUntil);

    const [attackerWalletRow] = await sql<{ attack_count: number }>`SELECT attack_count FROM wallets WHERE address = ${ATTACKER}`;
    assert.equal(attackerWalletRow.attack_count, 1);
    const [defenderWalletRow] = await sql<{ defense_count: number }>`SELECT defense_count FROM wallets WHERE address = ${DEFENDER}`;
    assert.equal(defenderWalletRow.defense_count, 1);

    const [attackerProgress] = await sql<{ xp: string; progress_version: string }>`
      SELECT xp, progress_version FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(Number(attackerProgress.xp), 100);
    assert.equal(Number(attackerProgress.progress_version), 1);

    const [defenderProgress] = await sql<{ recovery_until: string | null; recovery_reason: string | null }>`
      SELECT recovery_until, recovery_reason FROM wallet_card_progress WHERE wallet = ${DEFENDER} AND card_key = 'KT1B:1'
    `;
    assert.ok(defenderProgress.recovery_until);
    assert.equal(defenderProgress.recovery_reason, "defensive");

    const log = await sql`SELECT * FROM battle_log WHERE attempt_nonce = ${nonce}`;
    assert.equal(log.length, 1);

    const attempt = await sql<{ status: string; response: unknown; status_code: number }>`
      SELECT status, response, status_code FROM battle_attempts WHERE nonce = ${nonce}
    `;
    assert.equal(attempt[0].status, "completed");
    assert.equal(attempt[0].status_code, 200);
    assert.deepEqual(attempt[0].response, result.response, "the persisted response must be byte-identical to what the route received");
  } finally {
    await cleanup();
  }
});

test("commit_battle: the response includes opponent identity and the combat detail from inputs, for battle-log display", async () => {
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const combatInputs = {
      attackerStats: { power: 30, hp: 80 },
      defenderStats: { power: 28, hp: 85 },
      combat: {
        rounds: 2,
        outcome: "A",
        finalHpA: 24,
        finalHpB: 0,
        roundDamageA: 42,
        roundDamageB: 28,
        history: [
          { round: 1, damageA: 30, damageB: 28, hpA: 52, hpB: 55 },
          { round: 2, damageA: 42, damageB: 28, hpA: 24, hpB: 0 },
        ],
      },
    };

    const result = await commitBattle(baseParams({ nonce, generation, inputs: combatInputs }));
    assert.equal(isCommitted(result), true);
    const response = result.response as {
      defenderWallet: string;
      defenderCardKey: string;
      attackerStats: { power: number; hp: number };
      defenderStats: { power: number; hp: number };
      combat: { rounds: number; finalHpA: number; finalHpB: number; history: unknown[] };
    };
    assert.equal(response.defenderWallet, DEFENDER);
    assert.equal(response.defenderCardKey, "KT1B:1");
    assert.deepEqual(response.attackerStats, combatInputs.attackerStats);
    assert.deepEqual(response.defenderStats, combatInputs.defenderStats);
    assert.equal(response.combat.rounds, 2);
    assert.equal(response.combat.finalHpA, 24);
    assert.equal(response.combat.finalHpB, 0);
    assert.deepEqual(response.combat.history, combatInputs.combat.history);
  } finally {
    await cleanup();
  }
});

test("commit_battle: a draw commits cap usage and version bumps to both sides but no XP or recovery", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(
      baseParams({
        nonce,
        generation,
        outcome: "draw",
        winnerWallet: null,
        winnerCardKey: null,
        loserWallet: null,
        loserCardKey: null,
        loserRecoveryReason: null,
      }),
    );
    assert.equal(isCommitted(result), true);
    assert.equal((result.response as { winner: string | null }).winner, null);

    const [attackerProgress] = await sql<{ xp: string; recovery_until: string | null; progress_version: string }>`
      SELECT xp, recovery_until, progress_version FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(Number(attackerProgress.xp), 0);
    assert.equal(attackerProgress.recovery_until, null);
    assert.equal(Number(attackerProgress.progress_version), 1, "draw still bumps progress_version");

    const [defenderProgress] = await sql<{ recovery_until: string | null }>`
      SELECT recovery_until FROM wallet_card_progress WHERE wallet = ${DEFENDER} AND card_key = 'KT1B:1'
    `;
    assert.equal(defenderProgress.recovery_until, null);
  } finally {
    await cleanup();
  }
});

test("commit_battle: a wallet already at its defense cap can still attack (role-specific eligibility)", async () => {
  await cleanup();
  try {
    await seedWallets();
    await getSql()`UPDATE wallets SET defense_count = 20, defense_reset_at = now() + interval '1 day' WHERE address = ${ATTACKER}`;
    // ATTACKER is maxed on DEFENSE, but is attacking here -- should not be blocked.
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(baseParams({ nonce, generation }));
    assert.equal(isCommitted(result), true, "a defense-capped wallet must still be able to attack");
  } finally {
    await cleanup();
  }
});

test("commit_battle: a defender opting out between the pre-check and this commit is still caught", async () => {
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const sql = getSql();
    await sql`UPDATE wallets SET opted_in = false WHERE address = ${DEFENDER}`;
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(baseParams({ nonce, generation }));
    assert.equal(isCommitted(result), false);
    assert.equal(result.statusCode, 409);
    assert.equal(errorOf(result), "defender_opted_out");
  } finally {
    await cleanup();
  }
});

test("commit_battle: a failed eligibility guard leaves zero trace outside battle_attempts (no partial writes)", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1", 0, 5); // defender's version is 5, not what we'll claim as expected
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(baseParams({ nonce, generation, defenderExpectedVersion: "0" }));
    assert.equal(isCommitted(result), false);
    assert.equal(errorOf(result), "stale_defender_version");

    const [attackerProgress] = await sql<{ xp: string; progress_version: string }>`
      SELECT xp, progress_version FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(Number(attackerProgress.xp), 0, "the attacker's row must be completely untouched");
    assert.equal(Number(attackerProgress.progress_version), 0);

    const [attackerWalletRow] = await sql<{ attack_count: number }>`SELECT attack_count FROM wallets WHERE address = ${ATTACKER}`;
    assert.equal(attackerWalletRow.attack_count, 0, "the cap increment must not have committed either");

    const log = await sql`SELECT * FROM battle_log WHERE attempt_nonce = ${nonce}`;
    assert.equal(log.length, 0);

    const attempt = await sql<{ status: string; status_code: number }>`SELECT status, status_code FROM battle_attempts WHERE nonce = ${nonce}`;
    assert.equal(attempt[0].status, "failed");
    assert.equal(attempt[0].status_code, 409, "the rejection's status code must be persisted, not default to 200 on replay");
  } finally {
    await cleanup();
  }
});

test("commit_battle: two concurrent requests using the same pre-fetched combat outcome -- the second's progress_version guard fails", async () => {
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const first = await claimFreshAttempt(ATTACKER, "random-1");
    const second = await claimFreshAttempt(ATTACKER, "random-2");

    const [resultA, resultB] = await Promise.all([
      commitBattle(baseParams({ nonce: first.nonce, generation: first.generation })),
      commitBattle(baseParams({ nonce: second.nonce, generation: second.generation })),
    ]);

    const outcomes = [isCommitted(resultA), isCommitted(resultB)].sort();
    assert.deepEqual(outcomes, [false, true], "exactly one of the two concurrent commits should succeed");
  } finally {
    await cleanup();
  }
});

test("commit_battle: an attacker who never opted in initializes both rows and battles without becoming a defender", async () => {
  const sql = getSql();
  await cleanup();
  try {
    // Only the defender exists ahead of time -- attacker has never touched the battle system.
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${DEFENDER}, true)`;
    await seedProgress(DEFENDER, "KT1B:1");
    const nonce = randomUUID();
    const identity: AttemptIdentity = { wallet: ATTACKER, action: "random", paramHash: "test" };
    const claimed = await claimOrLookupAttempt(nonce, identity, new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;

    const result = await commitBattle(
      baseParams({ nonce, generation: claimed.row.generation, attackerExpectedVersion: null }),
    );
    assert.equal(isCommitted(result), true);

    const [attackerWalletRow] = await sql<{ opted_in: boolean }>`SELECT opted_in FROM wallets WHERE address = ${ATTACKER}`;
    assert.equal(attackerWalletRow.opted_in, false, "attacking must not implicitly opt a wallet into defense");

    const [attackerProgress] = await sql<{ xp: string }>`SELECT xp FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'`;
    assert.equal(Number(attackerProgress.xp), 100, "the commit-time upsert should have initialized and then credited this row");
  } finally {
    await cleanup();
  }
});

test("commit_battle: a concurrent opt-in materialization racing the same first-use row is rejected, not silently accepted", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${DEFENDER}, true)`;
    await seedProgress(DEFENDER, "KT1B:1");
    const nonce = randomUUID();
    const identity: AttemptIdentity = { wallet: ATTACKER, action: "random", paramHash: "test" };
    const claimed = await claimOrLookupAttempt(nonce, identity, new Date());
    assert.equal(claimed.kind, "claimed");
    if (claimed.kind !== "claimed") return;

    // Simulate a concurrent opt-in holdings-sync promotion materializing this
    // exact row (version 0) with DIFFERENT seed data, moments before commit_battle's own insert.
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${ATTACKER}, false) ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source, progress_version)
      VALUES (${ATTACKER}, 'KT1A:1', 999, 999, 'holdings-sync', 0)
    `;

    const result = await commitBattle(
      baseParams({ nonce, generation: claimed.row.generation, attackerExpectedVersion: null }),
    );
    assert.equal(isCommitted(result), false);
    assert.equal(result.statusCode, 409);
    assert.equal(errorOf(result), "conflicting_first_use_materialization");

    const [attackerProgress] = await sql<{ seed_editions: number; xp: string }>`
      SELECT seed_editions, xp FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(attackerProgress.seed_editions, 999, "the concurrently-materialized row must be untouched, not overwritten with this call's own seed");
    assert.equal(Number(attackerProgress.xp), 0, "no XP must have been credited against unverified stats");
  } finally {
    await cleanup();
  }
});

test("commit_battle: an attempt whose lease/retry window already closed is rejected as expired, and marked retryable", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);
    await sql`UPDATE battle_attempts SET lease_expires_at = now() - interval '1 second' WHERE nonce = ${nonce}`;

    const result = await commitBattle(baseParams({ nonce, generation }));
    assert.equal(isCommitted(result), false);
    assert.equal(result.statusCode, 503);
    assert.equal(errorOf(result), "attempt_expired");

    const attempt = await sql<{ retryable: boolean | null }>`SELECT retryable FROM battle_attempts WHERE nonce = ${nonce}`;
    assert.equal(attempt[0].retryable, true, "an expired-window rejection is operational, not a business rule -- must be retryable");

    const log = await sql`SELECT * FROM battle_log WHERE attempt_nonce = ${nonce}`;
    assert.equal(log.length, 0);
  } finally {
    await cleanup();
  }
});

test("commit_battle: two concurrent battles with reversed attacker/defender roles do not deadlock", async () => {
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    // A attacks B's card...
    const aAttacksB = await claimFreshAttempt(ATTACKER, "random-a-attacks-b");
    // ...while B (also opted in as an attacker here) attacks A's card, concurrently.
    await getSql()`UPDATE wallets SET opted_in = true WHERE address = ${ATTACKER}`;
    const bAttacksA = await claimFreshAttempt(DEFENDER, "random-b-attacks-a");

    const [resultAB, resultBA] = await Promise.all([
      commitBattle(baseParams({ nonce: aAttacksB.nonce, generation: aAttacksB.generation })),
      commitBattle(
        baseParams({
          nonce: bAttacksA.nonce,
          generation: bAttacksA.generation,
          attackerWallet: DEFENDER,
          attackerCardKey: "KT1B:1",
          attackerExpectedVersion: "0",
          defenderWallet: ATTACKER,
          defenderCardKey: "KT1A:1",
          defenderExpectedVersion: "0",
          winnerWallet: DEFENDER,
          winnerCardKey: "KT1B:1",
          loserWallet: ATTACKER,
          loserCardKey: "KT1A:1",
        }),
      ),
    ]);

    // No deadlock error should have propagated -- both calls returned a real
    // result (committed or a clean stale-version rejection), never hung or thrown.
    assert.equal(typeof resultAB.statusCode, "number");
    assert.equal(typeof resultBA.statusCode, "number");
  } finally {
    await cleanup();
  }
});

test("commit_battle: a self-challenge is rejected", async () => {
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);

    const result = await commitBattle(
      baseParams({ nonce, generation, defenderWallet: ATTACKER, defenderCardKey: "KT1A:2", winnerWallet: ATTACKER, loserWallet: ATTACKER }),
    );
    assert.equal(isCommitted(result), false);
    assert.equal(errorOf(result), "self_challenge");
  } finally {
    await cleanup();
  }
});

test("commit_battle: a duplicate request with the same nonce is never re-run against this function twice (the app layer short-circuits first)", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallets();
    await seedProgress(ATTACKER, "KT1A:1");
    await seedProgress(DEFENDER, "KT1B:1");
    const { nonce, generation } = await claimFreshAttempt(ATTACKER);
    await commitBattle(baseParams({ nonce, generation }));

    // Calling commit_battle again with the same nonce+generation should be a
    // no-op from this function's own perspective too, since the attempt is
    // no longer 'pending' -- defense in depth behind the app-layer ledger check.
    const rows = await sql<{ response: { error?: string }; status_code: number }>`
      SELECT * FROM commit_battle(
        ${nonce}, ${generation}::bigint, ${ATTACKER}, 'KT1A:1', ${"1"}::bigint, 5, 50, 'test',
        ${DEFENDER}, 'KT1B:1', ${"1"}::bigint, 'win', ${ATTACKER}, 'KT1A:1', ${DEFENDER}, 'KT1B:1', 'defensive',
        100, 'v1', 'seed', '{}'::jsonb
      )
    `;
    assert.equal(rows[0].status_code, 409);
    assert.equal(rows[0].response.error, "attempt_not_claimable");

    const progress = await sql<{ xp: string }>`SELECT xp FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'`;
    assert.equal(Number(progress[0].xp), 100, "no double-XP from the second invocation attempt");
  } finally {
    await cleanup();
  }
});
