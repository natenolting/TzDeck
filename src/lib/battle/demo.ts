import { calculateSupplyRarity, type NFTCard } from "@/lib/objkt";
import type { BattleResult } from "@/components/BattlePanel";
import {
  deriveBaseSeed,
  effectiveStats,
  mulberry32,
  resolveBattle,
  trainerBaseXpAward,
  trainerStats,
  trainerTierGap,
} from "./rules";

// ---------------------------------------------------------------------------
// Demo battles: the real combat math, run entirely in the browser, so a
// visitor can watch the battle screen without a wallet, a signature, or a
// database. Nothing here is committed anywhere -- no XP, no cooldown, no
// attack allowance -- which is why it can skip every route and auth check.
// ---------------------------------------------------------------------------

/** Every demo fights the entry-level trainer: the opponent a fresh card really gets first. */
export const DEMO_TRAINER_TIER = "common" as const;

/** Matches the battle routes' COMBAT_VARIANCE, so a demo fight swings like a real one. */
const DEMO_COMBAT_VARIANCE = 0.2;

/** A card with no known edition count fights as a common, never as a flattering 1 of 1. */
const DEMO_FALLBACK_EDITIONS = 100;

/**
 * Stands in for an owned card when the visitor has none to hand (My Deck
 * before connecting). 50 editions puts it in the same Common tier as the
 * trainer with a touch more Power, so the fight is close rather than a stomp.
 */
export const DEMO_SHOWCASE_CARD: NFTCard = {
  token_id: "demo",
  contract_address: "tzdeck-demo",
  name: "TzDeck Demo Card",
  description: "A stand-in card for the demo battle. Connect a wallet to fight with your own OBJKTs.",
  display_uri: "/tzdeck-shield-gradient-on-dark.svg",
  artist_alias: "TzDeck",
  editions: 50,
  objkt_url: "https://objkt.com/",
  rarity: calculateSupplyRarity(50),
};

/**
 * Hand-picked so the showcase's first run shows every mechanic in one short
 * fight: the demo card misses in round 3 and falls behind, lands a critical
 * hit in round 4, and wins in round 5 on 15 HP. Pinned by demo.test.ts -- a
 * rules change that alters this fight fails there rather than quietly
 * shipping a dull first impression.
 */
export const DEMO_SHOWCASE_SEED = 415;

export interface DemoBattle {
  result: BattleResult;
  wasOverkillTiebreak: boolean;
}

/** A fresh level-1 copy of `card` against the Common Trainer, resolved from `seed`. */
export function buildDemoBattle(card: NFTCard, seed: number): DemoBattle {
  const attackerLevel = 1;
  const baseSeed = deriveBaseSeed(card.editions ?? DEMO_FALLBACK_EDITIONS, card.description);
  const attackerStats = effectiveStats(baseSeed, attackerLevel);
  const trainer = trainerStats(DEMO_TRAINER_TIER);
  const defenderStats = { power: trainer.power, hp: trainer.hp };
  const combat = resolveBattle(attackerStats, defenderStats, DEMO_COMBAT_VARIANCE, mulberry32(seed), {
    attacker: attackerLevel,
    defender: trainer.level,
  });

  const attackerWon = combat.outcome === "A";
  return {
    result: {
      outcome: combat.outcome === "draw" ? "draw" : "win",
      winner: combat.outcome === "draw" ? null : attackerWon ? "attacker" : "defender",
      // What a real first win against this trainer would pay, before repeat-win decay.
      xpAwarded: attackerWon ? trainerBaseXpAward(DEMO_TRAINER_TIER, trainerTierGap(DEMO_TRAINER_TIER, attackerLevel)) : 0,
      trainerTier: DEMO_TRAINER_TIER,
      attackerStats,
      defenderStats,
      combat: {
        rounds: combat.rounds,
        finalHpA: combat.finalHpA,
        finalHpB: combat.finalHpB,
        history: combat.history,
      },
    },
    // Both sides fell in the same round and the bigger final hit decided it.
    wasOverkillTiebreak: combat.outcome !== "draw" && combat.finalHpA === 0 && combat.finalHpB === 0,
  };
}

export function randomDemoSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
