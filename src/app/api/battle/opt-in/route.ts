import { NextRequest, NextResponse } from "next/server";
import { computeParamHash } from "@/lib/battle/auth";
import { INVOCATION_DEADLINE_MS, runBoundedHoldingsSync } from "@/lib/battle/holdingsSync";
import { authenticateAndClaim, isSignedRequestBodyShapeValid, type SignedRequestBody } from "@/lib/battle/requestAuth";
import { checkRateLimit, commitParticipation, ensureWalletExists, startOrResumeHoldingsSync } from "@/lib/battle/store";

// Independent of the daily attack/defense caps (U9/U10, "Implementation-Time
// Unknowns": exact figures) -- generous enough that a large wallet's bounded
// continuation loop (MAX_PAGES_PER_INVOCATION per request) can legitimately
// resubmit many times in a burst without tripping this, while still bounding
// outright abuse.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

// Bounded so a large collection resumes across requests rather than a
// single invocation trying to page through everything at once -- see
// holdingsSync.ts for the elapsed-time budget that backs this up (a page
// count alone doesn't bound wall-clock time against this limit).
export const maxDuration = 20;

interface OptInBody extends SignedRequestBody {
  optedIn: boolean;
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  // Set at route entry -- before auth/DB work, not just the page loop --
  // per the review's requirement that the budget cover the whole invocation.
  const deadline = Date.now() + INVOCATION_DEADLINE_MS;
  let body: OptInBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (typeof body?.optedIn !== "boolean" || !isSignedRequestBodyShapeValid(body)) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "opt-in", [body.optedIn], {
      checkBudget: (wallet) => checkRateLimit(`optin:${wallet}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS),
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

    if (!body.optedIn) {
      const result = await commitParticipation(nonce, generation, wallet, computeParamHash([false]), false, null);
      return NextResponse.json(result.response, { status: result.status_code });
    }

    const walletRow = await ensureWalletExists(wallet);
    const capturedHoldingsGeneration = walletRow.holdings_generation;
    const syncId = `sync:${nonce}`; // deterministic per attempt, so resuming the same attempt resumes the same sync
    const sync = await startOrResumeHoldingsSync(syncId, wallet, nonce, generation, capturedHoldingsGeneration);

    // Bounded work slice, by both page count and elapsed time: a partial
    // result releases the lease for continuation, not a failure. Reopening
    // the panel resubmits the same signed request, which reclaims this
    // attempt (authenticateAndClaim) and resumes from the saved cursor.
    const syncResult = await runBoundedHoldingsSync({
      nonce,
      generation,
      wallet,
      syncId,
      initialCursor: sync.cursor ? Number(sync.cursor) : null,
      initialComplete: sync.status === "complete",
      deadline,
    });
    if (syncResult.outcome === "failed") {
      return errorResponse(syncResult.status, syncResult.error);
    }
    if (syncResult.outcome === "continue") {
      return NextResponse.json({ status: "in_progress" }, { status: 202 });
    }

    const result = await commitParticipation(nonce, generation, wallet, computeParamHash([true]), true, syncId);
    return NextResponse.json(result.response, { status: result.status_code });
  } catch (error) {
    console.error("Error in opt-in route:", error);
    return errorResponse(500, "internal_error");
  }
}
