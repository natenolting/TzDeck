"use client";

import { useEffect } from "react";

import type { NFTCard } from "@/lib/card";
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

/** Set once this browser's saved cards have been re-read with today's edition rules. */
const EDITIONS_CHECKED_KEY = "tzdeck_wishlist_editions_checked";

function editionsAlreadyChecked(): boolean {
  try {
    return window.localStorage.getItem(EDITIONS_CHECKED_KEY) !== null;
  } catch {
    return false;
  }
}

function markEditionsChecked(): void {
  try {
    window.localStorage.setItem(EDITIONS_CHECKED_KEY, "1");
  } catch {
    // Storage is unavailable; the check simply runs again next visit.
  }
}

/**
 * Whether saved cards may carry an edition count from before normalizeEditions.
 *
 * Until then a token OBJKT reported no supply for was saved as a 1 of 1, which
 * no stored field can tell apart from a real one -- only OBJKT can. So every
 * saved 1 of 1 (and every Unknown, whose supply OBJKT may know by now) is
 * re-read once per browser. The marker is what keeps a wishlist of genuine
 * 1 of 1s from asking OBJKT again on every visit.
 */
export function needsEditionsRecheck(cards: readonly NFTCard[]): boolean {
  if (editionsAlreadyChecked()) return false;
  return cards.some((card) => card.editions === undefined || card.editions === 1);
}

// One attempt per page load. Without this, a token OBJKT reports no mime for
// leaves the predicate true forever and every re-render fires another request.
let backfillAttempted = false;

/** Test-only: allow the one-shot backfill to run again. */
export function resetBackfillForTests(): void {
  backfillAttempted = false;
}

/**
 * Re-resolves saved cards that an older version of the app stored with less
 * than it knows now -- no `mime`, or an edition count that may have been a
 * guess -- so a wishlist entry behaves like a freshly pulled one. Reuses the
 * same refresh the Import path runs, which also brings prices and rarities up
 * to date and keeps a card's stored copy when OBJKT has nothing to say about it.
 *
 * Silent by design: nothing is shown while it runs and a failure changes
 * nothing on screen. The wishlist was already usable -- this only sharpens it.
 * An unreachable OBJKT leaves the editions marker unset, so the next visit
 * tries again.
 */
export function useWishlistBackfill(wishlist: NFTCard[]): void {
  useEffect(() => {
    if (backfillAttempted) return;
    const recheckEditions = needsEditionsRecheck(wishlist);
    if (!recheckEditions && !needsMimeBackfill(wishlist)) return;
    backfillAttempted = true;

    let cancelled = false;
    void refreshWishlist(wishlist, { throwOnError: true })
      .then(({ cards }) => {
        if (cancelled) return;
        saveWishlist(cards);
        if (recheckEditions) markEditionsChecked();
      })
      .catch((error: unknown) => {
        console.error("Failed to upgrade saved wishlist cards:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [wishlist]);
}
