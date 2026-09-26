import { calculateSupplyRarity, RARITY_THRESHOLDS, RARITY_TIERS, type CardRarity } from "@/lib/rarity";

// ---------------------------------------------------------------------------
// U4: card stat derivation (Power/HP), ported directly from the validated
// prototype (docs/brainstorms/battle-system-combat-prototype.html) rather
// than redesigned. Power is untouched from that port; TIER_HP_BASELINE and
// HP_FLOOR are calibrated (scripts/simulate-battles.ts) to an ~5-round
// average fight between two random level-1 cards -- the original values
// (legendary=200 ... common=70, floor=50) averaged 2.07 rounds, over
// nearly every matchup decided in round 1 or 2. That calibration ran before
// crits and misses existed. Re-measured with them on 2026-09-25 (5,000
// random matchups, seed 132), the average fight lasts 5.36 rounds at level
// 1, 5.14 at level 10, 4.67 at level 20 and 3.97 at level 39. Level scaling
// preserves the HP:Power ratio, but crit chance grows with level, so
// high-level fights run shorter. A large rarity gap still resolves in ~2-3
// rounds rather than the flat 1 round it did before -- still a clear, fast
// stomp relative to an ~5-round even fight, just no longer instant.
// ---------------------------------------------------------------------------

export interface BaseSeed {
  editions: number;
  descriptionLength: number;
}

const POWER_MIN = 10;
const POWER_MAX = 100;

/** Monotonically decreasing continuous function of edition scarcity, floored. */
export function powerFromEditions(editions: number): number {
  const decay = 1 + Math.log10(Math.max(1, editions));
  return Math.round(POWER_MIN + (POWER_MAX - POWER_MIN) / decay);
}

const TIER_HP_BASELINE: Record<CardRarity, number> = {
  legendary: 600,
  epic: 480,
  rare: 360,
  uncommon: 270,
  common: 210,
};

const DESC_MODIFIER_CAP = 0.2;
const DESC_DECAY_CHARS = 200;
const HP_FLOOR = 150;

/**
 * Rarity-tier baseline + a bounded, diminishing-returns modifier from
 * normalized description length. Bounding the modifier (rather than a raw,
 * uncapped mapping) prevents a creator from maximizing HP by padding a
 * description -- an OBJKT description is fully creator-controlled, unlike
 * WikiGacha's collaboratively-maintained Wikipedia article length.
 */
export function hpFromTierAndDescription(tier: CardRarity, descriptionLength: number): number {
  const normalized = Math.max(0, descriptionLength || 0);
  const modifier = DESC_MODIFIER_CAP * (1 - Math.exp(-normalized / DESC_DECAY_CHARS));
  const baseline = TIER_HP_BASELINE[tier];
  return Math.max(HP_FLOOR, Math.round(baseline * (1 + modifier)));
}

const PER_LEVEL_BONUS = 0.1;

/**
 * A card's *effective* Power/HP used in combat -- layered on top of the
 * base_seed-derived base stats, not a replacement for them. base_seed stays
 * fixed per card; level is the one input that changes turn-to-turn.
 */
export function applyLevel(
  basePower: number,
  baseHp: number,
  level: number,
): { power: number; hp: number } {
  const multiplier = 1 + PER_LEVEL_BONUS * (level - 1);
  return { power: Math.round(basePower * multiplier), hp: Math.round(baseHp * multiplier) };
}

// ---------------------------------------------------------------------------
// Critical hits and misses (docs/plans/2026-09-10-critical-hits-misses-design.md):
// one shared d100 roll per side per round in resolveBattle, scaled by each
// side's level. These three formulas are pure functions of level,
// independently testable from combat resolution itself.
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

/**
 * Whitespace collapsing and markup stripping so a description's *content*
 * length is what feeds HP, not incidental formatting characters.
 */
export function normalizeDescriptionLength(description?: string | null): number {
  if (!description) return 0;
  const stripped = description
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length;
}

/**
 * How long a card rests after losing a battle it started. The database is
 * authoritative: commit_battle and commit_trainer_battle each hard-code it
 * as v_offensive_recovery. This copy is only for telling players the number
 * (the demo battle's loss message); recoveryParity.test.ts reads the latest
 * migrations and fails if the two disagree.
 */
export const OFFENSIVE_RECOVERY_HOURS: number = 4;

/**
 * Stands in for an edition count upstream couldn't give: deep in the Common
 * tier, so an unknown card is never rewarded as scarce. The server seeds
 * battles with it (holdings.ts); anything simulating a fight in the browser
 * uses the same value so the two can't disagree.
 */
export const UNKNOWN_EDITIONS_FALLBACK = 100_000;

/** Captured once, the first time a card's progress row is created (Key Technical Decisions). */
export function deriveBaseSeed(editions: number, description?: string | null): BaseSeed {
  return {
    editions: Math.max(1, Math.trunc(editions)),
    descriptionLength: normalizeDescriptionLength(description),
  };
}

export function baseStatsFromSeed(seed: BaseSeed): { power: number; hp: number; tier: CardRarity } {
  const tier = calculateSupplyRarity(seed.editions);
  return {
    power: powerFromEditions(seed.editions),
    hp: hpFromTierAndDescription(tier, seed.descriptionLength),
    tier,
  };
}

export function effectiveStats(seed: BaseSeed, level: number): { power: number; hp: number } {
  const base = baseStatsFromSeed(seed);
  return applyLevel(base.power, base.hp, level);
}

// ---------------------------------------------------------------------------
// U5: combat resolution -- round-by-round simultaneous damage exchange, ported
// directly from the prototype's `resolveBattleWithVariance`, plus the new
// R14 overkill-margin tiebreak (genuinely new code, no prior empirical
// validation -- see scripts/validate-battle-tiebreak.ts for U5's own
// acceptance run against the origin's proposed success targets).
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Deterministic PRNG, ported from the prototype, for fully reproducible tests. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BattleOutcome = "A" | "B" | "draw";

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

/** Every battle route resolves combat with this damage swing, ± as a fraction of Power. */
export const COMBAT_VARIANCE = 0.2;

/** Recorded with every committed battle, so a stored result names the rules it was fought under. */
export const RULES_VERSION = "v1";

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
  roll: Rng,
  levels: { attacker: number; defender: number },
): BattleResult {
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
    const resultA = rollRoundOutcome(levels.attacker, roll);
    const resultB = rollRoundOutcome(levels.defender, roll);
    const critMultiplierA = resultA === "critical" ? criticalHitMultiplier(levels.attacker) : 1;
    const critMultiplierB = resultB === "critical" ? criticalHitMultiplier(levels.defender) : 1;
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

// ---------------------------------------------------------------------------
// U6: XP award and leveling. No prototype precedent (the simulator only
// covered combat/matching) -- new design, structure fixed per the origin's
// rationale (scales with opponent strength, decreasing marginal reward for
// weaker opponents), exact curve is a tuning placeholder.
// ---------------------------------------------------------------------------

const RARITY_XP_WEIGHT: Record<CardRarity, number> = {
  common: 1,
  uncommon: 1.5,
  rare: 2.25,
  epic: 3.5,
  legendary: 5,
};

const BASE_XP_AWARD = 100;
const XP_PER_OPPONENT_LEVEL = 0.1;

/** XP for defeating a given opponent, before the R20 anti-farming decay multiplier. */
export function baseXpAward(opponentTier: CardRarity, opponentLevel: number): number {
  const weight = RARITY_XP_WEIGHT[opponentTier];
  return Math.round(BASE_XP_AWARD * weight * (1 + (opponentLevel - 1) * XP_PER_OPPONENT_LEVEL));
}

const DECAY_RATE = 0.5;
const DECAY_FLOOR_MULTIPLIER = 0.1;

/**
 * R20's anti-farming multiplier, as a pure function of the current rolling
 * win count for this (winner, loser) pair -- U8's commit function computes
 * `decayCount` from `battle_log` inside the same locked transaction and
 * calls the equivalent of this formula in SQL; this export exists as the
 * shared reference implementation the SQL must match (parity fixtures).
 */
export function decayScaledAward(baseAward: number, decayCount: number): number {
  const multiplier = Math.max(DECAY_FLOOR_MULTIPLIER, Math.pow(DECAY_RATE, decayCount));
  return Math.max(1, Math.round(baseAward * multiplier));
}

/** xp is a lifetime cumulative total (Key Technical Decisions); level is always re-derived from it. */
export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round((100 * (level - 1) * level) / 2);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpThresholdForLevel(level + 1) <= xp) {
    level += 1;
  }
  return level;
}

/** XP earned within the current level, for display -- never stored separately. */
export function xpWithinLevel(xp: number): number {
  return xp - xpThresholdForLevel(levelForXp(xp));
}

// ---------------------------------------------------------------------------
// Battle trainers: a fixed NPC roster, one per rarity tier, fought instead of
// a real wallet's card. See docs/brainstorms/2026-09-15-battle-trainers-design.md.
// ---------------------------------------------------------------------------

/** Level a card must reach before it can challenge this tier's trainer. Tuning placeholder. */
export const TRAINER_LEVEL_UNLOCK: Record<CardRarity, number> = {
  common: 1,
  uncommon: 5,
  rare: 10,
  epic: 20,
  legendary: 35,
};

/**
 * Trainers have no real NFT, so there's no seed to derive stats from --
 * these representative edition counts feed the existing baseStatsFromSeed
 * formula purely to produce a fixed, sensible stat block per tier. Each is
 * the most editions a card can have and still grade into that tier on the
 * supply ladder. Common has no ceiling, so it takes a plainly common count.
 */
const TRAINER_REPRESENTATIVE_EDITIONS: Record<CardRarity, number> = {
  legendary: 1,
  epic: RARITY_THRESHOLDS.epicEditions,
  rare: RARITY_THRESHOLDS.supplyRareEditions,
  uncommon: RARITY_THRESHOLDS.uncommonEditions,
  common: 100,
};

const TRAINER_XP_DISCOUNT = 0.5;

export function trainerId(tier: CardRarity): string {
  return `trainer:${tier}`;
}

export interface TrainerStats {
  power: number;
  hp: number;
  level: number;
}

/** Fixed per tier -- same trainer, same stats, every time. Not derived from a real card's seed. */
export function trainerStats(tier: CardRarity): TrainerStats {
  const seed: BaseSeed = { editions: TRAINER_REPRESENTATIVE_EDITIONS[tier], descriptionLength: 0 };
  const level = TRAINER_LEVEL_UNLOCK[tier];
  const { power, hp } = effectiveStats(seed, level);
  return { power, hp, level };
}

/** The highest trainer tier a card at this level may challenge. */
export function highestUnlockedTrainerTier(cardLevel: number): CardRarity {
  let unlocked: CardRarity = "common";
  for (const tier of RARITY_TIERS) {
    if (TRAINER_LEVEL_UNLOCK[tier] <= cardLevel) unlocked = tier;
  }
  return unlocked;
}

export function isTrainerTierUnlocked(tier: CardRarity, cardLevel: number): boolean {
  return RARITY_TIERS.indexOf(tier) <= RARITY_TIERS.indexOf(highestUnlockedTrainerTier(cardLevel));
}

/** Always >= 0: a player can never choose a tier above what's unlocked. */
export function trainerTierGap(tier: CardRarity, cardLevel: number): number {
  const ceiling = highestUnlockedTrainerTier(cardLevel);
  return RARITY_TIERS.indexOf(ceiling) - RARITY_TIERS.indexOf(tier);
}

/**
 * Pre-repeat-decay trainer XP: the existing baseXpAward weight, discounted
 * flat (trainers are never the optimal grind vs. PvP of the same tier), then
 * reduced by the same decay shape repeat-win decay uses -- fighting well
 * below your unlocked ceiling pays little, without a hard access block. This
 * is exactly what the route passes to commit_trainer_battle as
 * p_base_xp_award; the SQL function applies only the repeat-win stage.
 */
export function trainerBaseXpAward(tier: CardRarity, gap: number): number {
  const base = Math.round(baseXpAward(tier, TRAINER_LEVEL_UNLOCK[tier]) * TRAINER_XP_DISCOUNT);
  return decayScaledAward(base, gap);
}

/** A wallet's card as a battle side, whichever side it is on. */
export interface Combatant {
  wallet: string;
  cardKey: string;
  seed: BaseSeed;
  level: number;
}

export type PlayerSettlement =
  | { outcome: "draw"; winner: null; loser: null; loserRecoveryReason: null; baseXpAward: 0 }
  | {
      outcome: "win";
      winner: Combatant;
      loser: Combatant;
      /** An attacker who loses recovers longer than a defender who loses. */
      loserRecoveryReason: "offensive" | "defensive";
      /** Before repeat-win decay, which commit_battle applies. */
      baseXpAward: number;
    };

/** What a resolved battle between two wallets commits. The winner earns XP for the card it beat, and the loser recovers. */
export function settlePlayerBattle(combat: BattleResult, attacker: Combatant, defender: Combatant): PlayerSettlement {
  if (combat.outcome === "draw") {
    return { outcome: "draw", winner: null, loser: null, loserRecoveryReason: null, baseXpAward: 0 };
  }
  const attackerWon = combat.outcome === "A";
  const [winner, loser] = attackerWon ? [attacker, defender] : [defender, attacker];
  return {
    outcome: "win",
    winner,
    loser,
    loserRecoveryReason: attackerWon ? "defensive" : "offensive",
    baseXpAward: baseXpAward(calculateSupplyRarity(loser.seed.editions), loser.level),
  };
}

export interface TrainerSettlement {
  outcome: "win" | "draw";
  attackerWon: boolean;
  /** Before repeat-win decay, which commit_trainer_battle applies. Zero unless the attacker won. */
  baseXpAward: number;
}

/** What a resolved trainer battle commits. A trainer never earns XP, so only an attacker win pays. */
export function settleTrainerBattle(combat: BattleResult, tier: CardRarity, attackerLevel: number): TrainerSettlement {
  const attackerWon = combat.outcome === "A";
  return {
    outcome: combat.outcome === "draw" ? "draw" : "win",
    attackerWon,
    baseXpAward: attackerWon ? trainerBaseXpAward(tier, trainerTierGap(tier, attackerLevel)) : 0,
  };
}

/** Full reference formula (both decay stages) -- for tests/parity only; the route never calls this directly. */
export function trainerXpAward(tier: CardRarity, gap: number, recentWinsAgainstThisTrainer: number): number {
  return decayScaledAward(trainerBaseXpAward(tier, gap), recentWinsAgainstThisTrainer);
}

// ---------------------------------------------------------------------------
// U7: matchmaking -- candidate pool reduction and Power x HP closest-strength search.
// Pure math only; store.ts's query returns the full eligible pool (no
// product-based SQL filter, since stats are derived from base_seed on read,
// not a stored sortable column).
// ---------------------------------------------------------------------------

export interface CandidateCard extends Combatant {
  recoveryUntil: Date | null;
  defenseCount: number;
  defenseResetAt: Date;
  /** The progress row version a commit against this card expects. */
  progressVersion: string;
}

const DEFENSE_CAP_MAX = 20; // tuning placeholder (Open Questions: exact daily cap values)

/** combined Power x HP -- the matchmaking similarity metric (R15/R16, Key Technical Decisions). */
export function strength(power: number, hp: number): number {
  return power * hp;
}

export function candidateStrength(card: CandidateCard): number {
  const stats = effectiveStats(card.seed, card.level);
  return strength(stats.power, stats.hp);
}

function isCurrentlyEligible(card: CandidateCard, now: Date): boolean {
  if (card.recoveryUntil && card.recoveryUntil > now) return false;
  const effectiveDefenseCount = card.defenseResetAt <= now ? 0 : card.defenseCount;
  return effectiveDefenseCount < DEFENSE_CAP_MAX;
}

interface Fit {
  card: CandidateCard;
  strength: number;
  distance: number;
}

/** The first of the closest fits, so ties go to whichever came first. */
function closest(fits: Fit[]): Fit | null {
  let best: Fit | null = null;
  for (const fit of fits) {
    if (!best || fit.distance < best.distance) best = fit;
  }
  return best;
}

function closestEligible(attackerStrength: number, cards: CandidateCard[], now: Date): Fit | null {
  return closest(
    cards
      .filter((card) => isCurrentlyEligible(card, now))
      .map((card) => {
        const cardStrength = candidateStrength(card);
        return { card, strength: cardStrength, distance: Math.abs(cardStrength - attackerStrength) };
      }),
  );
}

/** Whichever of a wallet's eligible cards has the closest Power x HP product to the attacker's -- not necessarily its strongest card. */
export function bestFittingCardForWallet(
  attackerStrength: number,
  walletCards: CandidateCard[],
  now: Date,
): CandidateCard | null {
  return closestEligible(attackerStrength, walletCards, now)?.card ?? null;
}

/** A random opponent's Power x HP may be at most this multiple of the attacker's. Any weaker opponent is in range. */
const MAX_OPPONENT_STRENGTH_RATIO = 3;

export interface MatchResult {
  wallet: string;
  card: CandidateCard;
}

/**
 * The closest eligible card across all wallets, taking each wallet's
 * best-fitting card first, or null if that card is more than
 * MAX_OPPONENT_STRENGTH_RATIO times the attacker's strength.
 *
 * `excludedCandidates` lets a caller re-roll past a card that just failed
 * fresh ownership verification. It is keyed by `wallet:cardKey`, not
 * `cardKey` alone, because several wallets can hold the same token and
 * excluding one wallet's copy must not exclude the others.
 */
export function findMatch(
  attackerStrength: number,
  pool: CandidateCard[],
  now: Date,
  excludedCandidates: ReadonlySet<string> = new Set(),
): MatchResult | null {
  const byWallet = new Map<string, CandidateCard[]>();
  for (const card of pool) {
    if (excludedCandidates.has(`${card.wallet}:${card.cardKey}`)) continue;
    const existing = byWallet.get(card.wallet);
    if (existing) existing.push(card);
    else byWallet.set(card.wallet, [card]);
  }

  const perWalletBest: Fit[] = [];
  for (const cards of byWallet.values()) {
    const best = closestEligible(attackerStrength, cards, now);
    if (best) perWalletBest.push(best);
  }

  const best = closest(perWalletBest);
  if (!best || best.strength > attackerStrength * MAX_OPPONENT_STRENGTH_RATIO) return null;
  return { wallet: best.card.wallet, card: best.card };
}
