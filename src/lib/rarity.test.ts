import assert from "node:assert/strict";
import test from "node:test";

import { calculateSupplyRarity, RARITY_RULES, RARITY_THRESHOLDS, rarityFor } from "./rarity";

test("rarity rules match the priced ladder's boundaries", () => {
  assert.deepEqual(RARITY_RULES, {
    legendary: `1 of 1 and ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
    epic: `≤${RARITY_THRESHOLDS.epicEditions} editions and ${RARITY_THRESHOLDS.scarceTierPrice}ꜩ+ · or ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
    rare: `1 of 1 or ${RARITY_THRESHOLDS.rarePrice}ꜩ+`,
    uncommon: `≤${RARITY_THRESHOLDS.uncommonEditions} editions or ${RARITY_THRESHOLDS.uncommonPrice}ꜩ+`,
    common: `>${RARITY_THRESHOLDS.uncommonEditions} editions and under ${RARITY_THRESHOLDS.uncommonPrice}ꜩ`,
  });

  assert.equal(rarityFor(1, RARITY_THRESHOLDS.topTierPrice), "legendary");
  assert.equal(rarityFor(1, RARITY_THRESHOLDS.topTierPrice - 0.001), "epic");
  assert.equal(rarityFor(RARITY_THRESHOLDS.epicEditions, RARITY_THRESHOLDS.scarceTierPrice), "epic");
  assert.equal(rarityFor(200, RARITY_THRESHOLDS.topTierPrice), "epic");
  assert.equal(rarityFor(RARITY_THRESHOLDS.rareEditions, 0), "rare");
  assert.equal(rarityFor(200, RARITY_THRESHOLDS.rarePrice), "rare");
  assert.equal(rarityFor(RARITY_THRESHOLDS.uncommonEditions, 0), "uncommon");
  assert.equal(rarityFor(200, RARITY_THRESHOLDS.uncommonPrice), "uncommon");
  assert.equal(rarityFor(RARITY_THRESHOLDS.uncommonEditions + 1, 0), "common");
});

test("calculateSupplyRarity grades wallet holdings without listing prices", () => {
  assert.equal(calculateSupplyRarity(1), "legendary");
  assert.equal(calculateSupplyRarity(5), "epic");
  assert.equal(calculateSupplyRarity(6), "rare");
  assert.equal(calculateSupplyRarity(10), "rare");
  assert.equal(calculateSupplyRarity(11), "uncommon");
  assert.equal(calculateSupplyRarity(25), "uncommon");
  assert.equal(calculateSupplyRarity(26), "common");
  assert.equal(calculateSupplyRarity(undefined), "common");
});

test("rarityFor grades an unpriced card on supply alone, and a priced one on price too", () => {
  assert.equal(rarityFor(1, undefined), "legendary", "a 1 of 1 with no price is Legendary on the supply ladder");
  assert.equal(rarityFor(1, 0), "rare", "the same 1 of 1 listed at nothing is only Rare on the priced ladder");
});
