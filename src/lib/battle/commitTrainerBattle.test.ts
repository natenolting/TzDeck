import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { decayScaledAward, trainerId } from "./rules";
import {
  claimOrLookupAttempt,
  commitTrainerBattle,
  getSql,
  type AttemptIdentity,
  type CommitTrainerBattleParams,
  type CommitResult,
} from "./store";

const ATTACKER = "tz1CommitTrainerAttacker0000000000000";
const TRAINER_TIER = "common";
const TRAINER_ID = trainerId(TRAINER_TIER);

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM battle_log WHERE attacker_wallet = ${ATTACKER} OR winner_wallet = ${ATTACKER} OR loser_wallet = ${ATTACKER}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${ATTACKER}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${ATTACKER}`;
  await sql`DELETE FROM wallets WHERE address = ${ATTACKER}`;
}

async function seedWallet() {
  const sql = getSql();
  await sql`INSERT INTO wallets (address, opted_in) VALUES (${ATTACKER}, false)`;
}

async function seedProgress(cardKey: string, xp = 0, version = 0) {
  const sql = getSql();
  await sql`
    INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source, progress_version)
    VALUES (${ATTACKER}, ${cardKey}, ${xp}, 5, 50, 'test', ${version})
  `;
}

async function claimFreshAttempt(action = "trainer"): Promise<{ nonce: string; generation: string }> {
  const nonce = randomUUID();
  const identity: AttemptIdentity = { wallet: ATTACKER, action, paramHash: "test" };
  const claimed = await claimOrLookupAttempt(nonce, identity, new Date());
  assert.equal(claimed.kind, "claimed");
  if (claimed.kind !== "claimed") throw new Error("unreachable");
  return { nonce, generation: claimed.row.generation };
}

async function seedHistoricalTrainerWin(ageInterval: string) {
  const sql = getSql();
  const nonce = randomUUID();
  await sql`
    INSERT INTO battle_attempts (nonce, wallet, action, param_hash, issued_at, retry_until, status, status_code)
    VALUES (${nonce}, ${ATTACKER}, 'trainer', 'historical', now(), now() + interval '15 minutes', 'completed', 200)
  `;
  await sql`
    INSERT INTO battle_log (
      attempt_nonce, attacker_wallet, attacker_card_key, defender_wallet, defender_card_key,
      winner_wallet, loser_wallet, outcome, settled_at, rules_version, inputs, rng_seed, xp_awarded
    ) VALUES (
      ${nonce}, ${ATTACKER}, 'KT1Historical:1', ${TRAINER_ID}, ${TRAINER_ID},
      ${ATTACKER}, ${TRAINER_ID}, 'win', now() - ${ageInterval}::interval, 'v1', '{}'::jsonb, 'seed', 100
    )
  `;
}

function baseParams(overrides: Partial<CommitTrainerBattleParams> & Pick<CommitTrainerBattleParams, "nonce" | "generation">): CommitTrainerBattleParams {
  return {
    attackerWallet: ATTACKER,
    attackerCardKey: "KT1A:1",
    attackerExpectedVersion: "0",
    attackerSeedEditions: 100,
    attackerSeedDescriptionLength: 50,
    attackerSeedSource: "test",
    trainerTier: TRAINER_TIER,
    outcome: "win",
    attackerWon: true,
    baseXpAward: 100,
    rulesVersion: "v1",
    rngSeed: "seed",
    inputs: {},
    ...overrides,
  };
}

function isCommitted(result: CommitResult): boolean {
  return result.statusCode === 200;
}

function errorOf(result: CommitResult): string | undefined {
  return (result.response as { error?: string })?.error;
}

test("repeat-decay parity: SQL's inline decay formula matches rules.ts's decayScaledAward for a range of counts", async () => {
  const sql = getSql();
  for (const decayCount of [0, 1, 2, 3, 5, 10, 20]) {
    const [row] = await sql<{ award: string }>`
      SELECT GREATEST(1, ROUND(100 * GREATEST(0.1, POWER(0.5, ${decayCount})))) AS award
    `;
    // commit_trainer_battle's repeat-decay stage operates on whatever
    // p_base_xp_award it's given -- 100 here is that opaque base, not
    // trainerXpAward's own tier-derived one, so decayScaledAward is the
    // correct generic reference, matching commitBattle.test.ts's own
    // decay-parity test.
    assert.equal(Number(row.award), decayScaledAward(100, decayCount), `mismatch at decayCount=${decayCount}`);
  }
});

test("commit_trainer_battle: a win against the trainer commits XP, no recovery, a cap increment, and a log row", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    await seedProgress("KT1A:1");
    const { nonce, generation } = await claimFreshAttempt();

    const result = await commitTrainerBattle(baseParams({ nonce, generation }));
    assert.equal(isCommitted(result), true);
    const response = result.response as { winner: string; xpAwarded: number; winnerNewXp: string; trainerTier: string; trainerId: string };
    assert.equal(response.winner, "attacker");
    assert.equal(response.xpAwarded, 100);
    assert.equal(Number(response.winnerNewXp), 100);
    assert.equal(response.trainerTier, TRAINER_TIER);
    assert.equal(response.trainerId, TRAINER_ID);

    const [walletRow] = await sql<{ trainer_attack_count: number }>`SELECT trainer_attack_count FROM wallets WHERE address = ${ATTACKER}`;
    assert.equal(walletRow.trainer_attack_count, 1);

    const [progressRow] = await sql<{ recovery_until: string | null }>`
      SELECT recovery_until FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(progressRow.recovery_until, null);

    const [logRow] = await sql<{ winner_wallet: string; loser_wallet: string }>`
      SELECT winner_wallet, loser_wallet FROM battle_log WHERE attempt_nonce = ${nonce}
    `;
    assert.equal(logRow.winner_wallet, ATTACKER);
    assert.equal(logRow.loser_wallet, TRAINER_ID);
  } finally {
    await cleanup();
  }
});

test("commit_trainer_battle: a loss to the trainer sets offensive recovery, no XP", async () => {
  await cleanup();
  try {
    await seedWallet();
    await seedProgress("KT1A:1");
    const { nonce, generation } = await claimFreshAttempt();

    const result = await commitTrainerBattle(baseParams({ nonce, generation, attackerWon: false }));
    assert.equal(isCommitted(result), true);
    const response = result.response as { winner: string; xpAwarded: number; loserRecoveryUntil: string | null };
    assert.equal(response.winner, "defender");
    assert.equal(response.xpAwarded, 0);
    assert.ok(response.loserRecoveryUntil);
  } finally {
    await cleanup();
  }
});

test("commit_trainer_battle: a draw bumps progress_version with no XP and no recovery", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    await seedProgress("KT1A:1");
    const { nonce, generation } = await claimFreshAttempt();

    const result = await commitTrainerBattle(baseParams({ nonce, generation, outcome: "draw" }));
    assert.equal(isCommitted(result), true);
    const response = result.response as { winner: null; xpAwarded: number };
    assert.equal(response.winner, null);
    assert.equal(response.xpAwarded, 0);

    const [progressRow] = await sql<{ progress_version: string; recovery_until: string | null }>`
      SELECT progress_version, recovery_until FROM wallet_card_progress WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    assert.equal(progressRow.progress_version, "1");
    assert.equal(progressRow.recovery_until, null);
  } finally {
    await cleanup();
  }
});

test("commit_trainer_battle: an attacker still recovering is rejected before anything is written", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    await seedProgress("KT1A:1");
    await sql`
      UPDATE wallet_card_progress SET recovery_until = now() + interval '1 hour', recovery_reason = 'offensive'
      WHERE wallet = ${ATTACKER} AND card_key = 'KT1A:1'
    `;
    const { nonce, generation } = await claimFreshAttempt();

    const result = await commitTrainerBattle(baseParams({ nonce, generation }));
    assert.equal(result.statusCode, 409);
    assert.equal(errorOf(result), "attacker_recovering");
  } finally {
    await cleanup();
  }
});

test("commit_trainer_battle: repeat wins against the same trainer within 7 days decay the award", async () => {
  await cleanup();
  try {
    await seedWallet();
    await seedProgress("KT1A:1");
    await seedHistoricalTrainerWin("1 day");
    await seedHistoricalTrainerWin("2 days");
    const { nonce, generation } = await claimFreshAttempt();

    const result = await commitTrainerBattle(baseParams({ nonce, generation }));
    const response = result.response as { xpAwarded: number };
    // baseParams' baseXpAward (100) is a fixture value, not
    // trainerBaseXpAward's own computed base -- decayScaledAward applied to
    // that same fixture is what commit_trainer_battle's repeat-decay stage
    // actually operates on.
    assert.equal(response.xpAwarded, decayScaledAward(100, 2));
  } finally {
    await cleanup();
  }
});
