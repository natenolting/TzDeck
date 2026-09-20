import { unstable_cache } from "next/cache";
import { cache } from "react";

import { fetchCardsByKeys, getCardKey, type NFTCard } from "@/lib/objkt";
import type { CardRef } from "@/lib/share";

/**
 * Resolves one shared card across requests and across the HTML/image routes.
 *
 * Link-preview crawlers wait for the complete document, so an uncached OBJKT
 * round trip delayed the metadata by several seconds and the image route then
 * paid for the same query again. The persistent cache makes the first route to
 * see a card warm the other one too. Prices still refresh hourly.
 *
 * `throwOnError` matters: a transient OBJKT outage must not cache a false 404
 * for an hour. `unstable_cache` does not store a rejected computation.
 */
const loadSharedCardAcrossRequests = unstable_cache(
  async (contract: string, tokenId: string): Promise<NFTCard | null> => {
    const key = { contract_address: contract, token_id: tokenId };
    const resolved = await fetchCardsByKeys([key], { throwOnError: true });
    return resolved.get(getCardKey(key)) ?? null;
  },
  ["shared-card"],
  { revalidate: 3600 },
);

/** Also deduplicates generateMetadata and the page body within one render. */
const loadSharedCardWithinRender = cache(
  (contract: string, tokenId: string) => loadSharedCardAcrossRequests(contract, tokenId),
);

export function loadSharedCard(ref: CardRef): Promise<NFTCard | null> {
  // Primitives are intentional: React cache compares arguments by identity, so
  // passing CardRef objects created separately by the metadata and page paths
  // would miss even when their values are identical.
  return loadSharedCardWithinRender(ref.contract, ref.tokenId);
}
