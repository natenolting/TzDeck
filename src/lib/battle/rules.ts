import { calculateSupplyRarity, type CardRarity } from "@/lib/objkt";

// ---------------------------------------------------------------------------
// U4: card stat derivation (Power/HP), ported directly from the validated
// prototype (docs/brainstorms/battle-system-combat-prototype.html) rather
// than redesigned. Every constant below is a tuning placeholder (Open
// Questions: exact Power/HP formula constants), not a structural choice.
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
  legendary: 200,
  epic: 160,
  rare: 120,
  uncommon: 90,
  common: 70,
};

const DESC_MODIFIER_CAP = 0.2;
const DESC_DECAY_CHARS = 200;
const HP_FLOOR = 50;

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

export interface BattleResult {
  rounds: number;
  outcome: BattleOutcome;
  finalHpA: number;
  finalHpB: number;
  /** Damage each side dealt in the deciding (final) round -- what the R14 tiebreak compares. */
  roundDamageA: number;
  roundDamageB: number;
}

const MAX_ROUNDS_SAFETY = 1000;

export function resolveBattle(
  attackerStats: { power: number; hp: number },
  defenderStats: { power: number; hp: number },
  variancePct: number,
  rng?: Rng,
): BattleResult {
  const roll = rng || Math.random;
  let hpA = attackerStats.hp;
  let hpB = defenderStats.hp;
  let rounds = 0;
  let roundDamageA = 0;
  let roundDamageB = 0;

  while (hpA > 0 && hpB > 0 && rounds < MAX_ROUNDS_SAFETY) {
    rounds += 1;
    const swingA = 1 + (roll() * 2 - 1) * variancePct;
    const swingB = 1 + (roll() * 2 - 1) * variancePct;
    roundDamageA = Math.max(0, attackerStats.power * swingA);
    roundDamageB = Math.max(0, defenderStats.power * swingB);
    hpB -= roundDamageA;
    hpA -= roundDamageB;
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
// U7: matchmaking -- candidate pool reduction and Power x HP band search.
// Pure math only; store.ts's query returns the full eligible pool (no
// product-based SQL filter, since stats are derived from base_seed on read,
// not a stored sortable column).
// ---------------------------------------------------------------------------

export interface CandidateCard {
  wallet: string;
  cardKey: string;
  seed: BaseSeed;
  level: number;
  recoveryUntil: Date | null;
  defenseCount: number;
  defenseResetAt: Date;
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

/** Whichever of a wallet's eligible cards has the closest Power x HP product to the attacker's -- not necessarily its strongest card. */
export function bestFittingCardForWallet(
  attackerStrength: number,
  walletCards: CandidateCard[],
  now: Date,
): CandidateCard | null {
  const eligible = walletCards.filter((c) => isCurrentlyEligible(c, now));
  if (eligible.length === 0) return null;
  return eligible.reduce((closest, candidate) =>
    Math.abs(candidateStrength(candidate) - attackerStrength) < Math.abs(candidateStrength(closest) - attackerStrength)
      ? candidate
      : closest,
  );
}

// Progressive band-widening steps, as a fraction of the attacker's own
// strength (Open Questions: exact strength-band width and widening schedule).
const BAND_WIDENING_STEPS = [0.1, 0.25, 0.5, 1.0, 2.0];

export interface MatchResult {
  wallet: string;
  card: CandidateCard;
}

/**
 * Reduces the pool to one candidate per wallet, then searches within a band
 * on the Power x HP product, widening progressively. `excludedCardKeys` lets
 * a caller re-roll past a candidate that just failed fresh ownership
 * verification (F1) without re-deriving the whole pool.
 */
export function findMatch(
  attackerStrength: number,
  pool: CandidateCard[],
  now: Date,
  excludedCardKeys: ReadonlySet<string> = new Set(),
): MatchResult | null {
  const byWallet = new Map<string, CandidateCard[]>();
  for (const card of pool) {
    if (excludedCardKeys.has(card.cardKey)) continue;
    const existing = byWallet.get(card.wallet);
    if (existing) existing.push(card);
    else byWallet.set(card.wallet, [card]);
  }

  const perWalletBest: MatchResult[] = [];
  for (const [wallet, cards] of byWallet) {
    const best = bestFittingCardForWallet(attackerStrength, cards, now);
    if (best) perWalletBest.push({ wallet, card: best });
  }
  if (perWalletBest.length === 0) return null;

  for (const bandWidth of BAND_WIDENING_STEPS) {
    const lower = attackerStrength * (1 - bandWidth);
    const upper = attackerStrength * (1 + bandWidth);
    const withinBand = perWalletBest.filter(
      ({ card }) => candidateStrength(card) >= lower && candidateStrength(card) <= upper,
    );
    if (withinBand.length > 0) {
      return withinBand.reduce((closest, candidate) =>
        Math.abs(candidateStrength(candidate.card) - attackerStrength) <
        Math.abs(candidateStrength(closest.card) - attackerStrength)
          ? candidate
          : closest,
      );
    }
  }
  return null; // widest band still has no candidate
}

/** F2: reuses the same closest-card selection, scoped to a single named wallet's cards. */
export function bestCardForChallenge(
  attackerStrength: number,
  targetWalletCards: CandidateCard[],
  now: Date,
): CandidateCard | null {
  return bestFittingCardForWallet(attackerStrength, targetWalletCards, now);
}
