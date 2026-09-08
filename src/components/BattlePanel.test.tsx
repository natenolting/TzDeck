import assert from "node:assert/strict";
import test from "node:test";

import { previewStatsForCard, recoveryCopy } from "./BattlePanel";
import { baseStatsFromSeed, deriveBaseSeed } from "@/lib/battle/rules";

test("recoveryCopy explains the offensive-vs-defensive recovery distinction rather than showing a raw enum", () => {
  assert.match(recoveryCopy("defensive"), /defensive loss/i);
  assert.match(recoveryCopy("defensive"), /shorter/i);
  assert.match(recoveryCopy("offensive"), /offensive loss/i);
  assert.equal(recoveryCopy(null), "");
});

test("previewStatsForCard matches the server's own seed derivation for the same inputs", () => {
  const editions = 12;
  const description = "A hand-painted study of light on water.";
  const expected = baseStatsFromSeed(deriveBaseSeed(editions, description));
  assert.deepEqual(previewStatsForCard({ editions, description }), { power: expected.power, hp: expected.hp });
});

test("previewStatsForCard returns null rather than a fabricated number when editions isn't loaded", () => {
  assert.equal(previewStatsForCard({ editions: undefined, description: "irrelevant" }), null);
});
