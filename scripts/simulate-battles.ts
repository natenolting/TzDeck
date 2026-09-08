// Ad-hoc battle simulator: run N trials through the real production combat
// resolver (rules.ts's resolveBattle) and report aggregate outcomes.
// Distinct from scripts/validate-battle-tiebreak.ts, which is U5's fixed
// acceptance run against specific origin-document targets -- this is a
// general-purpose tool for exploring arbitrary matchups and populations.
//
// Run: npm run simulate -- [trials] [flags]
//   npm run simulate -- 5000
//   npm run simulate -- 2000 --a-editions=5 --a-desc=120 --a-level=6 --b-editions=50 --b-desc=20 --b-level=1
//   npm run simulate -- 10000 --variance=0.3 --seed=42 --csv=out.csv
//
// A side's editions/desc/level defaults to a random draw per trial (same
// distribution as validate-battle-tiebreak.ts's population) when not fixed
// via flags, so the default invocation simulates two freshly-rolled cards
// meeting each trial rather than one fixed matchup repeated N times.
import { writeFileSync } from "node:fs";
import {
  applyLevel,
  baseStatsFromSeed,
  deriveBaseSeed,
  mulberry32,
  resolveBattle,
  type Rng,
} from "../src/lib/battle/rules";
import type { CardRarity } from "../src/lib/objkt";

interface Flags {
  trials: number;
  aEditions?: number;
  aDesc?: number;
  aLevel: number;
  bEditions?: number;
  bDesc?: number;
  bLevel: number;
  variance: number;
  seed: number;
  csvPath?: string;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { trials: 1000, aLevel: 1, bLevel: 1, variance: 0.2, seed: Date.now() };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    const [key, value] = arg.startsWith("--") ? arg.slice(2).split("=") : [arg, undefined];
    if (!arg.startsWith("--")) {
      flags.trials = Number(arg);
      continue;
    }
    switch (key) {
      case "trials": flags.trials = Number(value); break;
      case "a-editions": flags.aEditions = Number(value); break;
      case "a-desc": flags.aDesc = Number(value); break;
      case "a-level": flags.aLevel = Number(value); break;
      case "b-editions": flags.bEditions = Number(value); break;
      case "b-desc": flags.bDesc = Number(value); break;
      case "b-level": flags.bLevel = Number(value); break;
      case "variance": flags.variance = Number(value); break;
      case "seed": flags.seed = Number(value); break;
      case "csv": flags.csvPath = value; break;
      default:
        console.error(`Unknown flag: --${key}`);
        printUsage();
        process.exit(1);
    }
  }
  if (!Number.isFinite(flags.trials) || flags.trials <= 0) {
    console.error("trials must be a positive number");
    printUsage();
    process.exit(1);
  }
  return flags;
}

function printUsage(): void {
  console.log(`Usage: npm run simulate -- [trials] [flags]

  trials           number of battles to run (default: 1000)
  --a-editions=N    fix attacker's edition count (default: random per trial)
  --a-desc=N        fix attacker's description length in chars (default: random per trial)
  --a-level=N       fix attacker's level (default: 1)
  --b-editions=N    fix defender's edition count (default: random per trial)
  --b-desc=N        fix defender's description length in chars (default: random per trial)
  --b-level=N       fix defender's level (default: 1)
  --variance=PCT    combat variance, 0-1 (default: 0.2, matching production COMBAT_VARIANCE)
  --seed=N          RNG seed, for reproducible runs (default: current time)
  --csv=PATH        also write one row per trial to this CSV file`);
}

// Same distribution as validate-battle-tiebreak.ts's random population, so
// results are comparable across both scripts.
function randomEditions(rng: Rng): number {
  const roll = rng();
  if (roll < 0.05) return 1;
  if (roll < 0.15) return 2 + Math.floor(rng() * 4);
  if (roll < 0.35) return 6 + Math.floor(rng() * 20);
  if (roll < 0.7) return 26 + Math.floor(rng() * 75);
  return 101 + Math.floor(rng() * 4900);
}

interface RolledCard {
  power: number;
  hp: number;
  editions: number;
  descLength: number;
  level: number;
  tier: CardRarity;
}

function rollCard(fixedEditions: number | undefined, fixedDesc: number | undefined, level: number, rng: Rng): RolledCard {
  const editions = fixedEditions ?? randomEditions(rng);
  const descLength = fixedDesc ?? Math.floor(rng() * 400);
  const seed = deriveBaseSeed(editions, "x".repeat(descLength));
  const base = baseStatsFromSeed(seed);
  const { power, hp } = applyLevel(base.power, base.hp, level);
  return { power, hp, editions, descLength, level, tier: base.tier };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const rng = mulberry32(flags.seed);

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  const rounds: number[] = [];
  const powerA: number[] = [];
  const powerB: number[] = [];
  const hpA: number[] = [];
  const hpB: number[] = [];
  const csvRows: string[] = flags.csvPath
    ? ["trial,a_editions,a_desc,a_level,a_power,a_hp,b_editions,b_desc,b_level,b_power,b_hp,outcome,rounds"]
    : [];

  for (let trial = 1; trial <= flags.trials; trial += 1) {
    const cardA = rollCard(flags.aEditions, flags.aDesc, flags.aLevel, rng);
    const cardB = rollCard(flags.bEditions, flags.bDesc, flags.bLevel, rng);
    const result = resolveBattle(cardA, cardB, flags.variance, rng);

    if (result.outcome === "A") winsA += 1;
    else if (result.outcome === "B") winsB += 1;
    else draws += 1;
    rounds.push(result.rounds);
    powerA.push(cardA.power);
    powerB.push(cardB.power);
    hpA.push(cardA.hp);
    hpB.push(cardB.hp);

    if (flags.csvPath) {
      csvRows.push(
        [trial, cardA.editions, cardA.descLength, cardA.level, cardA.power, cardA.hp,
          cardB.editions, cardB.descLength, cardB.level, cardB.power, cardB.hp,
          result.outcome, result.rounds].join(","),
      );
    }
  }

  if (flags.csvPath) {
    writeFileSync(flags.csvPath, csvRows.join("\n") + "\n");
  }

  const pct = (n: number) => `${((n / flags.trials) * 100).toFixed(1)}%`;
  console.log(`\n${flags.trials} trials, seed ${flags.seed}, variance ±${(flags.variance * 100).toFixed(0)}%`);
  console.log(`  A: editions=${flags.aEditions ?? "random"} desc=${flags.aDesc ?? "random"} level=${flags.aLevel}`);
  console.log(`  B: editions=${flags.bEditions ?? "random"} desc=${flags.bDesc ?? "random"} level=${flags.bLevel}`);
  console.log("\nResults:");
  console.log(`  A wins:  ${winsA} (${pct(winsA)})`);
  console.log(`  B wins:  ${winsB} (${pct(winsB)})`);
  console.log(`  Draws:   ${draws} (${pct(draws)})`);
  console.log(`  Avg rounds: ${mean(rounds).toFixed(2)}`);
  console.log(`  Avg A Power/HP: ${mean(powerA).toFixed(1)} / ${mean(hpA).toFixed(1)}`);
  console.log(`  Avg B Power/HP: ${mean(powerB).toFixed(1)} / ${mean(hpB).toFixed(1)}`);
  if (flags.csvPath) console.log(`\nPer-trial rows written to ${flags.csvPath}`);
}

main();
