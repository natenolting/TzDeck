"use client";

import { useEffect } from "react";

import type { NFTCard } from "@/lib/objkt";
import { refreshWishlist } from "@/lib/wishlistTransfer";
import { saveWishlist } from "./useWishlist";

/**
 * Whether any saved card predates the `mime` field.
 *
 * The wishlist is the only place a card outlives the query that produced it:
 * packs and the deck refetch every time. So a wishlist saved before mime
 * existed keeps rendering video tokens as stills, while the same token opened
 * from a pack plays -- the two detail modals disagree about the same NFT.
 */
export function needsMimeBackfill(cards: readonly NFTCard[]): boolean {
  return cards.some((card) => card.mime === undefined);
}

// One attempt per page load. Without this, a token OBJKT reports no mime for
// leaves the predicate true forever and every re-render fires another request.
let backfillAttempted = false;

/** Test-only: allow the one-shot backfill to run again. */
export function resetMimeBackfillForTests(): void {
  backfillAttempted = false;
}

/**
 * Re-resolves saved cards that predate `mime`, so a wishlist entry behaves like
 * a freshly pulled one. Reuses the same refresh the Import path runs, which
 * also brings prices and rarities up to date and keeps a card's stored copy
 * when OBJKT has nothing to say about it.
 *
 * Silent by design: nothing is shown while it runs and a failure changes
 * nothing on screen. The wishlist was already usable -- this only sharpens it.
 */
export function useWishlistMimeBackfill(wishlist: NFTCard[]): void {
  useEffect(() => {
    if (backfillAttempted || !needsMimeBackfill(wishlist)) return;
    backfillAttempted = true;

    let cancelled = false;
    void refreshWishlist(wishlist)
      .then(({ cards }) => {
        if (!cancelled) saveWishlist(cards);
      })
      .catch((error: unknown) => {
        console.error("Failed to upgrade saved wishlist cards:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [wishlist]);
}
