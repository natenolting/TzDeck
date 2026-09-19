import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { RARITY_CONFIG, RARITY_HEX } from "./rarityStyles";

/** The `--rarity-<tier>: <value>;` declarations, which are the design's real source. */
function stylesheetRarityColors(): Record<string, string> {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const colors: Record<string, string> = {};
  for (const [, tier, value] of css.matchAll(/--rarity-([a-z]+):\s*([^;]+);/g)) {
    colors[tier] = value.trim();
  }
  return colors;
}

test("stylesheetRarityColors reads a declaration out of globals.css", () => {
  assert.equal(stylesheetRarityColors().legendary, "#fbbf24");
});

test("every rarity tier the UI knows about has an OG hex", () => {
  assert.deepEqual(Object.keys(RARITY_HEX).sort(), Object.keys(RARITY_CONFIG).sort());
});

test("no OG hex has drifted from the stylesheet property it mirrors", () => {
  assert.deepEqual(RARITY_HEX, stylesheetRarityColors());
});
