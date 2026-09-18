/**
 * Pull-pool eligibility rules. See docs/pull-filter-spec.md.
 *
 * All four rules run here rather than in the GraphQL `where` clause for one
 * reason: a server-side filter cannot report what it removed. Tokens excluded
 * by the query never come back, so the exclusion log could only ever see
 * denylist hits. The three OBJKT rules drop ~0.8% of a ~30-listing draw, so
 * paying that to get an exact, unsampled audit trail is a clear trade.
 *
 * This module is deliberately free of network and database access so the rules
 * can be tested on their own.
 */

export type ExclusionReason =
  | "token_flag"
  | "fa_not_live"
  | "creator_flag"
  | "denylist";

/**
 * Implemented by the database layer (src/lib/pullStore.ts). Declared here, at
 * the consumer, so the rules do not depend on how the denylist is stored.
 */
export interface DenylistIndex {
  has(faContract: string, tokenId: string): boolean;
}

/** A denylist that excludes nothing -- the fallback when the database is unreachable. */
export const ALLOW_ALL: DenylistIndex = { has: () => false };

interface FilterableToken {
  pk?: number | null;
  flag?: string | null;
  token_id: string;
  fa_contract: string;
  fa?: { live?: boolean | null } | null;
  creators?: Array<{ holder: { flag?: string | null } }>;
}

export interface FilterableListing {
  id: number;
  price: number;
  token: FilterableToken;
}

export interface ExclusionRecord {
  faContract: string;
  tokenId: string;
  tokenPk: number | null;
  reason: ExclusionReason;
}

/**
 * Returns the rule that excludes this listing, or null if it is eligible.
 *
 * Rule order is load-bearing: when more than one rule applies, the first one
 * wins, which keeps `reason` stable for a given token across draws.
 *
 * A missing `flag` or `fa.live` is treated as ineligible rather than as
 * "none"/true. A token whose collection failed to resolve is exactly the case
 * worth dropping, and these fields are new to the selection set -- a stale
 * deploy that has not shipped the query change should fail closed.
 */
export function exclusionReason(
  listing: FilterableListing,
  denylist: DenylistIndex,
): ExclusionReason | null {
  const { token } = listing;

  if (token.flag !== "none") return "token_flag";
  if (token.fa?.live !== true) return "fa_not_live";
  if (token.creators?.some((creator) => creator.holder.flag !== "none")) {
    return "creator_flag";
  }
  if (denylist.has(token.fa_contract, token.token_id)) return "denylist";

  return null;
}

/**
 * Splits listings into the ones a pack may draw from and a record of what was
 * removed. Runs before cheapestPerToken and selectDiverseListings: an excluded
 * token must not consume a pack slot, and must not win the cheapest-per-token
 * tiebreak and thereby suppress a legitimate listing of the same token.
 */
export function partitionListings<T extends FilterableListing>(
  listings: readonly T[],
  denylist: DenylistIndex,
): { eligible: T[]; excluded: ExclusionRecord[] } {
  const eligible: T[] = [];
  const excluded: ExclusionRecord[] = [];

  for (const listing of listings) {
    const reason = exclusionReason(listing, denylist);
    if (reason === null) {
      eligible.push(listing);
      continue;
    }
    excluded.push({
      faContract: listing.token.fa_contract,
      tokenId: listing.token.token_id,
      tokenPk: listing.token.pk ?? null,
      reason,
    });
  }

  return { eligible, excluded };
}
