import { randomInt } from "node:crypto";
import type { CardRarity } from "@/lib/objkt";
import { resolveAttacker } from "@/lib/battle/combatants";
import { reject } from "@/lib/battle/failures";
import type { SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  COMBAT_VARIANCE,
  RULES_VERSION,
  effectiveStats,
  isTrainerTierUnlocked,
  mulberry32,
  resolveBattle,
  settleTrainerBattle,
  trainerStats,
  TRAINER_TIER_ORDER,
} from "@/lib/battle/rules";
import { signedAttemptRoute } from "@/lib/battle/signedRoute";
import { commitTrainerBattle } from "@/lib/battle/store";

interface TrainerBattleBody extends SignedRequestBody {
  attackerCardKey: string;
  trainerTier: CardRarity;
}

function isCardRarity(value: unknown): value is CardRarity {
  return typeof value === "string" && (TRAINER_TIER_ORDER as readonly string[]).includes(value);
}

export const POST = signedAttemptRoute<TrainerBattleBody>({
  action: "trainer",
  rateLimit: { key: "trainer", windowSeconds: 60, maxRequests: 10 },
  parse: (body) => {
    const { attackerCardKey, trainerTier } = body as Partial<Record<"attackerCardKey" | "trainerTier", unknown>>;
    if (typeof attackerCardKey !== "string" || !attackerCardKey || !isCardRarity(trainerTier)) return null;
    return { ...body, attackerCardKey, trainerTier };
  },
  params: (body) => [body.attackerCardKey, body.trainerTier],
  run: async ({ wallet, nonce, generation }, { attackerCardKey, trainerTier }) => {
    const attacker = await resolveAttacker(wallet, attackerCardKey);

    // Tier-lock is a fail-fast, route-only check (like ownership
    // verification, it never runs inside commit_trainer_battle): it needs
    // levelForXp's formula, which is impractical to duplicate safely in SQL
    // without its own parity machinery, and the only way to race it is two
    // concurrent requests from the same wallet -- bounded to at most one
    // battle at the wrong tier, not a meaningful exploit.
    if (!isTrainerTierUnlocked(trainerTier, attacker.level)) reject("trainer_tier_locked");

    const attackerStats = effectiveStats(attacker.seed, attacker.level);
    const trainer = trainerStats(trainerTier);
    const defenderStats = { power: trainer.power, hp: trainer.hp };
    const rngSeed = randomInt(0, 2 ** 31).toString();
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)), {
      attacker: attacker.level,
      defender: trainer.level,
    });
    const settlement = settleTrainerBattle(combat, trainerTier, attacker.level);

    return commitTrainerBattle({
      nonce,
      generation,
      attackerWallet: wallet,
      attackerCardKey,
      attackerExpectedVersion: attacker.expectedVersion,
      attackerSeedEditions: attacker.seed.editions,
      attackerSeedDescriptionLength: attacker.seed.descriptionLength,
      attackerSeedSource: "route",
      trainerTier,
      outcome: settlement.outcome,
      attackerWon: settlement.attackerWon,
      baseXpAward: settlement.baseXpAward,
      rulesVersion: RULES_VERSION,
      rngSeed,
      inputs: { attackerStats, defenderStats, combat },
    });
  },
});
