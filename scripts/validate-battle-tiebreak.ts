// U5's own acceptance run: measures the R14 overkill tiebreak's actual effect
// against the origin document's proposed success targets, using the real
// production combat resolver (not a copy). Reports seed, population, sample
// count, and results -- per the plan's Verification requirement, this is a
// measurement, not an assumption from analysis alone.
//
// Run: npm run validate:tiebreak
import {
  applyLevel,
  baseStatsFromSeed,
  deriveBaseSeed,
  mulberry32,
  resolveBattle,
  type Rng,
} from "../src/lib/battle/rules";
import type { CardRarity } from "../src/lib/objkt";

const SEED = 90210;
const TRIALS_PER_CELL = 3000;
const VARIANCE_LEVELS = [0, 0.1, 0.2, 0.3];

interface Card {
  power: number;
  hp: number;
  level: number;
  tier: CardRarity;
}

function makeCard(editions: number, descriptionLength: number, level: number): Card {
  const seed = deriveBaseSeed(editions, "x".repeat(descriptionLength));
  const base = baseStatsFromSeed(seed);
  const { power, hp } = applyLevel(base.power, base.hp, level);
  return { power, hp, level, tier: base.tier };
}

function runDrawRate(cardA: Card, cardB: Card, variance: number, rng: Rng, trials: number): number {
  let draws = 0;
  for (let i = 0; i < trials; i += 1) {
    const result = resolveBattle(cardA, cardB, variance, rng);
    if (result.outcome === "draw") draws += 1;
  }
  return draws / trials;
}

// --- Target 1: near-identical / control-pool-style matchup draw rate -------
console.log("\n=== Near-identical matchup draw rate (post-tiebreak) ===");
console.log(`Card: editions=5, descriptionLength=120, level=1 (tier: rare) vs. an identical clone`);
console.log(`Seed: ${SEED}, trials/cell: ${TRIALS_PER_CELL}`);
{
  const rng = mulberry32(SEED);
  const cardA = makeCard(5, 120, 1);
  const cardB = makeCard(5, 120, 1);
  for (const variance of VARIANCE_LEVELS) {
    const drawRate = runDrawRate(cardA, cardB, variance, rng, TRIALS_PER_CELL);
    console.log(`  variance ±${(variance * 100).toFixed(0)}%: ${(drawRate * 100).toFixed(1)}% draws`);
  }
}

// --- Target 2: stronger-card advantage -------------------------------------
// "at least 5 levels and one full rarity tier above its opponent wins at
// least 90% of the time" -- deliberately short of 100%.
console.log("\n=== Stronger-card advantage (>=5 levels, one full tier above) ===");
{
  const rng = mulberry32(SEED + 1);
  const strong = makeCard(5, 120, 6); // rare tier, level 6
  const weak = makeCard(50, 20, 1); // uncommon tier, level 1
  console.log(`Strong: tier=${strong.tier} level=${strong.level} power=${strong.power} hp=${strong.hp}`);
  console.log(`Weak:   tier=${weak.tier} level=${weak.level} power=${weak.power} hp=${weak.hp}`);
  for (const variance of VARIANCE_LEVELS) {
    let strongWins = 0;
    for (let i = 0; i < TRIALS_PER_CELL; i += 1) {
      const result = resolveBattle(strong, weak, variance, rng);
      if (result.outcome === "A") strongWins += 1;
    }
    const winRate = strongWins / TRIALS_PER_CELL;
    const target = 0.9;
    const status = winRate >= target ? "OK" : "BELOW TARGET";
    console.log(`  variance ±${(variance * 100).toFixed(0)}%: ${(winRate * 100).toFixed(1)}% strong-side wins [${status}]`);
  }
}

// --- Target 3/4: random-population draw rate & new-player accessibility ----
// A minimal, self-contained population + Power x HP proximity search --
// exercising the same production rules.ts functions U7's real matchmaking
// will call, not a duplicate of U7 itself (which doesn't exist yet).
console.log("\n=== Random-population draw rate & new-player first-win-within-5 ===");
{
  const rng = mulberry32(SEED + 2);
  const POPULATION_SIZE = 200;

  function randomEditions(): number {
    const roll = rng();
    if (roll < 0.05) return 1;
    if (roll < 0.15) return 2 + Math.floor(rng() * 4);
    if (roll < 0.35) return 6 + Math.floor(rng() * 20);
    if (roll < 0.7) return 26 + Math.floor(rng() * 75);
    return 101 + Math.floor(rng() * 4900);
  }

  function randomLevel(): number {
    return 1 + Math.floor(rng() * 20);
  }

  const population: Card[] = Array.from({ length: POPULATION_SIZE }, () =>
    makeCard(randomEditions(), Math.floor(rng() * 400), randomLevel()),
  );

  function strength(card: Card): number {
    return card.power * card.hp;
  }

  function findClosestOpponent(attacker: Card, pool: Card[]): Card {
    const target = strength(attacker);
    return pool.reduce((closest, candidate) =>
      Math.abs(strength(candidate) - target) < Math.abs(strength(closest) - target) ? candidate : closest,
    );
  }

  for (const variance of VARIANCE_LEVELS) {
    let draws = 0;
    const battlesRun = POPULATION_SIZE;
    for (let i = 0; i < battlesRun; i += 1) {
      const attacker = population[i];
      const pool = population.filter((_, idx) => idx !== i);
      const opponent = findClosestOpponent(attacker, pool);
      const result = resolveBattle(attacker, opponent, variance, rng);
      if (result.outcome === "draw") draws += 1;
    }
    console.log(`  variance ±${(variance * 100).toFixed(0)}%: ${((draws / battlesRun) * 100).toFixed(1)}% draws (target: <=20%)`);
  }

  // New-player accessibility: a fresh Level-1 Common card's win rate within
  // its first 5 completed battles against this same mixed population.
  const newPlayerVariance = 0.2;
  let winsWithin5 = 0;
  const NEW_PLAYER_TRIALS = 500;
  for (let i = 0; i < NEW_PLAYER_TRIALS; i += 1) {
    const newCard = makeCard(300 + Math.floor(rng() * 4000), Math.floor(rng() * 100), 1);
    let wonAtLeastOnce = false;
    for (let battle = 0; battle < 5; battle += 1) {
      const opponent = findClosestOpponent(newCard, population);
      const result = resolveBattle(newCard, opponent, newPlayerVariance, rng);
      if (result.outcome === "A") {
        wonAtLeastOnce = true;
        break;
      }
    }
    if (wonAtLeastOnce) winsWithin5 += 1;
  }
  const accessibilityRate = winsWithin5 / NEW_PLAYER_TRIALS;
  const status = accessibilityRate >= 0.5 ? "OK" : "BELOW TARGET";
  console.log(
    `\nNew-player first-win-within-5 (variance ±${(newPlayerVariance * 100).toFixed(0)}%, mixed-levels population): ` +
      `${(accessibilityRate * 100).toFixed(1)}% [${status}] (target: >=50%)`,
  );
}

console.log("\nDone. Investigate any [BELOW TARGET] result before treating the tiebreak as validated.");
