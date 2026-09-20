import type { NFTCard } from "@/lib/objkt";

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

/** Absolute URL of a card's page. What goes on the clipboard, nothing else. */
export function shareLink(
  card: Pick<NFTCard, "contract_address" | "token_id">,
): string {
  return `${SITE_ORIGIN}/c/${card.contract_address}/${card.token_id}`;
}

