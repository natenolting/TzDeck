import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLevel,
  baseStatsFromSeed,
  deriveBaseSeed,
  effectiveStats,
  hpFromTierAndDescription,
  mulberry32,
  normalizeDescriptionLength,
  powerFromEditions,
  resolveBattle,
} from "./rules";

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
