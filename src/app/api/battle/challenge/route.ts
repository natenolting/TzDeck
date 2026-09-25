import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calculateSupplyRarity } from "@/lib/objkt";
import { verifyOwnership } from "@/lib/battle/ownership";
import { fetchBattleTokenMetadata } from "@/lib/battle/holdings";
import { authenticateAndClaim, isSignedRequestBodyShapeValid, splitCardKey, type SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  COMBAT_VARIANCE,
  RULES_VERSION,
  baseXpAward,
  bestCardForChallenge,
  candidateStrength,
  effectiveStats,
  levelForXp,
  mulberry32,
  resolveBattle,
  type BaseSeed,
  type CandidateCard,
} from "@/lib/battle/rules";
import {
  checkRateLimit,
  commitBattle,
  failAttempt,
  fetchProgress,
  fetchWalletCandidateCards,
  type CandidatePoolRow,
} from "@/lib/battle/store";

export const maxDuration = 20;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;

interface ChallengeBody extends SignedRequestBody {
  attackerCardKey: string;
  defenderWallet: string;
}

function toCandidateCard(row: CandidatePoolRow): CandidateCard {
  return {
    wallet: row.wallet,
    cardKey: row.card_key,
    seed: { editions: row.seed_editions, descriptionLength: row.seed_description_length },
    level: levelForXp(Number(row.xp)),
    recoveryUntil: row.recovery_until ? new Date(row.recovery_until) : null,
    defenseCount: row.defense_count,
    defenseResetAt: new Date(row.defense_reset_at),
  };
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  let body: ChallengeBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (
    typeof body?.attackerCardKey !== "string" ||
    !body.attackerCardKey ||
    typeof body.defenderWallet !== "string" ||
    !body.defenderWallet ||
    !isSignedRequestBodyShapeValid(body)
  ) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "challenge", [body.attackerCardKey, body.defenderWallet], {
      checkBudget: (wallet) => checkRateLimit(`challenge:${wallet}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS),
    });
    switch (auth.outcome) {
      case "rejected":
        return errorResponse(auth.status, auth.reason);
      case "in_progress":
        return NextResponse.json({ error: "attempt_in_progress" }, { status: 409, headers: { "Retry-After": "2" } });
      case "terminal": {
        const status = auth.row.status_code ?? 200;
        return NextResponse.json(auth.row.response, { status });
      }
      case "claimed":
        break;
    }
    const { wallet, nonce, generation } = auth;

    // R6: a wallet can never challenge itself.
    if (wallet === body.defenderWallet) {
      await failAttempt(nonce, generation, { error: "self_challenge" }, 400, false);
      return errorResponse(400, "self_challenge");
    }

    const { contractAddress, tokenId } = splitCardKey(body.attackerCardKey);
    const attackerOwnership = await verifyOwnership(wallet, contractAddress, tokenId);
    if (attackerOwnership.status === "not_held") {
      await failAttempt(nonce, generation, { error: "attacker_card_not_held" }, 409, false);
      return errorResponse(409, "attacker_card_not_held");
    }
    if (attackerOwnership.status === "unverifiable") {
      await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
      return errorResponse(503, "ownership_unverifiable");
    }

    const existingAttackerProgress = await fetchProgress(wallet, body.attackerCardKey);
    if (existingAttackerProgress?.recovery_until && new Date(existingAttackerProgress.recovery_until) > new Date()) {
      await failAttempt(nonce, generation, { error: "attacker_recovering" }, 409, false);
      return errorResponse(409, "attacker_recovering");
    }

    let attackerSeed: BaseSeed;
    let attackerExpectedVersion: string | null;
    let attackerLevel: number;
    if (existingAttackerProgress) {
      attackerSeed = {
        editions: existingAttackerProgress.seed_editions,
        descriptionLength: existingAttackerProgress.seed_description_length,
      };
      attackerExpectedVersion = existingAttackerProgress.progress_version;
      attackerLevel = levelForXp(Number(existingAttackerProgress.xp));
    } else {
      const metadata = await fetchBattleTokenMetadata(wallet, contractAddress, tokenId);
      if (metadata.status === "self_minted") {
        await failAttempt(nonce, generation, { error: "attacker_card_self_minted" }, 409, false);
        return errorResponse(409, "attacker_card_self_minted");
      }
      if (metadata.status !== "ok") {
        await failAttempt(nonce, generation, { error: "attacker_metadata_unavailable" }, 503, true);
        return errorResponse(503, "attacker_metadata_unavailable");
      }
      attackerSeed = metadata.metadata.seed;
      attackerExpectedVersion = null;
      attackerLevel = 1;
    }

    const attackerStats = effectiveStats(attackerSeed, attackerLevel);
    const attackerStrength = candidateStrength({
      wallet,
      cardKey: body.attackerCardKey,
      seed: attackerSeed,
      level: attackerLevel,
      recoveryUntil: null,
      defenseCount: 0,
      defenseResetAt: new Date(0),
    });

    // No re-roll for a direct challenge -- a named wallet has no sensible substitute.
    const targetRows = await fetchWalletCandidateCards(body.defenderWallet);
    if (targetRows.length === 0) {
      await failAttempt(nonce, generation, { error: "target_not_eligible" }, 409, false);
      return errorResponse(409, "target_not_eligible");
    }
    const targetCards = targetRows.map(toCandidateCard);
    const defenderCard = bestCardForChallenge(attackerStrength, targetCards, new Date());
    if (!defenderCard) {
      await failAttempt(nonce, generation, { error: "target_not_eligible" }, 409, false);
      return errorResponse(409, "target_not_eligible");
    }
    const defenderRow = targetRows.find((r) => r.card_key === defenderCard.cardKey)!;

    const defenderCardIdentity = splitCardKey(defenderCard.cardKey);
    const defenderOwnership = await verifyOwnership(
      defenderCard.wallet,
      defenderCardIdentity.contractAddress,
      defenderCardIdentity.tokenId,
    );
    if (defenderOwnership.status === "not_held") {
      await failAttempt(nonce, generation, { error: "defender_card_not_held" }, 409, false);
      return errorResponse(409, "defender_card_not_held");
    }
    if (defenderOwnership.status === "unverifiable") {
      await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
      return errorResponse(503, "ownership_unverifiable");
    }

    // R2/R4 again, immediately before commit: time has passed since the
    // initial checks above (upstream calls, database round trips).
    const attackerReverify = await verifyOwnership(wallet, contractAddress, tokenId);
    if (attackerReverify.status === "not_held") {
      await failAttempt(nonce, generation, { error: "attacker_card_not_held" }, 409, false);
      return errorResponse(409, "attacker_card_not_held");
    }
    if (attackerReverify.status === "unverifiable") {
      await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
      return errorResponse(503, "ownership_unverifiable");
    }
    const defenderReverify = await verifyOwnership(
      defenderCard.wallet,
      defenderCardIdentity.contractAddress,
      defenderCardIdentity.tokenId,
    );
    if (defenderReverify.status === "not_held") {
      await failAttempt(nonce, generation, { error: "defender_card_not_held" }, 409, false);
      return errorResponse(409, "defender_card_not_held");
    }
    if (defenderReverify.status === "unverifiable") {
      await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
      return errorResponse(503, "ownership_unverifiable");
    }

    const defenderStats = effectiveStats(defenderCard.seed, defenderCard.level);
    const rngSeed = randomInt(0, 2 ** 31).toString();
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)), {
      attacker: attackerLevel,
      defender: defenderCard.level,
    });

    const outcome: "win" | "draw" = combat.outcome === "draw" ? "draw" : "win";
    const attackerWon = combat.outcome === "A";
    const winnerWallet = outcome === "win" ? (attackerWon ? wallet : defenderCard.wallet) : null;
    const winnerCardKey = outcome === "win" ? (attackerWon ? body.attackerCardKey : defenderCard.cardKey) : null;
    const loserWallet = outcome === "win" ? (attackerWon ? defenderCard.wallet : wallet) : null;
    const loserCardKey = outcome === "win" ? (attackerWon ? defenderCard.cardKey : body.attackerCardKey) : null;
    const loserRecoveryReason: "offensive" | "defensive" | null =
      outcome === "win" ? (attackerWon ? "defensive" : "offensive") : null;

    const defeatedTier = attackerWon
      ? calculateSupplyRarity(defenderCard.seed.editions)
      : calculateSupplyRarity(attackerSeed.editions);
    const defeatedLevel = attackerWon ? defenderCard.level : attackerLevel;
    const award = outcome === "win" ? baseXpAward(defeatedTier, defeatedLevel) : 0;

    const commitResult = await commitBattle({
      nonce,
      generation,
      attackerWallet: wallet,
      attackerCardKey: body.attackerCardKey,
      attackerExpectedVersion,
      attackerSeedEditions: attackerSeed.editions,
      attackerSeedDescriptionLength: attackerSeed.descriptionLength,
      attackerSeedSource: "route",
      defenderWallet: defenderCard.wallet,
      defenderCardKey: defenderCard.cardKey,
      defenderExpectedVersion: defenderRow.progress_version,
      outcome,
      winnerWallet,
      winnerCardKey,
      loserWallet,
      loserCardKey,
      loserRecoveryReason,
      baseXpAward: award,
      rulesVersion: RULES_VERSION,
      rngSeed,
      inputs: { attackerStats, defenderStats, combat },
    });

    return NextResponse.json(commitResult.response, { status: commitResult.statusCode });
  } catch (error) {
    console.error("Error in challenge route:", error);
    return errorResponse(500, "internal_error");
  }
}
