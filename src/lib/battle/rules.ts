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
