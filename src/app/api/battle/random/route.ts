import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calculateSupplyRarity } from "@/lib/objkt";
import { verifyOwnership } from "@/lib/battle/ownership";
import { fetchBattleTokenMetadata } from "@/lib/battle/holdings";
import { authenticateAndClaim, splitCardKey, type SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  baseXpAward,
  candidateStrength,
  effectiveStats,
  findMatch,
  levelForXp,
  mulberry32,
  resolveBattle,
  type BaseSeed,
  type CandidateCard,
} from "@/lib/battle/rules";
import {
  commitBattle,
  completeAttempt,
  failAttempt,
  fetchMatchmakingCandidatePool,
  fetchProgress,
  type CandidatePoolRow,
} from "@/lib/battle/store";

// The commit_battle statement's own locking work is fast; the slow parts are
// the up-to-several bounded upstream ownership re-checks during re-rolls.
export const maxDuration = 25;

const COMBAT_VARIANCE = 0.2;
const RULES_VERSION = "v1";
const MAX_NOT_HELD_REROLLS = 3;
const MAX_UNVERIFIABLE_REROLLS = 2;

interface RandomBattleBody extends SignedRequestBody {
  attackerCardKey: string;
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
  let body: RandomBattleBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (!body?.attackerCardKey || !body.envelope || !body.publicKey || !body.signature || !body.claimedAddress) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "random", [body.attackerCardKey]);
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
    const { contractAddress, tokenId } = splitCardKey(body.attackerCardKey);

    // R2/R4: fresh ownership, before any matchmaking work.
    const attackerOwnership = await verifyOwnership(wallet, contractAddress, tokenId);
    if (attackerOwnership.status === "not_held") {
      await failAttempt(nonce, generation, { error: "attacker_card_not_held" }, 409, false);
      return errorResponse(409, "attacker_card_not_held");
    }
    if (attackerOwnership.status === "unverifiable") {
      await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
      return errorResponse(503, "ownership_unverifiable");
    }

    // R3: a card in recovery cannot initiate -- checked before matchmaking work, not just at commit time.
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

    const poolRows = await fetchMatchmakingCandidatePool(wallet);
    const pool = poolRows.map(toCandidateCard);

    const excludedCardKeys = new Set<string>();
    let notHeldRerolls = 0;
    let unverifiableRerolls = 0;
    let defenderRow: CandidatePoolRow | undefined;
    let defenderCard: CandidateCard | null = null;

    for (;;) {
      const match = findMatch(attackerStrength, pool, new Date(), excludedCardKeys);
      if (!match) {
        await completeAttempt(nonce, generation, { outcome: "no_match" }, 200);
        return NextResponse.json({ outcome: "no_match" }, { status: 200 });
      }

      const { contractAddress: defenderContract, tokenId: defenderTokenId } = splitCardKey(match.card.cardKey);
      const defenderOwnership = await verifyOwnership(match.wallet, defenderContract, defenderTokenId);

      if (defenderOwnership.status === "held") {
        defenderCard = match.card;
        defenderRow = poolRows.find((r) => r.card_key === match.card.cardKey);
        break;
      }
      if (defenderOwnership.status === "not_held") {
        excludedCardKeys.add(match.card.cardKey);
        notHeldRerolls += 1;
        if (notHeldRerolls > MAX_NOT_HELD_REROLLS) {
          await completeAttempt(nonce, generation, { outcome: "no_match" }, 200);
          return NextResponse.json({ outcome: "no_match" }, { status: 200 });
        }
        continue;
      }
      // unverifiable: exclude and retry, bounded separately -- never treated as confirmed-absent.
      excludedCardKeys.add(match.card.cardKey);
      unverifiableRerolls += 1;
      if (unverifiableRerolls > MAX_UNVERIFIABLE_REROLLS) {
        await failAttempt(nonce, generation, { error: "ownership_unverifiable" }, 503, true);
        return errorResponse(503, "ownership_unverifiable");
      }
    }
    if (!defenderCard || !defenderRow) {
      await failAttempt(nonce, generation, { error: "internal_matchmaking_error" }, 500, false);
      return errorResponse(500, "internal_matchmaking_error");
    }

    const defenderStats = effectiveStats(defenderCard.seed, defenderCard.level);
    const rngSeed = randomInt(0, 2 ** 31).toString();
    const combat = resolveBattle(attackerStats, defenderStats, COMBAT_VARIANCE, mulberry32(Number(rngSeed)));

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

    if (!commitResult.committed) {
      return errorResponse(409, commitResult.rejectionReason ?? "commit_rejected");
    }

    return NextResponse.json(
      {
        outcome,
        winner: winnerWallet === wallet ? "attacker" : winnerWallet ? "defender" : null,
        xpAwarded: outcome === "win" ? award : 0,
        winnerNewXp: commitResult.winnerNewXp,
        loserRecoveryUntil: commitResult.loserRecoveryUntil,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in random battle route:", error);
    return errorResponse(500, "internal_error");
  }
}
