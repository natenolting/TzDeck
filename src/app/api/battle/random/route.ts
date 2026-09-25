import { ownershipOf, requireBothStillHeld, resolveAttacker, toCandidateCard } from "@/lib/battle/combatants";
import { reject } from "@/lib/battle/failures";
import { fightPlayerBattle } from "@/lib/battle/playerBattle";
import type { SignedRequestBody } from "@/lib/battle/requestAuth";
import { effectiveStats, findMatch, strength, type CandidateCard } from "@/lib/battle/rules";
import { signedAttemptRoute } from "@/lib/battle/signedRoute";
import { completeAttempt, fetchMatchmakingCandidatePool } from "@/lib/battle/store";

// The commit_battle statement's own locking work is fast; the slow parts are
// the up-to-several bounded upstream ownership re-checks during re-rolls.
export const maxDuration = 25;

const MAX_NOT_HELD_REROLLS = 3;
const MAX_UNVERIFIABLE_REROLLS = 2;
const NO_MATCH = { outcome: "no_match" };

interface RandomBattleBody extends SignedRequestBody {
  attackerCardKey: string;
}

/**
 * The closest opponent whose card is confirmed held right now, re-rolling
 * past ones that aren't, or null when no opponent is left. An opponent that
 * could not be verified is an outage rather than an absence, so once one has
 * been skipped, running out of opponents rejects the attempt as retryable
 * instead of reporting no match.
 */
async function findVerifiedOpponent(attackerStrength: number, pool: CandidateCard[]): Promise<CandidateCard | null> {
  // Keyed by wallet:cardKey, since several wallets can hold the same token.
  const excluded = new Set<string>();
  let notHeldRerolls = 0;
  let unverifiableRerolls = 0;

  for (;;) {
    const match = findMatch(attackerStrength, pool, new Date(), excluded);
    if (!match) {
      if (unverifiableRerolls > 0) reject("ownership_unverifiable");
      return null;
    }

    const ownership = await ownershipOf(match.card);
    if (ownership.status === "held") return match.card;
    excluded.add(`${match.wallet}:${match.card.cardKey}`);

    if (ownership.status === "not_held") {
      notHeldRerolls += 1;
      if (notHeldRerolls > MAX_NOT_HELD_REROLLS) {
        if (unverifiableRerolls > 0) reject("ownership_unverifiable");
        return null;
      }
    } else {
      unverifiableRerolls += 1;
      if (unverifiableRerolls > MAX_UNVERIFIABLE_REROLLS) reject("ownership_unverifiable");
    }
  }
}

export const POST = signedAttemptRoute<RandomBattleBody>({
  action: "random",
  // Independent of the daily attack cap: a failed search or an exhausted
  // re-roll budget spends no battle allowance but still does real upstream
  // and database work.
  rateLimit: { key: "random", windowSeconds: 60, maxRequests: 10 },
  parse: (body) => {
    const { attackerCardKey } = body as Partial<Record<"attackerCardKey", unknown>>;
    if (typeof attackerCardKey !== "string" || !attackerCardKey) return null;
    return { ...body, attackerCardKey };
  },
  params: (body) => [body.attackerCardKey],
  run: async (attempt, { attackerCardKey }) => {
    const attacker = await resolveAttacker(attempt.wallet, attackerCardKey);
    const attackerStats = effectiveStats(attacker.seed, attacker.level);
    const pool = (await fetchMatchmakingCandidatePool(attempt.wallet)).map(toCandidateCard);

    const defender = await findVerifiedOpponent(strength(attackerStats.power, attackerStats.hp), pool);
    if (!defender) {
      await completeAttempt(attempt.nonce, attempt.generation, NO_MATCH, 200);
      return { response: NO_MATCH, statusCode: 200 };
    }

    await requireBothStillHeld(attacker, defender);
    return fightPlayerBattle(attempt, attacker, defender);
  },
});
