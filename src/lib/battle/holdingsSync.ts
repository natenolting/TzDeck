import { fetchBattleHoldingsPage, type BattleTokenMetadata } from "./holdings";
import { failAttempt, releaseLeaseForContinuation, stageHoldingsPage, type StagedCard } from "./store";

// ---------------------------------------------------------------------------
// Review follow-up item 5: opt-in/route.ts and refresh/route.ts each allowed
// up to MAX_PAGES_PER_INVOCATION sequential holdings pages, each with its own
// UPSTREAM_TIMEOUT_MS (holdings.ts) timeout -- four successful-but-slow pages
// can exceed the route's own `maxDuration` before database overhead is even
// counted, leaving neither a continuation nor a completion response. This
// tracks an invocation deadline from route entry (including auth/DB work,
// not just the page loop) and requires enough remaining budget for a whole
// page's worst case -- upstream timeout + staging + lease release + the HTTP
// response -- before starting one, or for the final promotion step before
// attempting it. Shared by both routes so their budget policy can't drift.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;
const MAX_PAGES_PER_INVOCATION = 4;

/** Must stay >= holdings.ts's own UPSTREAM_TIMEOUT_MS (8_000) -- that's the page fetch's own worst case. */
const UPSTREAM_PAGE_TIMEOUT_MS = 8_000;
/** One page's worst-case cost: the upstream timeout, plus staging, lease release, and response overhead. */
const PAGE_WORK_RESERVE_MS = UPSTREAM_PAGE_TIMEOUT_MS + 1_500;
/** The final promotion commit is a single DB round trip -- far cheaper than a page, but still real work. */
export const PROMOTION_RESERVE_MS = 2_000;

/** Leaves slack under Vercel's own `maxDuration = 20` for response serialization/network, not just route logic. */
export const INVOCATION_DEADLINE_MS = 18_000;

function toStagedCard(metadata: BattleTokenMetadata): StagedCard {
  return {
    cardKey: metadata.cardKey,
    contractAddress: metadata.contractAddress,
    tokenId: metadata.tokenId,
    seed: metadata.seed,
    source: metadata.source,
  };
}

export type BoundedHoldingsSyncResult =
  | { outcome: "complete" }
  | { outcome: "continue" }
  | { outcome: "failed"; error: string; status: number };

export interface BoundedHoldingsSyncParams {
  nonce: string;
  generation: string;
  wallet: string;
  syncId: string;
  initialCursor: number | null;
  initialComplete: boolean;
  /** Absolute deadline (comparable to `now()`), set once at route entry -- before auth/DB work, not just the page loop. */
  deadline: number;
  /** Test seam only -- production callers rely on the default (Date.now). */
  now?: () => number;
}

/**
 * Pages through a wallet's holdings, bounded by both page count and elapsed
 * time against `deadline`. "continue" means the lease was already released
 * for a resumable continuation (202) -- the caller doesn't release it again.
 * A fully staged sync with too little time left to safely promote also
 * returns "continue": the next invocation sees status "complete" and goes
 * straight to promotion with a fresh budget, never a partial snapshot.
 */
export async function runBoundedHoldingsSync(params: BoundedHoldingsSyncParams): Promise<BoundedHoldingsSyncResult> {
  const now = params.now ?? Date.now;
  let cursor = params.initialCursor;
  let complete = params.initialComplete;
  let pagesThisInvocation = 0;

  while (!complete && pagesThisInvocation < MAX_PAGES_PER_INVOCATION) {
    if (params.deadline - now() < PAGE_WORK_RESERVE_MS) {
      await releaseLeaseForContinuation(params.nonce, params.generation);
      return { outcome: "continue" };
    }

    const page = await fetchBattleHoldingsPage(params.wallet, cursor, PAGE_SIZE);
    if (page.status !== "ok") {
      await failAttempt(params.nonce, params.generation, { error: "holdings_unavailable" }, 503, true);
      return { outcome: "failed", error: "holdings_unavailable", status: 503 };
    }
    const staged = await stageHoldingsPage(
      params.nonce,
      params.syncId,
      params.generation,
      page.cards.map(toStagedCard),
      page.complete ? null : String(page.nextCursor),
      page.complete,
    );
    if (staged.stale) {
      // A newer generation already took over this sync -- this worker's
      // authorization has already been superseded.
      await failAttempt(params.nonce, params.generation, { error: "sync_superseded" }, 409, true);
      return { outcome: "failed", error: "sync_superseded", status: 409 };
    }
    if (staged.too_large) {
      // H4: the collection exceeds the total staged-card cap -- paging
      // further would only keep growing an already-oversized jsonb blob.
      // Not retryable: the wallet's holdings, not a transient condition,
      // are what's over the limit.
      await failAttempt(params.nonce, params.generation, { error: "collection_too_large" }, 413, false);
      return { outcome: "failed", error: "collection_too_large", status: 413 };
    }
    cursor = page.nextCursor;
    complete = page.complete;
    pagesThisInvocation += 1;
  }

  if (!complete) {
    await releaseLeaseForContinuation(params.nonce, params.generation);
    return { outcome: "continue" };
  }

  if (params.deadline - now() < PROMOTION_RESERVE_MS) {
    await releaseLeaseForContinuation(params.nonce, params.generation);
    return { outcome: "continue" };
  }

  return { outcome: "complete" };
}
