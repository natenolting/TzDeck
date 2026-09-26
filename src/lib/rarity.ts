/**
 * Rarity: the display tier TzDeck assigns a card from its edition supply and,
 * when it has one, its current listing price. Not an on-chain trait, a pull
 * probability, or a valuation. See CONTEXT.md.
 */

export type CardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Every tier, commonest first. One trainer stands at each tier, in this order. */
export const RARITY_TIERS: readonly CardRarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

export const RARITY_LABELS: Record<CardRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export function isCardRarity(value: unknown): value is CardRarity {
  return typeof value === "string" && (RARITY_TIERS as readonly string[]).includes(value);
}

export const RARITY_THRESHOLDS = {
  topTierPrice: 500,
  epicEditions: 5,
  scarceTierPrice: 180,
  rareEditions: 1,
  rarePrice: 110,
  // Edition-only "rare" breakpoint for calculateSupplyRarity's 5-tier ladder --
  // distinct from rareEditions above, which is a price-inclusive threshold.
  supplyRareEditions: 10,
  uncommonEditions: 25,
  uncommonPrice: 5,
} as const;

/** Renders an edition ceiling the way a collector reads it: a lone edition is "1 of 1". */
function formatEditionRule(maximumEditions: number): string {
  return maximumEditions === 1 ? "1 of 1" : `≤${maximumEditions} editions`;
}

/** The price-inclusive grading rule for each tier, as the About page states it. */
export const RARITY_RULES: Record<CardRarity, string> = {
  legendary: `${formatEditionRule(1)} and ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
  epic: `${formatEditionRule(RARITY_THRESHOLDS.epicEditions)} and ${RARITY_THRESHOLDS.scarceTierPrice}ꜩ+ · or ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
  rare: `${formatEditionRule(RARITY_THRESHOLDS.rareEditions)} or ${RARITY_THRESHOLDS.rarePrice}ꜩ+`,
  uncommon: `${formatEditionRule(RARITY_THRESHOLDS.uncommonEditions)} or ${RARITY_THRESHOLDS.uncommonPrice}ꜩ+`,
  common: `>${RARITY_THRESHOLDS.uncommonEditions} editions and under ${RARITY_THRESHOLDS.uncommonPrice}ꜩ`,
};

function calculatePricedRarity(editions: number | undefined, priceXtz: number): CardRarity {
  if (editions === 1 && priceXtz >= RARITY_THRESHOLDS.topTierPrice) return "legendary";
  if ((editions !== undefined
      && editions <= RARITY_THRESHOLDS.epicEditions
      && priceXtz >= RARITY_THRESHOLDS.scarceTierPrice)
    || priceXtz >= RARITY_THRESHOLDS.topTierPrice) return "epic";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.rareEditions)
    || priceXtz >= RARITY_THRESHOLDS.rarePrice) return "rare";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.uncommonEditions)
    || priceXtz >= RARITY_THRESHOLDS.uncommonPrice) return "uncommon";
  return "common";
}

/** The supply-only ladder, for a card with no listing price. It is also the ladder battle stats use. */
export function calculateSupplyRarity(editions?: number): CardRarity {
  if (editions === 1) return "legendary";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.epicEditions) return "epic";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.supplyRareEditions) return "rare";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.uncommonEditions) return "uncommon";
  return "common";
}

/** A card's rarity: graded on price and supply when it has a listing price, on supply alone when it does not. */
export function rarityFor(editions: number | undefined, priceXtz: number | undefined): CardRarity {
  return priceXtz === undefined ? calculateSupplyRarity(editions) : calculatePricedRarity(editions, priceXtz);
}
