import { cardKey } from "./cardKey";
import type { ObjktListingRow } from "./objktToken";

export function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

/** At most this many cards from one artist, so a bulk lister cannot fill a pack. */
export const PACK_MAX_PER_ARTIST = 2;

function listingArtistKey(listing: ObjktListingRow): string {
  const holder = listing.token.creators?.[0]?.holder;
  return holder?.address
    || holder?.alias
    || `unattributed:${listing.token.fa_contract}`;
}

/**
 * Picks `count` listings, taking no more than `maxPerArtist` from any one
 * artist. If the pool is too concentrated to fill a pack under that cap, the
 * remainder is filled without it -- a short pack would be worse than a
 * repetitive one.
 */
export function selectDiverseListings(
  listings: ObjktListingRow[],
  count: number,
  maxPerArtist = PACK_MAX_PER_ARTIST,
): ObjktListingRow[] {
  const chosen: ObjktListingRow[] = [];
  const taken = new Set<ObjktListingRow>();
  const perArtist = new Map<string, number>();

  for (const listing of listings) {
    if (chosen.length === count) break;
    const key = listingArtistKey(listing);
    const used = perArtist.get(key) ?? 0;
    if (used >= maxPerArtist) continue;
    chosen.push(listing);
    taken.add(listing);
    perArtist.set(key, used + 1);
  }

  for (const listing of listings) {
    if (chosen.length === count) break;
    if (taken.has(listing)) continue;
    chosen.push(listing);
    taken.add(listing);
  }

  return chosen;
}

/** Keeps one listing per token, preferring the cheapest so "Collect" shows the best price. */
export function cheapestPerToken(listings: ObjktListingRow[]): ObjktListingRow[] {
  const byToken = new Map<string, ObjktListingRow>();

  for (const item of listings) {
    const key = cardKey(item.token.fa_contract, item.token.token_id);
    const existing = byToken.get(key);
    if (!existing || item.price < existing.price) {
      byToken.set(key, item);
    }
  }

  return [...byToken.values()];
}
