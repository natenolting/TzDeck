import { NextRequest, NextResponse } from "next/server";
import { fetchBattleHoldingsPage, type BattleTokenMetadata } from "@/lib/battle/holdings";
import { computeParamHash } from "@/lib/battle/auth";
import { authenticateAndClaim, type SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  checkRateLimit,
  commitParticipation,
  ensureWalletExists,
  failAttempt,
  releaseLeaseForContinuation,
  stageHoldingsPage,
  startOrResumeHoldingsSync,
  type StagedCard,
} from "@/lib/battle/store";

// Independent of the daily attack/defense caps (U9/U10, "Implementation-Time
// Unknowns": exact figures) -- generous enough that a large wallet's bounded
// continuation loop (MAX_PAGES_PER_INVOCATION per request) can legitimately
// resubmit many times in a burst without tripping this, while still bounding
// outright abuse.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

// Bounded so a large collection resumes across requests rather than a
// single invocation trying to page through everything at once.
export const maxDuration = 20;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_INVOCATION = 4;

interface OptInBody extends SignedRequestBody {
  optedIn: boolean;
}

function toStagedCard(metadata: BattleTokenMetadata): StagedCard {
  return {
    cardKey: metadata.cardKey,
    contractAddress: metadata.contractAddress,
    tokenId: metadata.tokenId,
    seed: metadata.seed,
    source: metadata.source,
  };
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  let body: OptInBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (typeof body?.optedIn !== "boolean" || !body.envelope || !body.publicKey || !body.signature || !body.claimedAddress) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "opt-in", [body.optedIn]);
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

    const withinBudget = await checkRateLimit(`optin:${wallet}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS);
    if (!withinBudget) {
      await failAttempt(nonce, generation, { error: "rate_limited" }, 429, true);
      return errorResponse(429, "rate_limited");
    }

    if (!body.optedIn) {
      const result = await commitParticipation(nonce, generation, wallet, computeParamHash([false]), false, null);
      return NextResponse.json(result.response, { status: result.status_code });
    }

    const walletRow = await ensureWalletExists(wallet);
    const capturedHoldingsGeneration = walletRow.holdings_generation;
    const syncId = `sync:${nonce}`; // deterministic per attempt, so resuming the same attempt resumes the same sync
    const sync = await startOrResumeHoldingsSync(syncId, wallet, nonce, generation, capturedHoldingsGeneration);

    let cursor: number | null = sync.cursor ? Number(sync.cursor) : null;
    let complete = sync.status === "complete";
    let pagesThisInvocation = 0;

    while (!complete && pagesThisInvocation < MAX_PAGES_PER_INVOCATION) {
      const page = await fetchBattleHoldingsPage(wallet, cursor, PAGE_SIZE);
      if (page.status !== "ok") {
        await failAttempt(nonce, generation, { error: "holdings_unavailable" }, 503, true);
        return errorResponse(503, "holdings_unavailable");
      }
      const staged = await stageHoldingsPage(
        nonce,
        syncId,
        generation,
        page.cards.map(toStagedCard),
        page.complete ? null : String(page.nextCursor),
        page.complete,
      );
      if (staged.stale) {
        // A newer generation already took over this sync -- this worker's
        // authorization has already been superseded.
        await failAttempt(nonce, generation, { error: "sync_superseded" }, 409, true);
        return errorResponse(409, "sync_superseded");
      }
      cursor = page.nextCursor;
      complete = page.complete;
      pagesThisInvocation += 1;
    }

    if (!complete) {
      // Bounded work slice: release the lease for continuation, not a failure.
      // Reopening the panel resubmits the same signed request, which
      // reclaims this attempt (authenticateAndClaim) and resumes from cursor.
      await releaseLeaseForContinuation(nonce, generation);
      return NextResponse.json({ status: "in_progress" }, { status: 202 });
    }

    const result = await commitParticipation(nonce, generation, wallet, computeParamHash([true]), true, syncId);
    return NextResponse.json(result.response, { status: result.status_code });
  } catch (error) {
    console.error("Error in opt-in route:", error);
    return errorResponse(500, "internal_error");
  }
}
