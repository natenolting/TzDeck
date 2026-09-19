import { cache } from "react";

import { fetchCardsByKeys, getCardKey, type NFTCard } from "@/lib/objkt";

/**
 * Canonical origin. The sole home of the host string: `metadataBase` in the
 * root layout reads it, and so does the share button, which runs on the client
 * and cannot see `metadataBase`. Deliberately a constant rather than an env
 * var, so a link copied from a preview deployment still points somewhere a
 * recipient can open.
 */
export const SITE_ORIGIN = "https://tzdeck.xyz";

/**
 * A contract/token pair that has passed shape validation.
 *
 * The brand is the point. An unvalidated pair of strings out of the URL cannot
 * reach OBJKT, because `loadSharedCard` accepts nothing else, and the only way
 * to make one is `parseCardRef`.
 */
export type CardRef = {
  readonly contract: string;
  readonly tokenId: string;
  readonly __brand: "CardRef";
};

/** `KT1` plus 33 base58 characters. Base58 omits 0, O, I and l. */
const KT1_ADDRESS = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Canonical decimal, no leading zeros, capped well above any real token id.
 * The canonical form matters beyond hygiene: `/c/KT1.../007` and `/c/KT1.../7`
 * would otherwise be two immutable CDN entries for one card.
 */
const TOKEN_ID = /^(0|[1-9][0-9]{0,19})$/;

/**
 * The feature's only boundary guard, and the only validation in it.
 *
 * Returns null rather than throwing because every caller answers a bad ref the
 * same way, with `notFound()`. A hand-typed, truncated or hostile URL costs
 * zero OBJKT quota, because nothing downstream will take the raw strings.
 */
export function parseCardRef(contract: string, tokenId: string): CardRef | null {
  if (!KT1_ADDRESS.test(contract)) return null;
  if (!TOKEN_ID.test(tokenId)) return null;
  return { contract, tokenId, __brand: "CardRef" };
}

/**
 * Resolves the shared card, priced against its cheapest active listing.
 *
 * `fetchCardsByKeys` rather than `fetchTokenByKey` so rarity is the
 * price-if-listed grade the rest of the app shows. Grading this one surface on
 * supply alone would make a shared Epic arrive as a Rare.
 *
 * `cache` dedupes the round trip between `generateMetadata` and the page body,
 * which render in one request. It does not reach `opengraph-image`, which the
 * crawler fetches separately.
 */
export const loadSharedCard: (ref: CardRef) => Promise<NFTCard | null> = cache(
  async (ref: CardRef) => {
    const key = { contract_address: ref.contract, token_id: ref.tokenId };
    const resolved = await fetchCardsByKeys([key]);
    return resolved.get(getCardKey(key)) ?? null;
  },
);

/** Absolute URL of a card's page. What goes on the clipboard, nothing else. */
export function shareLink(
  card: Pick<NFTCard, "contract_address" | "token_id">,
): string {
  return `${SITE_ORIGIN}/c/${card.contract_address}/${card.token_id}`;
}

/**
 * Absolute URL of a card's generated preview image.
 *
 * Only the warm ping uses this; crawlers read the real URL off `og:image`,
 * which carries a cache-busting query this deliberately omits. It lives here
 * so the route's shape stays in one file rather than being re-assembled by a
 * client component.
 */
export function shareImageUrl(
  card: Pick<NFTCard, "contract_address" | "token_id">,
): string {
  return `${shareLink(card)}/opengraph-image`;
}
