import { NextRequest, NextResponse } from "next/server";
import { computeParamHash } from "@/lib/battle/auth";
import { INVOCATION_DEADLINE_MS, runBoundedHoldingsSync } from "@/lib/battle/holdingsSync";
import { authenticateAndClaim, isSignedRequestBodyShapeValid, type SignedRequestBody } from "@/lib/battle/requestAuth";
import { checkRateLimit, commitHoldingsRefresh, ensureWalletExists, startOrResumeHoldingsSync } from "@/lib/battle/store";

// Bounded so a large collection resumes across requests rather than a
// single invocation trying to page through everything at once -- see
// holdingsSync.ts for the elapsed-time budget that backs this up (a page
// count alone doesn't bound wall-clock time against this limit).
export const maxDuration = 20;
// Same reasoning as opt-in's budget: generous enough for a large wallet's
// bounded continuation loop, still a real bound on outright abuse.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

function errorResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Authenticated holdings refresh -- signs `[]` since it has no desired-state
 * parameter and cannot alter opt-in, distinct from the opt-in action even
 * though it shares the same underlying materialization pipeline. No
 * automatic unauthenticated write is hidden behind GET status.
 */
export async function POST(request: NextRequest) {
  // Set at route entry -- before auth/DB work, not just the page loop --
  // per the review's requirement that the budget cover the whole invocation.
  const deadline = Date.now() + INVOCATION_DEADLINE_MS;
  let body: SignedRequestBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (!isSignedRequestBodyShapeValid(body)) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "refresh", [], {
      checkBudget: (wallet) => checkRateLimit(`refresh:${wallet}`, RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_MAX_REQUESTS),
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

    const walletRow = await ensureWalletExists(wallet);
    const capturedHoldingsGeneration = walletRow.holdings_generation;
    const syncId = `sync:${nonce}`;
    const sync = await startOrResumeHoldingsSync(syncId, wallet, nonce, generation, capturedHoldingsGeneration);

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

    const result = await commitHoldingsRefresh(nonce, generation, wallet, computeParamHash([]), syncId);
    return NextResponse.json(result.response, { status: result.status_code });
  } catch (error) {
    console.error("Error in refresh route:", error);
    return errorResponse(500, "internal_error");
  }
}
