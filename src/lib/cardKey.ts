import type { NFTCard } from "./card";

/** A token's identity as one string: `contract:tokenId`. Every card key is built here. */
export function cardKey(contractAddress: string, tokenId: string): string {
  return `${contractAddress}:${tokenId}`;
}

export function getCardKey(card: Pick<NFTCard, "contract_address" | "token_id">): string {
  return cardKey(card.contract_address, card.token_id);
}

/**
 * Splits a card key back into its contract and token id, or null when it has
 * no separator. The last colon splits it, since a token id never has one.
 */
export function parseCardKey(key: string): { contractAddress: string; tokenId: string } | null {
  const separatorIndex = key.lastIndexOf(":");
  if (separatorIndex === -1) return null;
  return { contractAddress: key.slice(0, separatorIndex), tokenId: key.slice(separatorIndex + 1) };
}

/**
 * Reads an OBJKT token link, or a bare `contract/id` or `contract:id` pair,
 * back into the identity `getCardKey` is built from. This reads what a
 * collector pastes, so unlike parseCardKey it validates the contract address.
 *
 * The pair is matched anywhere in the input rather than anchored to a path, so
 * one rule covers the full URL, the scheme-less form, a trailing slash and a
 * query string without enumerating OBJKT path prefixes, which change. The
 * character class is base58, which is why `0`, `O`, `I` and `l` are missing
 * from it. A collection URL has no numeric tail and so falls through to null.
 */
export function parseTokenReference(
  input: string,
): Pick<NFTCard, "contract_address" | "token_id"> | null {
  const match = input.match(/(KT1[123456789A-HJ-NP-Za-km-z]{33})[/:](\d+)/);
  if (!match) return null;
  return { contract_address: match[1], token_id: match[2] };
}
