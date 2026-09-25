import { randomInt } from "node:crypto";

import type { Attacker } from "./combatants";
import {
  COMBAT_VARIANCE,
  RULES_VERSION,
  effectiveStats,
  mulberry32,
  resolveBattle,
  settlePlayerBattle,
  type CandidateCard,
} from "./rules";
import type { ClaimedAttempt } from "./signedRoute";
import { commitBattle, type CommitBattleResult } from "./store";

/** Resolves a battle between two wallets' verified cards and commits it, forwarding exactly what commit_battle stored. */
export function fightPlayerBattle(
  { nonce, generation }: ClaimedAttempt,
  attacker: Attacker,
  defender: CandidateCard,
): Promise<CommitBattleResult> {
  const attackerStats = effectiveStats(attacker.seed, attacker.level);
  const defenderStats = effectiveStats(defender.seed, defender.level);
  const rngSeed = randomInt(0, 2 ** 31).toString();
  const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)), {
    attacker: attacker.level,
    defender: defender.level,
  });
  const settlement = settlePlayerBattle(combat, attacker, defender);

  return commitBattle({
    nonce,
    generation,
    attackerWallet: attacker.wallet,
    attackerCardKey: attacker.cardKey,
    attackerExpectedVersion: attacker.expectedVersion,
    attackerSeedEditions: attacker.seed.editions,
    attackerSeedDescriptionLength: attacker.seed.descriptionLength,
    attackerSeedSource: "route",
    defenderWallet: defender.wallet,
    defenderCardKey: defender.cardKey,
    defenderExpectedVersion: defender.progressVersion,
    outcome: settlement.outcome,
    winnerWallet: settlement.winner?.wallet ?? null,
    winnerCardKey: settlement.winner?.cardKey ?? null,
    loserWallet: settlement.loser?.wallet ?? null,
    loserCardKey: settlement.loser?.cardKey ?? null,
    loserRecoveryReason: settlement.loserRecoveryReason,
    baseXpAward: settlement.baseXpAward,
    rulesVersion: RULES_VERSION,
    rngSeed,
    inputs: { attackerStats, defenderStats, combat },
  });
}
