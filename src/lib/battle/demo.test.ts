import assert from "node:assert/strict";
import test from "node:test";

import type { NFTCard } from "@/lib/objkt";
import { buildDemoBattle, DEMO_SHOWCASE_CARD, DEMO_SHOWCASE_SEED, DEMO_TRAINER_TIER } from "./demo";
import { deriveBaseSeed, effectiveStats, trainerStats } from "./rules";

test("the showcase fight is pinned: a miss, a comeback critical hit, and a narrow win", () => {
  const { result, wasOverkillTiebreak } = buildDemoBattle(DEMO_SHOWCASE_CARD, DEMO_SHOWCASE_SEED);

  assert.equal(result.outcome, "win");
  assert.equal(result.winner, "attacker");
  assert.equal(wasOverkillTiebreak, false);
  assert.deepEqual(
    result.combat?.history.map((round) => [round.resultA, round.resultB, round.hpA, round.hpB]),
    [
      ["hit", "hit", 182, 159],
      ["hit", "hit", 141, 111],
      ["miss", "hit", 106, 111],
      ["critical", "hit", 62, 43],
      ["hit", "hit", 15, 0],
    ],
    "a rules change moved the showcase fight -- re-pick DEMO_SHOWCASE_SEED so it still shows a miss, a crit and a close win",
  );
});

test("a demo fights the Common Trainer at its real stats, with a level-1 copy of the card", () => {
  const card: NFTCard = {
    token_id: "7",
    contract_address: "KT1Pulled",
    name: "Pulled Card",
    description: "Some words about the art.",
    editions: 10,
    objkt_url: "https://objkt.com/asset/KT1Pulled/7",
    rarity: "rare",
  };
  const { result } = buildDemoBattle(card, 1);
  const trainer = trainerStats(DEMO_TRAINER_TIER);

  assert.equal(result.trainerTier, "common");
  assert.deepEqual(result.defenderStats, { power: trainer.power, hp: trainer.hp });
  assert.deepEqual(result.attackerStats, effectiveStats(deriveBaseSeed(10, card.description), 1));
  assert.equal(result.defenderCardKey, undefined, "no defender token to fetch for a trainer");
});

test("the same seed always replays the same fight, and a different seed can differ", () => {
  const first = buildDemoBattle(DEMO_SHOWCASE_CARD, 99);
  const again = buildDemoBattle(DEMO_SHOWCASE_CARD, 99);
  assert.deepEqual(first, again);

  const histories = new Set(
    Array.from({ length: 20 }, (_, seed) => JSON.stringify(buildDemoBattle(DEMO_SHOWCASE_CARD, seed).result.combat?.history)),
  );
  assert.ok(histories.size > 1);
});

test("XP is quoted only for a win, and a card with no edition count fights as a common", () => {
  const outcomes = Array.from({ length: 200 }, (_, seed) => buildDemoBattle(DEMO_SHOWCASE_CARD, seed).result);
  const win = outcomes.find((result) => result.winner === "attacker");
  const loss = outcomes.find((result) => result.winner === "defender");
  assert.ok(win && loss, "200 seeds of an even fight include both a win and a loss");
  assert.ok((win.xpAwarded ?? 0) > 0);
  assert.equal(loss.xpAwarded, 0);

  const unknown: NFTCard = { ...DEMO_SHOWCASE_CARD, editions: undefined, description: undefined };
  assert.deepEqual(buildDemoBattle(unknown, 1).result.attackerStats, effectiveStats(deriveBaseSeed(100), 1));
});
