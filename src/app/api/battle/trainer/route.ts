import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { CardRarity } from "@/lib/objkt";
import { verifyOwnership } from "@/lib/battle/ownership";
import { fetchBattleTokenMetadata } from "@/lib/battle/holdings";
import { authenticateAndClaim, isSignedRequestBodyShapeValid, splitCardKey, type SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  effectiveStats,
  levelForXp,
  mulberry32,
  resolveBattle,
  trainerStats,
  isTrainerTierUnlocked,
  trainerTierGap,
  trainerBaseXpAward,
  TRAINER_TIER_ORDER,
  type BaseSeed,
} from "@/lib/battle/rules";
import { checkRateLimit, commitTrainerBattle, failAttempt, fetchProgress } from "@/lib/battle/store";

const COMBAT_VARIANCE = 0.2;
const RULES_VERSION = "v1";
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;

interface TrainerBattleBody extends SignedRequestBody {
  attackerCardKey: string;
  trainerTier: string;
}

function isCardRarity(value: unknown): value is CardRarity {
  return typeof value === "string" && (TRAINER_TIER_ORDER as readonly string[]).includes(value);
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  let body: TrainerBattleBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (
    typeof body?.attackerCardKey !== "string" ||
    !body.attackerCardKey ||
    !isCardRarity(body?.trainerTier) ||
    !isSignedRequestBodyShapeValid(body)
  ) {
    return errorResponse(400, "missing_required_fields");
  }
  const trainerTier = body.trainerTier;

  try {
    const auth = await authenticateAndClaim(body, "trainer", [body.attackerCardKey, trainerTier], {
      checkBudget: (wallet) => checkRateLimit(`trainer:${wallet}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS),
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

    // Tier-lock is a fail-fast, route-only check (like ownership
    // verification, it never runs inside commit_trainer_battle): it needs
    // levelForXp's formula, which is impractical to duplicate safely in SQL
    // without its own parity machinery, and the only way to race it is two
    // concurrent requests from the same wallet -- bounded to at most one
    // battle at the wrong tier, not a meaningful exploit.
    if (!isTrainerTierUnlocked(trainerTier, attackerLevel)) {
      await failAttempt(nonce, generation, { error: "trainer_tier_locked" }, 409, false);
      return errorResponse(409, "trainer_tier_locked");
    }

    const attackerStats = effectiveStats(attackerSeed, attackerLevel);
    const trainer = trainerStats(trainerTier);
    const rngSeed = randomInt(0, 2 ** 31).toString();
    const combat = resolveBattle(
      attackerStats,
      { power: trainer.power, hp: trainer.hp },
      COMBAT_VARIANCE,
      mulberry32(Number(rngSeed)),
      { attacker: attackerLevel, defender: trainer.level },
    );

    const outcome: "win" | "draw" = combat.outcome === "draw" ? "draw" : "win";
    const attackerWon = combat.outcome === "A";
    const gap = trainerTierGap(trainerTier, attackerLevel);
    const baseAward = outcome === "win" && attackerWon ? trainerBaseXpAward(trainerTier, gap) : 0;

    const commitResult = await commitTrainerBattle({
      nonce,
      generation,
      attackerWallet: wallet,
      attackerCardKey: body.attackerCardKey,
      attackerExpectedVersion,
      attackerSeedEditions: attackerSeed.editions,
      attackerSeedDescriptionLength: attackerSeed.descriptionLength,
      attackerSeedSource: "route",
      trainerTier,
      outcome,
      attackerWon,
      baseXpAward: baseAward,
      rulesVersion: RULES_VERSION,
      rngSeed,
      inputs: { attackerStats, defenderStats: { power: trainer.power, hp: trainer.hp }, combat },
    });

    return NextResponse.json(commitResult.response, { status: commitResult.statusCode });
  } catch (error) {
    console.error("Error in trainer battle route:", error);
    return errorResponse(500, "internal_error");
  }
}
