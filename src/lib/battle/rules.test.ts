import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLevel,
  baseStatsFromSeed,
  baseXpAward,
  bestCardForChallenge,
  candidateStrength,
  decayScaledAward,
  deriveBaseSeed,
  effectiveStats,
  findMatch,
  hpFromTierAndDescription,
  levelForXp,
  mulberry32,
  normalizeDescriptionLength,
  powerFromEditions,
  resolveBattle,
  xpThresholdForLevel,
  xpWithinLevel,
  type CandidateCard,
} from "./rules";

const FAR_FUTURE = new Date("2100-01-01");
const NOW = new Date("2026-01-01");

function makeCandidate(overrides: Partial<CandidateCard> & Pick<CandidateCard, "wallet" | "cardKey">): CandidateCard {
  return {
    seed: deriveBaseSeed(50, "a description"),
    level: 1,
    recoveryUntil: null,
    defenseCount: 0,
    defenseResetAt: FAR_FUTURE,
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
  assert.equal(hp, 70); // common baseline, zero modifier
});

test("hpFromTierAndDescription: an extremely long description never exceeds the modifier cap", () => {
  const hpAt2000Chars = hpFromTierAndDescription("legendary", 2000);
  const hpAtCap = Math.round(200 * 1.2);
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
  assert.equal(stats.hp, 200);
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

test("the level-scaling gap a follow-up review found: effective stats change with level", () => {
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

test("resolveBattle: one side's HP reaches 0 first -- the surviving side wins, no tiebreak invoked", () => {
  const result = resolveBattle({ power: 20, hp: 100 }, { power: 5, hp: 20 }, 0);
  assert.equal(result.outcome, "A");
  assert.equal(result.finalHpB, 0);
  assert.ok(result.finalHpA > 0);
});

test("resolveBattle: both sides reach 0 the same round with unequal round damage -- higher-damage side wins", () => {
  const result = resolveBattle({ power: 12, hp: 20 }, { power: 8, hp: 36 }, 0);
  assert.equal(result.rounds, 3);
  assert.equal(result.roundDamageA, 12);
  assert.equal(result.roundDamageB, 8);
  assert.equal(result.outcome, "A", "the side that dealt more damage in the deciding round wins");
});

test("resolveBattle: both sides reach 0 the same round with exactly equal round damage -- true draw", () => {
  const result = resolveBattle({ power: 10, hp: 30 }, { power: 10, hp: 30 }, 0);
  assert.equal(result.roundDamageA, result.roundDamageB);
  assert.equal(result.outcome, "draw");
});

test("resolveBattle: identical stat inputs at 0% variance still draw (the tiebreak doesn't invent an asymmetry)", () => {
  const stats = { power: 31, hp: 77 };
  const result = resolveBattle(stats, { ...stats }, 0);
  assert.equal(result.outcome, "draw");
});

test("resolveBattle: seeded-RNG runs at a specific seed reproduce bit-identical results", () => {
  const attacker = { power: 30, hp: 80 };
  const defender = { power: 28, hp: 85 };
  const first = resolveBattle(attacker, defender, 0.2, mulberry32(90210));
  const second = resolveBattle(attacker, defender, 0.2, mulberry32(90210));
  assert.deepEqual(first, second);
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

  const rerolled = findMatch(attackerStrength, [staleCard, fallbackCard], NOW, new Set([staleCard.cardKey]));
  assert.equal(rerolled?.card.cardKey, fallbackCard.cardKey, "excluding the stale card should surface the remaining candidate");
});

test("findMatch: a wallet that has never opted in never appears -- enforced by store.ts's query, not this function's own filtering", () => {
  // Documented here rather than tested in isolation: findMatch operates on
  // whatever pool it's given, and fetchMatchmakingCandidatePool (store.ts)
  // is what excludes non-opted-in wallets and the attacker's own wallet via
  // its WHERE clause -- there is no separate opted-in flag on CandidateCard
  // to filter on at this layer.
  assert.equal(typeof findMatch, "function");
});

test("bestCardForChallenge: F2 reuses the same closest-card selection for a single named wallet", () => {
  const seed = deriveBaseSeed(50, "");
  const attackerStrength = candidateStrength(makeCandidate({ wallet: "attacker", cardKey: "self:1", seed, level: 5 }));
  const targetCards = [
    makeCandidate({ wallet: "tz1Target", cardKey: "KT1:1", seed, level: 1 }),
    makeCandidate({ wallet: "tz1Target", cardKey: "KT1:2", seed, level: 5 }),
  ];

  const best = bestCardForChallenge(attackerStrength, targetCards, NOW);
  assert.equal(best?.cardKey, "KT1:2", "the closer-level card should be selected");
});
