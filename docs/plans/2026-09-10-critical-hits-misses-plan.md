# Critical Hits and Misses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give combat rounds a chance to miss (0 damage) or critically hit (multiplied damage), with both chances -- and the crit multiplier -- scaling with the acting card's level, and surface it in the animated battle log.

**Architecture:** One extra d100 roll per side per round in `resolveBattle`, gated behind a new optional `levels` parameter so every existing caller that doesn't pass it keeps today's exact behavior (byte-identical RNG consumption, no crit/miss). The two production battle routes are updated to pass levels; `resolveBattle`'s pure math, standalone balance scripts (`simulate-battles.ts`, `validate-battle-tiebreak.ts`), and every existing test that omits `levels` are therefore unaffected by construction, not by coincidence.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict`, React 19 (client components), Next.js route handlers.

**Spec:** `docs/plans/2026-09-10-critical-hits-misses-design.md`

## Global Constraints

- `critChance(level) = min(20%, 1% + 0.5% × (level-1))` -- caps at level 39.
- `critMultiplier(level) = min(3.0x, 1.5x + 0.05x × (level-1))` -- caps at level 31.
- `missChance(level) = max(1%, 10% - 0.3% × (level-1))` -- floors at level 31.
- Miss and crit share **one** d100 roll per side per round (not two independent rolls): roll `1` is always a miss; roll `> 100 - round(critChance(level)*100)` is a critical hit; everything else is a normal hit.
- A crit multiplies the *already-varied* round damage (`power × varianceSwing × critMultiplier`), it does not bypass the existing ±20% variance roll.
- When `resolveBattle` is called **without** a `levels` argument, it must behave exactly as it does today: no extra roll, no crit/miss, `resultA`/`resultB` both default to `"hit"`.
- XP awarded is unaffected by whether the winning blow was a crit -- no changes to `baseXpAward`/`decayScaledAward`.
- Use npm, matching this repository's scripts (`npm test`, `npm run lint`, `npm run build`). Read the installed Next.js guides under `node_modules/next/dist/docs/` before touching route handlers, per `AGENTS.md`.

---

## Task 1: Level-scaled crit/miss formulas

**Files:**
- Modify: `src/lib/battle/rules.ts`
- Test: `src/lib/battle/rules.test.ts`

**Interfaces:**
- Produces: `criticalHitChance(level: number): number` (fraction, e.g. `0.01`), `criticalHitMultiplier(level: number): number` (e.g. `1.5`), `missChance(level: number): number` (fraction, e.g. `0.1`) -- all exported from `src/lib/battle/rules.ts`. Task 2 calls these three functions; nothing else in this task is consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/battle/rules.test.ts`, right after the existing `applyLevel` tests (after the block ending at line 108, before `test("resolveBattle: one side's HP reaches 0 first...`):

```typescript
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
```

The top of `src/lib/battle/rules.test.ts` currently imports (alphabetically sorted):

```typescript
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
  // ...rest of the list unchanged
} from "./rules";
```

Insert the three new names in their alphabetical spots: `criticalHitChance` and `criticalHitMultiplier` between `candidateStrength` and `decayScaledAward`; `missChance` between `levelForXp` and `mulberry32`. Leave every other name in the list untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/lib/battle/rules.test.ts`
Expected: FAIL -- `criticalHitChance is not defined` (or a TypeScript import error), for all three new tests.

- [ ] **Step 3: Implement the three formulas**

In `src/lib/battle/rules.ts`, add this block immediately after `applyLevel`'s closing brace (right before the `normalizeDescriptionLength` function, so it sits alongside the other stat-derivation code):

```typescript
// ---------------------------------------------------------------------------
// Critical hits and misses (docs/plans/2026-09-10-critical-hits-misses-design.md):
// one shared d100 roll per side per round in resolveBattle, gated behind an
// optional `levels` argument there. These three formulas are pure functions
// of level, independently testable from combat resolution itself.
// ---------------------------------------------------------------------------

const CRIT_CHANCE_BASE = 0.01;
const CRIT_CHANCE_PER_LEVEL = 0.005;
const CRIT_CHANCE_CAP = 0.2;

const CRIT_MULTIPLIER_BASE = 1.5;
const CRIT_MULTIPLIER_PER_LEVEL = 0.05;
const CRIT_MULTIPLIER_CAP = 3;

const MISS_CHANCE_BASE = 0.1;
const MISS_CHANCE_PER_LEVEL = 0.003;
const MISS_CHANCE_FLOOR = 0.01;

/** Rounds to 4 decimal places so level-scaled formulas land on clean, testable values despite binary float arithmetic. */
function roundToFourDecimals(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Fraction (e.g. 0.01 = 1%). Caps at 20% at level 39. */
export function criticalHitChance(level: number): number {
  return roundToFourDecimals(Math.min(CRIT_CHANCE_CAP, CRIT_CHANCE_BASE + CRIT_CHANCE_PER_LEVEL * (level - 1)));
}

/** Multiplier applied to an already-varied round's damage on a crit. Caps at 3.0x at level 31. */
export function criticalHitMultiplier(level: number): number {
  return roundToFourDecimals(
    Math.min(CRIT_MULTIPLIER_CAP, CRIT_MULTIPLIER_BASE + CRIT_MULTIPLIER_PER_LEVEL * (level - 1)),
  );
}

/** Fraction (e.g. 0.1 = 10%). Floors at 1% at level 31 -- never reaches exactly 0%. */
export function missChance(level: number): number {
  return roundToFourDecimals(Math.max(MISS_CHANCE_FLOOR, MISS_CHANCE_BASE - MISS_CHANCE_PER_LEVEL * (level - 1)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/lib/battle/rules.test.ts`
Expected: PASS for all three new tests. Run the whole file, not just the new tests, to confirm nothing else broke: `npx tsx --test --test-concurrency=1 src/lib/battle/rules.test.ts` should show 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/battle/rules.ts src/lib/battle/rules.test.ts
git commit -m "feat(battle): add level-scaled critical hit and miss chance formulas"
```

---

## Task 2: Wire crit/miss into `resolveBattle`

**Files:**
- Modify: `src/lib/battle/rules.ts`
- Test: `src/lib/battle/rules.test.ts`

**Interfaces:**
- Consumes: `criticalHitChance`, `criticalHitMultiplier` from Task 1 (already in the same file, no import needed).
- Produces: `RoundOutcome` type (`"hit" | "critical" | "miss"`), exported from `src/lib/battle/rules.ts`. `RoundRecord` gains **optional** `resultA?: RoundOutcome` and `resultB?: RoundOutcome` fields -- `resolveBattle` itself always assigns a concrete value to both (never actually leaves them `undefined`), but the type stays optional so every existing hand-built `RoundRecord`/`BattleResult`-typed test fixture that predates this feature (e.g. `BattleResultScreen.test.tsx`'s `baseResult()`) keeps compiling without changes, matching the design spec's own stated guidance that a pre-feature stored battle response won't have these fields. `resolveBattle` gains an optional 5th parameter `levels?: { attacker: number; defender: number }`. Task 3 (routes) and Task 4 (`BattleResultScreen`) both consume `RoundOutcome` and the new `RoundRecord` fields.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/battle/rules.test.ts`, right after the existing `test("resolveBattle: seeded-RNG runs at a specific seed reproduce bit-identical results", ...)` block (after line 152):

```typescript
test("resolveBattle: without a levels argument, every round defaults to result 'hit' for both sides (crit/miss stays opt-in)", () => {
  const result = resolveBattle({ power: 20, hp: 100 }, { power: 5, hp: 20 }, 0);
  assert.ok(result.history.length > 0);
  for (const round of result.history) {
    assert.equal(round.resultA, "hit");
    assert.equal(round.resultB, "hit");
  }
});

test("resolveBattle: a roll of exactly 1 on the shared d100 is always a miss, dealing zero damage that round", () => {
  // Roll order per round: swingA, swingB, then (only when levels is given) resultA's d100, resultB's d100.
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
```

These new tests only compare string literals (`"miss"`, `"critical"`, `"hit"`) and don't reference the `RoundOutcome` type by name, so no import changes are needed beyond what Task 1 already added.

Also update the three existing `assert.deepEqual` calls in the `"resolveBattle: records a per-round history..."` test (lines 125-132) to include the new fields, since `RoundRecord` now always carries them:

```typescript
test("resolveBattle: records a per-round history with damage dealt and resulting HP for both sides", () => {
  const result = resolveBattle({ power: 12, hp: 20 }, { power: 8, hp: 36 }, 0);
  assert.equal(result.history.length, 3);
  assert.deepEqual(result.history[0], { round: 1, damageA: 12, damageB: 8, hpA: 12, hpB: 24, resultA: "hit", resultB: "hit" });
  assert.deepEqual(result.history[1], { round: 2, damageA: 12, damageB: 8, hpA: 4, hpB: 12, resultA: "hit", resultB: "hit" });
  // HP never reported negative even though the losing side's real HP went below zero internally.
  assert.deepEqual(result.history[2], { round: 3, damageA: 12, damageB: 8, hpA: 0, hpB: 0, resultA: "hit", resultB: "hit" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test --test-concurrency=1 src/lib/battle/rules.test.ts`
Expected: FAIL -- the updated `deepEqual` test fails because actual objects are missing `resultA`/`resultB`; the four new tests fail because `resolveBattle` doesn't accept a 5th argument yet and `result.history[0].resultA` is `undefined`.

- [ ] **Step 3: Implement the wiring**

In `src/lib/battle/rules.ts`, replace the `RoundRecord` interface and `resolveBattle` function (the block currently spanning from `export interface RoundRecord {` through the end of `resolveBattle`'s closing brace) with:

```typescript
export type RoundOutcome = "hit" | "critical" | "miss";

/** One round's damage exchange and the resulting HP for both sides, HP floored at 0 for display. */
export interface RoundRecord {
  round: number;
  damageA: number;
  damageB: number;
  hpA: number;
  hpB: number;
  /** resolveBattle always sets these; optional only so pre-feature stored battle responses (missing both) still type-check. */
  resultA?: RoundOutcome;
  resultB?: RoundOutcome;
}

export interface BattleResult {
  rounds: number;
  outcome: BattleOutcome;
  finalHpA: number;
  finalHpB: number;
  /** Damage each side dealt in the deciding (final) round -- what the R14 tiebreak compares. */
  roundDamageA: number;
  roundDamageB: number;
  /** Full round-by-round breakdown, for battle-log display. */
  history: RoundRecord[];
}

const MAX_ROUNDS_SAFETY = 1000;

/**
 * Rolls one shared d100 for a side's round outcome: 1 is always a miss,
 * anything above `100 - critChance%` is a critical hit, everything else is
 * a normal hit. One roll (not two independent ones) so the miss zone
 * (bottom) and crit zone (top) can never overlap by construction.
 */
function rollRoundOutcome(level: number, roll: Rng): RoundOutcome {
  const d100 = Math.floor(roll() * 100) + 1;
  if (d100 === 1) return "miss";
  const critSlots = Math.round(criticalHitChance(level) * 100);
  if (d100 > 100 - critSlots) return "critical";
  return "hit";
}

export function resolveBattle(
  attackerStats: { power: number; hp: number },
  defenderStats: { power: number; hp: number },
  variancePct: number,
  rng?: Rng,
  /** Opt-in: omitting this preserves today's exact behavior (no extra roll, always "hit"). */
  levels?: { attacker: number; defender: number },
): BattleResult {
  const roll = rng || Math.random;
  let hpA = attackerStats.hp;
  let hpB = defenderStats.hp;
  let rounds = 0;
  let roundDamageA = 0;
  let roundDamageB = 0;
  const history: RoundRecord[] = [];

  while (hpA > 0 && hpB > 0 && rounds < MAX_ROUNDS_SAFETY) {
    rounds += 1;
    const swingA = 1 + (roll() * 2 - 1) * variancePct;
    const swingB = 1 + (roll() * 2 - 1) * variancePct;
    const resultA: RoundOutcome = levels ? rollRoundOutcome(levels.attacker, roll) : "hit";
    const resultB: RoundOutcome = levels ? rollRoundOutcome(levels.defender, roll) : "hit";
    const critMultiplierA = resultA === "critical" ? criticalHitMultiplier(levels!.attacker) : 1;
    const critMultiplierB = resultB === "critical" ? criticalHitMultiplier(levels!.defender) : 1;
    roundDamageA = resultA === "miss" ? 0 : Math.max(0, attackerStats.power * swingA * critMultiplierA);
    roundDamageB = resultB === "miss" ? 0 : Math.max(0, defenderStats.power * swingB * critMultiplierB);
    hpB -= roundDamageA;
    hpA -= roundDamageB;
    history.push({
      round: rounds,
      damageA: roundDamageA,
      damageB: roundDamageB,
      hpA: Math.max(0, Math.round(hpA)),
      hpB: Math.max(0, Math.round(hpB)),
      resultA,
      resultB,
    });
  }

  let outcome: BattleOutcome;
  if (hpA <= 0 && hpB <= 0) {
    // R14: whichever side dealt more damage in the deciding round wins.
    // Only an exact numeric tie in that round's damage is a true draw.
    if (roundDamageA === roundDamageB) outcome = "draw";
    else outcome = roundDamageA > roundDamageB ? "A" : "B";
  } else if (hpB <= 0) {
    outcome = "A";
  } else if (hpA <= 0) {
    outcome = "B";
  } else {
    outcome = "draw"; // safety-cap fallback; shouldn't normally trigger
  }

  return {
    rounds,
    outcome,
    finalHpA: Math.max(0, Math.round(hpA)),
    finalHpB: Math.max(0, Math.round(hpB)),
    roundDamageA,
    roundDamageB,
    history,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test --test-concurrency=1 src/lib/battle/rules.test.ts`
Expected: PASS, all tests in the file including every pre-existing one (the ones that don't pass `levels` must still pass unmodified -- if any of them fail, the opt-in gating is broken).

- [ ] **Step 5: Verify determinism is preserved when `levels` is passed too**

This isn't a new test to write -- it's a manual sanity check. Run the full file once more and confirm `test("resolveBattle: seeded-RNG runs at a specific seed reproduce bit-identical results", ...)` still passes. It doesn't pass `levels`, so it's unaffected, but re-running confirms nothing upstream broke it.

Run: `npx tsx --test --test-concurrency=1 src/lib/battle/rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/battle/rules.ts src/lib/battle/rules.test.ts
git commit -m "feat(battle): roll critical hits and misses in resolveBattle, opt-in via a levels argument"
```

---

## Task 3: Wire the battle routes to pass levels through

**Files:**
- Modify: `src/app/api/battle/random/route.ts:234`
- Modify: `src/app/api/battle/challenge/route.ts:200`

**Interfaces:**
- Consumes: `resolveBattle`'s new optional 5th parameter from Task 2. Both routes already compute `attackerLevel: number` and have `defenderCard.level: number` available at the call site -- no new computation needed, this task only adds one argument to an existing call.
- Produces: nothing new for other tasks -- this is a leaf wiring change. `scripts/simulate-battles.ts` and `scripts/validate-battle-tiebreak.ts` call `resolveBattle` directly and do **not** pass `levels`, so they remain completely unaffected by this task (and by the whole feature) -- no changes needed there, and none are made in this plan.

- [ ] **Step 1: Update `random/route.ts`**

In `src/app/api/battle/random/route.ts`, change line 234 from:

```typescript
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)));
```

to:

```typescript
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)), {
      attacker: attackerLevel,
      defender: defenderCard.level,
    });
```

- [ ] **Step 2: Update `challenge/route.ts`**

In `src/app/api/battle/challenge/route.ts`, change line 200 (the identical line) the same way:

```typescript
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)), {
      attacker: attackerLevel,
      defender: defenderCard.level,
    });
```

- [ ] **Step 3: Run both routes' existing test suites**

These routes' combat outcomes were already nondeterministic per real request (each request draws a fresh random seed) -- existing tests that assert a specific winner rely on a large enough power/HP gap that the ±20% variance roll can't flip the outcome. The new crit/miss roll adds another source of swing on top of that, so re-run each suite a few times to catch any test whose fixture margin turns out to be too narrow now.

Run (each, 3 times in a row): `DATABASE_URL=<your local-dev URL> npx tsx --test --test-concurrency=1 src/app/api/battle/random/route.test.ts`
Run (each, 3 times in a row): `DATABASE_URL=<your local-dev URL> npx tsx --test --test-concurrency=1 src/app/api/battle/challenge/route.test.ts`

Expected: PASS every time, all three runs, both files.

If any test flakes (fails intermittently across the 3 runs): find that test's attacker/defender `power`/`hp` fixture values and widen the gap between them (e.g. double the stronger side's power) until it reliably survives a single miss or a single 3x crit on either side. Do not weaken the assertion itself -- widen the fixture instead, so the test still proves what it originally proved.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/battle/random/route.ts src/app/api/battle/challenge/route.ts
git commit -m "feat(battle): enable critical hits and misses in live battles"
```

(If Step 3 required widening any fixture, include that test file's diff in this same commit -- it's part of making this change land safely, not a separate change.)

---

## Task 4: Show hit/miss/critical in the animated battle log

**Files:**
- Modify: `src/components/BattleResultScreen.tsx`
- Test: `src/components/BattleResultScreen.test.tsx`

**Interfaces:**
- Consumes: `RoundRecord.resultA`/`resultB: RoundOutcome` from Task 2 (imported the same way `RoundRecord` already is, from `@/lib/battle/rules`).
- Produces: nothing consumed elsewhere -- this is the final, leaf UI task.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/BattleResultScreen.test.tsx`, after the existing `test("defender hits fall back to 'Opponent' while the card name is still loading...")` test (the last test in the beat-naming group):

These reuse `baseResult()`'s own existing override pattern (already used by every other test in this file) -- no new helper needed. Recall `baseResult()`'s defaults: `attackerStats: { power: 30, hp: 80 }`, `defenderStats: { power: 28, hp: 85 }`.

```typescript
test("a missed attacker beat shows a miss line, not a damage number", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({
        combat: {
          rounds: 1,
          finalHpA: 55,
          finalHpB: 85,
          history: [{ round: 1, damageA: 0, damageB: 25, hpA: 55, hpB: 85, resultA: "miss", resultB: "hit" }],
        },
      })}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/My Fighter's hit missed/), "a miss shows no damage number");
});

test("a critical defender beat is called out distinctly, with the real multiplied damage", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({
        combat: {
          rounds: 1,
          finalHpA: 20,
          finalHpB: 85,
          history: [{ round: 1, damageA: 0, damageB: 60, hpA: 20, hpB: 85, resultA: "miss", resultB: "critical" }],
        },
      })}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  await screen.findByText("Rival Card");
  assert.ok(await screen.findByText(/Rival Card countered with a CRITICAL HIT for 60/));
});

test("a normal hit's line is unaffected by the new result field", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({
        combat: {
          rounds: 1,
          finalHpA: 60,
          finalHpB: 55,
          history: [{ round: 1, damageA: 30, damageB: 20, hpA: 60, hpB: 55, resultA: "hit", resultB: "hit" }],
        },
      })}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/My Fighter hit for 30/));
});

test("a beat with no result field (a legacy stored battle) renders as a normal hit", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");
  // No resultA/resultB on this row at all -- resultA/resultB are optional
  // in RoundRecord specifically so a pre-feature stored response like this
  // still type-checks.
  const legacyResult = baseResult({
    combat: {
      rounds: 1,
      finalHpA: 52,
      finalHpB: 55,
      history: [{ round: 1, damageA: 30, damageB: 28, hpA: 52, hpB: 55 }],
    },
  });

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={legacyResult}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/My Fighter hit for 30/), "missing resultA/resultB defaults to a normal hit, not a crash");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test --test-concurrency=1 src/components/BattleResultScreen.test.tsx`
Expected: FAIL for the miss/critical/legacy tests -- the current beat line always renders as a normal hit regardless of `result`, so the miss and critical assertions find no matching text (the third test, "normal hit unaffected," will already pass since it's testing existing behavior -- that's fine, it's there as a baseline).

- [ ] **Step 3: Implement the three-way beat rendering**

In `src/components/BattleResultScreen.tsx`, add `RoundOutcome` to the existing type-only import:

```typescript
import type { RoundOutcome, RoundRecord } from "@/lib/battle/rules";
```

Change the `CombatBeat` interface (currently `round`, `side`, `damage`, `hpA`, `hpB`) to add a `result` field:

```typescript
interface CombatBeat {
  round: number;
  side: "attacker" | "defender";
  damage: number;
  hpA: number;
  hpB: number;
  result: RoundOutcome;
}
```

Change `combatBeats` to populate it, defaulting to `"hit"` for a legacy stored round that predates this feature (no `resultA`/`resultB` at all):

```typescript
function combatBeats(history: RoundRecord[] | undefined, attackerMaxHp: number, defenderMaxHp: number): CombatBeat[] {
  const beats: CombatBeat[] = [];
  let hpA = attackerMaxHp;
  let hpB = defenderMaxHp;
  for (const round of history ?? []) {
    beats.push({
      round: round.round,
      side: "attacker",
      damage: round.damageA,
      hpA,
      hpB: round.hpB,
      result: round.resultA ?? "hit",
    });
    hpB = round.hpB;
    beats.push({
      round: round.round,
      side: "defender",
      damage: round.damageB,
      hpA: round.hpA,
      hpB,
      result: round.resultB ?? "hit",
    });
    hpA = round.hpA;
  }
  return beats;
}
```

Replace the beat-log rendering block (the `<div className="mt-6 flex-1 ...">` containing the `beats.slice(0, revealedBeats).map(...)`) with:

```tsx
        <div className="mt-6 flex-1 space-y-1.5 overflow-y-auto rounded-xl border border-border-default bg-surface-1/60 p-3">
          {beats.slice(0, revealedBeats).map((beat, index) => {
            const name = beat.side === "attacker" ? attackerCard.name : (defenderCard?.name ?? "Opponent");
            if (beat.result === "miss") {
              return (
                <p key={index} className="text-xs italic text-text-tertiary">
                  {beat.side === "attacker" ? `${name}'s hit missed!` : `${name}'s counter missed!`}
                </p>
              );
            }
            if (beat.result === "critical") {
              return (
                <p key={index} className="text-xs font-bold text-accent">
                  {beat.side === "attacker"
                    ? `${name} landed a CRITICAL HIT for ${Math.round(beat.damage)}!`
                    : `${name} countered with a CRITICAL HIT for ${Math.round(beat.damage)}!`}
                </p>
              );
            }
            return (
              <p key={index} className="text-xs text-text-secondary">
                {beat.side === "attacker"
                  ? `${name} hit for ${Math.round(beat.damage)}!`
                  : `${name} hit back for ${Math.round(beat.damage)}!`}
              </p>
            );
          })}
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test --test-concurrency=1 src/components/BattleResultScreen.test.tsx`
Expected: PASS, all tests in the file (including every pre-existing beat-naming/HP-draining/outcome test -- none of them set `resultA`/`resultB`, so they all exercise the `?? "hit"` default path and must still render exactly as before).

- [ ] **Step 5: Also run `BattlePanel.test.tsx`**

`BattlePanel.test.tsx`'s own `battleWinJson()` fixture has the same shape as the "legacy" fixture in Step 1 (no `resultA`/`resultB`) and feeds into this same component via the real `BattlePanel` -> `BattleResultScreen` mount. Confirm it still passes unchanged.

Run: `npx tsx --test --test-concurrency=1 src/components/BattlePanel.test.tsx`
Expected: PASS, all tests, no changes needed to that file.

- [ ] **Step 6: Commit**

```bash
git add src/components/BattleResultScreen.tsx src/components/BattleResultScreen.test.tsx
git commit -m "feat(battle): show misses and critical hits in the animated battle log"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npx eslint src/lib/battle/rules.ts src/lib/battle/rules.test.ts src/app/api/battle/random/route.ts src/app/api/battle/challenge/route.ts src/components/BattleResultScreen.tsx src/components/BattleResultScreen.test.tsx`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test` (with `DATABASE_URL` and the other `.env.local` battle vars present in the environment -- see `.env.local`).
Expected: every test passes except the two pre-existing, unrelated DB-contamination failures already tracked from this session (`participation: a failure saving the response rolls back participation and promotion` and `POST /api/battle/random: no eligible opponent returns a clean no_match result, no allowance consumed`) -- if any *other* test fails, stop and fix it before proceeding; do not proceed with a new failure.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: builds cleanly.

- [ ] **Step 5: Live smoke check in the browser**

Start the dev server (`npm run dev`), connect a wallet with at least one battle-eligible card, and trigger a battle. Since crit/miss is a 1-20% chance per round depending on level, a single real battle may not show one -- to *reliably* see all three states without waiting on luck, temporarily patch `window.fetch` in the browser console (or via the `claude-in-chrome` `javascript_tool` if using that workflow) to intercept `/api/battle/random` and return a hand-built response whose `combat.history` rows use `resultA`/`resultB: "critical"` and `"miss"`, matching the shape from Task 4's tests. Confirm:
  - A miss round shows the italic "...'s hit missed!" line with no damage number.
  - A critical round shows the bold, accent-colored "...landed/countered with a CRITICAL HIT for N!" line.
  - A normal round is visually unchanged from before this feature.

Revert the fetch patch (reload the page) once confirmed -- it's a manual verification step, not something to leave in place or commit.

- [ ] **Step 6: Update the design doc's status**

In `docs/plans/2026-09-10-critical-hits-misses-design.md`, change the `Status:` line at the top from "designed and approved in chat (numbers confirmed); not yet implemented." to "implemented -- see commits on `feat/pvp-battle-system` from this plan."

```bash
git add docs/plans/2026-09-10-critical-hits-misses-design.md
git commit -m "docs: mark critical hits and misses design as implemented"
```
