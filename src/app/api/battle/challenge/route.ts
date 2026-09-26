import { requireBothStillHeld, requireDefenderHeld, resolveAttacker, toCandidateCard } from "@/lib/battle/combatants";
import { reject } from "@/lib/battle/failures";
import { fightPlayerBattle } from "@/lib/battle/playerBattle";
import type { SignedRequestBody } from "@/lib/battle/requestAuth";
import { bestFittingCardForWallet, effectiveStats, strength } from "@/lib/battle/rules";
import { signedAttemptRoute } from "@/lib/battle/signedRoute";
import { fetchWalletCandidateCards } from "@/lib/battle/store";

export const maxDuration = 20;

interface ChallengeBody extends SignedRequestBody {
  attackerCardKey: string;
  defenderWallet: string;
}

export const POST = signedAttemptRoute<ChallengeBody>({
  action: "challenge",
  rateLimit: { key: "challenge", windowSeconds: 60, maxRequests: 10 },
  parse: (body) => {
    const { attackerCardKey, defenderWallet } = body as Partial<Record<"attackerCardKey" | "defenderWallet", unknown>>;
    if (typeof attackerCardKey !== "string" || !attackerCardKey) return null;
    if (typeof defenderWallet !== "string" || !defenderWallet) return null;
    return { ...body, attackerCardKey, defenderWallet };
  },
  params: (body) => [body.attackerCardKey, body.defenderWallet],
  run: async (attempt, { attackerCardKey, defenderWallet }) => {
    if (attempt.wallet === defenderWallet) reject("self_challenge");

    const attacker = await resolveAttacker(attempt.wallet, attackerCardKey);
    const attackerStats = effectiveStats(attacker.seed, attacker.level);

    // No re-roll for a direct challenge -- a named wallet has no sensible substitute.
    const targetCards = (await fetchWalletCandidateCards(defenderWallet)).map(toCandidateCard);
    const defender = bestFittingCardForWallet(strength(attackerStats.power, attackerStats.hp), targetCards, new Date());
    if (!defender) reject("target_not_eligible");

    await requireDefenderHeld(defender);
    await requireBothStillHeld(attacker, defender);
    return fightPlayerBattle(attempt, attacker, defender);
  },
});
