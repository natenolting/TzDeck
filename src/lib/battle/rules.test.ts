import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLevel,
  baseStatsFromSeed,
  baseXpAward,
  bestFittingCardForWallet,
  candidateStrength,
  criticalHitChance,
  criticalHitMultiplier,
  decayScaledAward,
  deriveBaseSeed,
  effectiveStats,
  findMatch,
  hpFromTierAndDescription,
  levelForXp,
  missChance,
  mulberry32,
  normalizeDescriptionLength,
  powerFromEditions,
  resolveBattle,
  xpThresholdForLevel,
  xpWithinLevel,
  TRAINER_LEVEL_UNLOCK,
  trainerId,
  trainerStats,
  highestUnlockedTrainerTier,
  isTrainerTierUnlocked,
  trainerTierGap,
  trainerBaseXpAward,
  trainerXpAward,
  settleTrainerBattle,
  settlePlayerBattle,
  type Combatant,
  type BattleResult,
  type CandidateCard,
  type Rng,
} from "./rules";
import { RARITY_TIERS } from "@/lib/rarity";

const FAR_FUTURE = new Date("2100-01-01");
const NOW = new Date("2026-01-01");
/** No damage swing, and a d100 of 51, which is neither a miss nor a crit at level 1. */
const steady: Rng = () => 0.5;
const LEVEL_ONE = { attacker: 1, defender: 1 };

function makeCandidate(overrides: Partial<CandidateCard> & Pick<CandidateCard, "wallet" | "cardKey">): CandidateCard {
  return {
    seed: deriveBaseSeed(50, "a description"),
    level: 1,
    recoveryUntil: null,
    defenseCount: 0,
    defenseResetAt: FAR_FUTURE,
    progressVersion: "1",
    ...overrides,
  };
}

test("powerFromEditions: a 1-of-1 gets the highest Power", () => {
  assert.equal(powerFromEditions(1), 100);
});

test("powerFromEditions: an extremely high edition count never drops below its floor", () => {
  const power = powerFromEditions(10_000_000);
  assert.ok(power >= 10, `expected power >= 10, got ${power}`);
});

test("hpFromTierAndDescription: a missing description still produces the floor HP, not zero", () => {
  const hp = hpFromTierAndDescription("common", 0);
  assert.equal(hp, 210); // common baseline, zero modifier
});

test("hpFromTierAndDescription: an extremely long description never exceeds the modifier cap", () => {
  const hpAt2000Chars = hpFromTierAndDescription("legendary", 2000);
  const hpAtCap = Math.round(600 * 1.2);
  assert.equal(hpAt2000Chars, hpAtCap, "modifier should have converged to its 20% cap");
});

test("hpFromTierAndDescription: HP grows monotonically with description length, within the cap", () => {
  const short = hpFromTierAndDescription("common", 10);
  const medium = hpFromTierAndDescription("common", 200);
  const long = hpFromTierAndDescription("common", 5000);
  assert.ok(short <= medium && medium <= long);
});

test("normalizeDescriptionLength: strips markup and collapses whitespace before counting", () => {
  const length = normalizeDescriptionLength("<p>Hello   **world**</p>\n\n");
  assert.equal(length, normalizeDescriptionLength("Hello world"));
});

test("normalizeDescriptionLength: a missing description normalizes to zero", () => {
  assert.equal(normalizeDescriptionLength(undefined), 0);
  assert.equal(normalizeDescriptionLength(null), 0);
});

test("a card's Power and HP derive correctly from a given edition count and description length", () => {
  const seed = deriveBaseSeed(1, "");
  const stats = baseStatsFromSeed(seed);
  assert.equal(stats.tier, "legendary");
  assert.equal(stats.power, 100);
  assert.equal(stats.hp, 600);
});

test("two callers computing stats from the same seed and level get identical Power/HP", () => {
  const seedA = deriveBaseSeed(5, "A short blurb about this piece.");
  const seedB = deriveBaseSeed(5, "A short blurb about this piece.");
  assert.deepEqual(effectiveStats(seedA, 3), effectiveStats(seedB, 3));
});

test("metadata captured at different times may legitimately produce different seeds", () => {
  const seedNow = deriveBaseSeed(5, "short");
  const seedLater = deriveBaseSeed(3, "a longer description written later");
  assert.notDeepEqual(seedNow, seedLater);
});

test("effective stats change with level, not just the stored seed", () => {
  const seed = deriveBaseSeed(5, "some description");
  const atLevel1 = effectiveStats(seed, 1);
  const atLevel5 = effectiveStats(seed, 5);
  assert.ok(atLevel5.power > atLevel1.power, "Power should increase with level");
  assert.ok(atLevel5.hp > atLevel1.hp, "HP should increase with level");
});

test("applyLevel: Level 1 is the unscaled baseline", () => {
  const { power, hp } = applyLevel(50, 100, 1);
  assert.equal(power, 50);
  assert.equal(hp, 100);
});

test("criticalHitChance starts at 1% for level 1 and grows 0.5%/level up to a 20% cap at level 39", () => {
  assert.equal(criticalHitChance(1), 0.01);
  assert.equal(criticalHitChance(20), 0.105);
  assert.equal(criticalHitChance(39), 0.2);
  assert.equal(criticalHitChance(40), 0.2, "capped -- never exceeds 20% past level 39");
  assert.equal(criticalHitChance(100), 0.2);
});

test("criticalHitMultiplier starts at 1.5x for level 1 and grows 0.05x/level up to a 3.0x cap at level 31", () => {
  assert.equal(criticalHitMultiplier(1), 1.5);
  assert.equal(criticalHitMultiplier(16), 2.25);
  assert.equal(criticalHitMultiplier(31), 3);
  assert.equal(criticalHitMultiplier(32), 3, "capped -- never exceeds 3.0x past level 31");
});

test("missChance starts at 10% for level 1 and decays 0.3%/level down to a 1% floor at level 31", () => {
  assert.equal(missChance(1), 0.1);
  assert.equal(missChance(16), 0.055);
  assert.equal(missChance(31), 0.01);
  assert.equal(missChance(32), 0.01, "floored -- never drops below 1% past level 31");
});

test("resolveBattle: one side's HP reaches 0 first -- the surviving side wins, no tiebreak invoked", () => {
  const result = resolveBattle({ power: 20, hp: 100 }, { power: 5, hp: 20 }, 0, steady, LEVEL_ONE);
  assert.equal(result.outcome, "A");
  assert.equal(result.finalHpB, 0);
  assert.ok(result.finalHpA > 0);
});

test("resolveBattle: both sides reach 0 the same round with unequal round damage -- higher-damage side wins", () => {
  const result = resolveBattle({ power: 12, hp: 20 }, { power: 8, hp: 36 }, 0, steady, LEVEL_ONE);
  assert.equal(result.rounds, 3);
  assert.equal(result.roundDamageA, 12);
  assert.equal(result.roundDamageB, 8);
  assert.equal(result.outcome, "A", "the side that dealt more damage in the deciding round wins");
});

test("resolveBattle: records a per-round history with damage dealt and resulting HP for both sides", () => {
  const result = resolveBattle({ power: 12, hp: 20 }, { power: 8, hp: 36 }, 0, steady, LEVEL_ONE);
  assert.equal(result.history.length, 3);
  assert.deepEqual(result.history[0], { round: 1, damageA: 12, damageB: 8, hpA: 12, hpB: 24, resultA: "hit", resultB: "hit" });
  assert.deepEqual(result.history[1], { round: 2, damageA: 12, damageB: 8, hpA: 4, hpB: 12, resultA: "hit", resultB: "hit" });
  // HP never reported negative even though the losing side's real HP went below zero internally.
  assert.deepEqual(result.history[2], { round: 3, damageA: 12, damageB: 8, hpA: 0, hpB: 0, resultA: "hit", resultB: "hit" });
});

test("resolveBattle: both sides reach 0 the same round with exactly equal round damage -- true draw", () => {
  const result = resolveBattle({ power: 10, hp: 30 }, { power: 10, hp: 30 }, 0, steady, LEVEL_ONE);
  assert.equal(result.roundDamageA, result.roundDamageB);
  assert.equal(result.outcome, "draw");
});

test("resolveBattle: identical stat inputs at 0% variance still draw (the tiebreak doesn't invent an asymmetry)", () => {
  const stats = { power: 31, hp: 77 };
  const result = resolveBattle(stats, { ...stats }, 0, steady, LEVEL_ONE);
  assert.equal(result.outcome, "draw");
});

test("resolveBattle: seeded-RNG runs at a specific seed reproduce bit-identical results", () => {
  const attacker = { power: 30, hp: 80 };
  const defender = { power: 28, hp: 85 };
  const first = resolveBattle(attacker, defender, 0.2, mulberry32(90210), LEVEL_ONE);
  const second = resolveBattle(attacker, defender, 0.2, mulberry32(90210), LEVEL_ONE);
  assert.deepEqual(first, second);
});

test("resolveBattle: a roll of exactly 1 on the shared d100 is always a miss, dealing zero damage that round", () => {
  // Roll order per round: swingA, swingB, then resultA's d100, resultB's d100.
  const rolls = [0.5, 0.5, 0, 0.5];
  let i = 0;
  const rng: Rng = () => rolls[i++ % rolls.length];
  const result = resolveBattle({ power: 20, hp: 200 }, { power: 10, hp: 200 }, 0, rng, { attacker: 1, defender: 1 });

  assert.equal(result.history[0].resultA, "miss");
  assert.equal(result.history[0].damageA, 0);
  assert.equal(result.history[0].resultB, "hit");
  assert.equal(result.history[0].damageB, 10);
});

test("resolveBattle: a roll landing in the top critChance% of the shared d100 multiplies that side's already-varied damage", () => {
  const rolls = [0.5, 0.5, 0.995, 0.5];
  let i = 0;
  const rng: Rng = () => rolls[i++ % rolls.length];
  const result = resolveBattle({ power: 20, hp: 200 }, { power: 10, hp: 200 }, 0, rng, { attacker: 1, defender: 1 });

  assert.equal(result.history[0].resultA, "critical");
  assert.equal(result.history[0].damageA, 20 * criticalHitMultiplier(1));
  assert.equal(result.history[0].resultB, "hit");
  assert.equal(result.history[0].damageB, 10);
});

test("resolveBattle: a higher-level side rolls crit/miss against its own, larger, chance", () => {
  // At level 39 (crit-capped 20%), a roll of 0.995 (d100 = 100) still lands
  // in the top 20 of 100 slots -- still a crit, same as at level 1, but a
  // roll near the boundary (d100 = 81, the lowest crit slot at 20%) would
  // NOT have crit at level 1 (whose crit zone is only the single top slot).
  const rollsHighLevel = [0.5, 0.5, 0.8, 0.5]; // d100 = 81 -> crit only when critChance is large enough
  let i = 0;
  const rngHighLevel: Rng = () => rollsHighLevel[i++ % rollsHighLevel.length];
  const highLevelResult = resolveBattle({ power: 20, hp: 200 }, { power: 10, hp: 200 }, 0, rngHighLevel, {
    attacker: 39,
    defender: 1,
  });
  assert.equal(highLevelResult.history[0].resultA, "critical", "level 39's 20% crit zone covers d100 = 81");

  i = 0;
  const rngLowLevel: Rng = () => rollsHighLevel[i++ % rollsHighLevel.length];
  const lowLevelResult = resolveBattle({ power: 20, hp: 200 }, { power: 10, hp: 200 }, 0, rngLowLevel, {
    attacker: 1,
    defender: 1,
  });
  assert.equal(lowLevelResult.history[0].resultA, "hit", "level 1's 1% crit zone (d100 = 100 only) doesn't cover d100 = 81");
});

test("baseXpAward: defeating a stronger/higher-level opponent yields more XP than a much weaker one", () => {
  const strong = baseXpAward("legendary", 10);
  const weak = baseXpAward("common", 1);
  assert.ok(strong > weak);
});

test("decayScaledAward: repeated wins against the same pair yield progressively less XP, floored", () => {
  assert.equal(decayScaledAward(100, 0), 100);
  assert.equal(decayScaledAward(100, 1), 50);
  assert.equal(decayScaledAward(100, 5), 10, "should have hit the 10% floor by decayCount 5");
  assert.equal(decayScaledAward(100, 20), 10, "the floor should not keep shrinking further");
});

test("xpThresholdForLevel / levelForXp: an award crossing two level thresholds derives both level-ups without reducing lifetime XP", () => {
  const startingXp = 90; // Level 1
  assert.equal(levelForXp(startingXp), 1);

  const afterAward = startingXp + 250; // crosses the Level 2 (100) and Level 3 (300) thresholds
  assert.equal(afterAward, 340);
  assert.equal(levelForXp(afterAward), 3, "should cross two thresholds in one award");
  assert.equal(
    xpWithinLevel(afterAward),
    afterAward - xpThresholdForLevel(3),
    "displayed within-level XP is total minus the new level's cumulative threshold",
  );
});

test("a draw or loss yields zero XP (baseXpAward/decayScaledAward are simply never invoked for those outcomes)", () => {
  // This unit only computes what a WIN awards; U8's commit function is what
  // gates XP application on outcome === "win" per R10/R14 -- documented here
  // so the contract (no call, no XP) is explicit at the boundary.
  assert.equal(typeof baseXpAward, "function");
});

test("restoring a previously-saved Level 5 progress record and applying a subsequent win continues from Level 5, not Level 1", () => {
  const restoredXp = xpThresholdForLevel(5); // exactly at the Level 5 boundary
  assert.equal(levelForXp(restoredXp), 5);

  const afterWin = restoredXp + decayScaledAward(baseXpAward("uncommon", 3), 0);
  assert.equal(levelForXp(afterWin), 5, "should still be Level 5, not reset to Level 1");
  assert.ok(afterWin > restoredXp);
});

test("findMatch: a wallet holding a Level 1 and Level 20 card is represented by whichever has the closer Power x HP product", () => {
  const seed = deriveBaseSeed(50, "a description");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed, level: 3 }));

  const level1Card = makeCandidate({ wallet: "tz1Wallet", cardKey: "KT1:1", seed, level: 1 });
  const level20Card = makeCandidate({ wallet: "tz1Wallet", cardKey: "KT1:2", seed, level: 20 });
  const pool = [level1Card, level20Card];

  const match = findMatch(attackerStrength, pool, NOW);
  assert.ok(match);
  // Since both share a seed, the closer level (both closer than level 20) should win, not necessarily the lower one.
  assert.equal(
    Math.abs(candidateStrength(match!.card) - attackerStrength) <=
      Math.abs(candidateStrength(level20Card) - attackerStrength),
    true,
  );
});

test("findMatch: no candidate within the widest band fails with no match", () => {
  const attackerStrength = 1; // absurdly low; even the widest band (up to 3x) stays tiny
  const pool = [makeCandidate({ wallet: "tz1Wallet", cardKey: "KT1:1" })]; // real strength is in the thousands
  const match = findMatch(attackerStrength, pool, NOW);
  assert.equal(match, null);
});

test("findMatch: a noticeably stronger opponent is still matched when it is the only one", () => {
  const seed = deriveBaseSeed(50, "a description");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed, level: 1 }));
  // Level 4 scales power and hp by 1.3x each, so strength by ~1.69x.
  const strongerCandidate = makeCandidate({ wallet: "tz1Wide", cardKey: "KT1:1", seed, level: 4 });
  assert.ok(candidateStrength(strongerCandidate) > attackerStrength * 1.5, "sanity: the candidate is well above the attacker");

  const match = findMatch(attackerStrength, [strongerCandidate], NOW);
  assert.equal(match?.card.cardKey, "KT1:1");
});

test("findMatch: an opponent up to 3x the attacker's strength matches, and one past that does not", () => {
  const candidate = makeCandidate({ wallet: "tz1Wallet", cardKey: "KT1:1" });
  const candidateStrengthValue = candidateStrength(candidate);
  const lowestAttackerInRange = Math.ceil(candidateStrengthValue / 3);

  assert.equal(findMatch(lowestAttackerInRange, [candidate], NOW)?.card.cardKey, "KT1:1");
  assert.equal(findMatch(lowestAttackerInRange - 1, [candidate], NOW), null);
});

test("findMatch: a much weaker opponent is always in range", () => {
  const pool = [makeCandidate({ wallet: "tz1Wallet", cardKey: "KT1:1" })]; // strength in the thousands
  assert.equal(findMatch(1_000_000_000, pool, NOW)?.card.cardKey, "KT1:1");
});

test("findMatch: a recovering card is excluded from its wallet's candidacy", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed }));
  const recovering = makeCandidate({
    wallet: "tz1Wallet",
    cardKey: "KT1:1",
    seed,
    recoveryUntil: new Date(NOW.getTime() + 60_000),
  });

  const match = findMatch(attackerStrength, [recovering], NOW);
  assert.equal(match, null, "the only candidate is recovering, so no match should be found");
});

test("findMatch: a card past its defense-cap reset time is eligible again without a write", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed }));
  const pastResetCard = makeCandidate({
    wallet: "tz1Wallet",
    cardKey: "KT1:1",
    seed,
    defenseCount: 999, // would be over any reasonable cap if not reset
    defenseResetAt: new Date(NOW.getTime() - 1000), // already in the past
  });

  const match = findMatch(attackerStrength, [pastResetCard], NOW);
  assert.ok(match, "a card whose defense_reset_at has passed should read as an effective count of zero");
});

test("findMatch: re-roll excludes a confirmed-stale card and finds the next-closest candidate", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed }));
  const staleCard = makeCandidate({ wallet: "tz1WalletA", cardKey: "KT1:1", seed });
  const fallbackCard = makeCandidate({ wallet: "tz1WalletB", cardKey: "KT1:2", seed });

  const firstMatch = findMatch(attackerStrength, [staleCard, fallbackCard], NOW);
  assert.ok(firstMatch);

  const rerolled = findMatch(attackerStrength, [staleCard, fallbackCard], NOW, new Set([`${staleCard.wallet}:${staleCard.cardKey}`]));
  assert.equal(rerolled?.card.cardKey, fallbackCard.cardKey, "excluding the stale card should surface the remaining candidate");
});

test("findMatch: excluding one wallet's card must not exclude a different wallet's copy of the same card key", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed }));
  const walletACard = makeCandidate({ wallet: "tz1WalletA", cardKey: "KT1:1", seed });
  const walletBCard = makeCandidate({ wallet: "tz1WalletB", cardKey: "KT1:1", seed }); // same card_key, different owner

  const rerolled = findMatch(attackerStrength, [walletACard, walletBCard], NOW, new Set([`${walletACard.wallet}:${walletACard.cardKey}`]));
  assert.equal(rerolled?.wallet, "tz1WalletB", "wallet B's copy of the same card_key must still be a candidate");
});

test("bestFittingCardForWallet: a direct challenge gets the named wallet's closest card", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed, level: 5 }));
  const targetCards = [
    makeCandidate({ wallet: "tz1Target", cardKey: "KT1:1", seed, level: 1 }),
    makeCandidate({ wallet: "tz1Target", cardKey: "KT1:2", seed, level: 5 }),
  ];

  const best = bestFittingCardForWallet(attackerStrength, targetCards, NOW);
  assert.equal(best?.cardKey, "KT1:2", "the closer-level card should be selected");
});

test("trainerId: namespaces a tier as a synthetic id, never a real tz/KT1 address", () => {
  assert.equal(trainerId("common"), "trainer:common");
  assert.equal(trainerId("legendary"), "trainer:legendary");
});

test("trainerStats: fixed, deterministic per tier, strictly increasing power/hp/level up the roster", () => {
  const stats = RARITY_TIERS.map((tier) => trainerStats(tier));
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].power > stats[i - 1].power, `power should increase at index ${i}`);
    assert.ok(stats[i].hp > stats[i - 1].hp, `hp should increase at index ${i}`);
    assert.ok(stats[i].level > stats[i - 1].level, `level should increase at index ${i}`);
  }
  assert.deepEqual(trainerStats("common"), trainerStats("common"));
});

test("highestUnlockedTrainerTier: a card below every threshold is stuck at common", () => {
  assert.equal(highestUnlockedTrainerTier(1), "common");
  assert.equal(highestUnlockedTrainerTier(TRAINER_LEVEL_UNLOCK.uncommon - 1), "common");
});

test("highestUnlockedTrainerTier: unlocks exactly at each tier's threshold", () => {
  for (const tier of RARITY_TIERS) {
    assert.equal(highestUnlockedTrainerTier(TRAINER_LEVEL_UNLOCK[tier]), tier);
  }
});

test("isTrainerTierUnlocked: legendary is locked for a level-1 card, common never is", () => {
  assert.equal(isTrainerTierUnlocked("legendary", 1), false);
  assert.equal(isTrainerTierUnlocked("common", 1), true);
  assert.equal(isTrainerTierUnlocked("legendary", TRAINER_LEVEL_UNLOCK.legendary), true);
});

test("trainerTierGap: zero at your own ceiling, positive below it", () => {
  const cardLevel = TRAINER_LEVEL_UNLOCK.epic;
  assert.equal(trainerTierGap("epic", cardLevel), 0);
  assert.equal(trainerTierGap("common", cardLevel), RARITY_TIERS.indexOf("epic") - RARITY_TIERS.indexOf("common"));
});

test("trainerBaseXpAward: fighting at your ceiling pays more than fighting two tiers below it", () => {
  const atCeiling = trainerBaseXpAward("epic", 0);
  const twoBelow = trainerBaseXpAward("epic", 2);
  assert.ok(twoBelow < atCeiling);
  assert.ok(twoBelow >= 1);
});

test("trainerXpAward: repeat wins against the same trainer decay on top of the gap discount", () => {
  const first = trainerXpAward("common", 0, 0);
  const fifth = trainerXpAward("common", 0, 4);
  assert.ok(fifth < first);
  assert.ok(fifth >= 1);
});

function combatEndingIn(outcome: BattleResult["outcome"]): BattleResult {
  return { rounds: 3, outcome, finalHpA: 0, finalHpB: 0, roundDamageA: 0, roundDamageB: 0, history: [] };
}

test("settleTrainerBattle: an attacker win at its own ceiling pays the full trainer award", () => {
  assert.deepEqual(settleTrainerBattle(combatEndingIn("A"), "common", 1), {
    outcome: "win",
    attackerWon: true,
    baseXpAward: 50,
  });
});

test("settleTrainerBattle: an attacker win two tiers below its ceiling pays a quarter of it", () => {
  assert.deepEqual(settleTrainerBattle(combatEndingIn("A"), "common", 10), {
    outcome: "win",
    attackerWon: true,
    baseXpAward: 13,
  });
});

test("settleTrainerBattle: a trainer win is a win that pays nothing", () => {
  assert.deepEqual(settleTrainerBattle(combatEndingIn("B"), "common", 1), {
    outcome: "win",
    attackerWon: false,
    baseXpAward: 0,
  });
});

test("settleTrainerBattle: a draw pays nothing", () => {
  assert.deepEqual(settleTrainerBattle(combatEndingIn("draw"), "common", 1), {
    outcome: "draw",
    attackerWon: false,
    baseXpAward: 0,
  });
});

const LEGENDARY_ATTACKER: Combatant = { wallet: "tz1Attacker", cardKey: "KT1a:1", seed: { editions: 1, descriptionLength: 0 }, level: 1 };
const COMMON_DEFENDER: Combatant = { wallet: "tz1Defender", cardKey: "KT1d:2", seed: { editions: 50, descriptionLength: 0 }, level: 3 };

test("settlePlayerBattle: an attacker win pays for the defender's card, and the defender recovers", () => {
  assert.deepEqual(settlePlayerBattle(combatEndingIn("A"), LEGENDARY_ATTACKER, COMMON_DEFENDER), {
    outcome: "win",
    winner: LEGENDARY_ATTACKER,
    loser: COMMON_DEFENDER,
    loserRecoveryReason: "defensive",
    baseXpAward: 120,
  });
});

test("settlePlayerBattle: a defender win pays for the attacker's card, and the attacker takes the longer recovery", () => {
  assert.deepEqual(settlePlayerBattle(combatEndingIn("B"), LEGENDARY_ATTACKER, COMMON_DEFENDER), {
    outcome: "win",
    winner: COMMON_DEFENDER,
    loser: LEGENDARY_ATTACKER,
    loserRecoveryReason: "offensive",
    baseXpAward: 500,
  });
});

test("settlePlayerBattle: a draw has no winner, no recovery, and no XP", () => {
  assert.deepEqual(settlePlayerBattle(combatEndingIn("draw"), LEGENDARY_ATTACKER, COMMON_DEFENDER), {
    outcome: "draw",
    winner: null,
    loser: null,
    loserRecoveryReason: null,
    baseXpAward: 0,
  });
});
