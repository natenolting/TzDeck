import { NextRequest, NextResponse } from "next/server";
import { fetchBattleHoldingsPage, type BattleTokenMetadata } from "@/lib/battle/holdings";
import { authenticateAndClaim, type SignedRequestBody } from "@/lib/battle/requestAuth";
import {
  completeAttempt,
  ensureWalletExists,
  failAttempt,
  markHoldingsSyncComplete,
  promoteHoldingsSnapshot,
  releaseLeaseForContinuation,
  stageHoldingsPage,
  startOrResumeHoldingsSync,
  type StagedCard,
} from "@/lib/battle/store";

export const maxDuration = 20;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_INVOCATION = 4;

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

/**
 * Authenticated holdings refresh -- signs `[]` since it has no desired-state
 * parameter and cannot alter opt-in, distinct from the opt-in action even
 * though it shares the same underlying materialization pipeline. No
 * automatic unauthenticated write is hidden behind GET status.
 */
export async function POST(request: NextRequest) {
  let body: SignedRequestBody;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json_body");
  }
  if (!body?.envelope || !body.publicKey || !body.signature || !body.claimedAddress) {
    return errorResponse(400, "missing_required_fields");
  }

  try {
    const auth = await authenticateAndClaim(body, "refresh", []);
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

    let cursor: number | null = sync.cursor ? Number(sync.cursor) : null;
    let complete = sync.status === "complete";
    let pagesThisInvocation = 0;

    while (!complete && pagesThisInvocation < MAX_PAGES_PER_INVOCATION) {
      const page = await fetchBattleHoldingsPage(wallet, cursor, PAGE_SIZE);
      if (page.status !== "ok") {
        await failAttempt(nonce, generation, { error: "holdings_unavailable" }, 503, true);
        return errorResponse(503, "holdings_unavailable");
      }
      await stageHoldingsPage(syncId, page.cards.map(toStagedCard), page.complete ? null : String(page.nextCursor));
      cursor = page.nextCursor;
      complete = page.complete;
      pagesThisInvocation += 1;
      if (complete) await markHoldingsSyncComplete(syncId);
    }

    if (!complete) {
      await releaseLeaseForContinuation(nonce, generation);
      return NextResponse.json({ status: "in_progress" }, { status: 202 });
    }

    const promotion = await promoteHoldingsSnapshot(syncId);
    if (!promotion.promoted) {
      await failAttempt(nonce, generation, { error: "stale_holdings_generation" }, 409, false);
      return errorResponse(409, "stale_holdings_generation");
    }

    const response = { refreshed: true };
    await completeAttempt(nonce, generation, response, 200);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error in refresh route:", error);
    return errorResponse(500, "internal_error");
  }
}
