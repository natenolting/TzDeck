import {
  calculateRarity,
  calculateSupplyRarity,
  fetchCardsByKeys,
  getCardKey,
  RARITY_LEGEND,
  type CardRarity,
  type NFTCard,
} from "./objkt";

/** Bumped only when the file shape changes incompatibly; `parseWishlistExport` stays lenient. */
export const WISHLIST_EXPORT_VERSION = 1;

export interface ParsedWishlist {
  cards: NFTCard[];
  /** ISO timestamp the file was written, or null for a bare card array. */
  exportedAt: string | null;
  /** Entries dropped for missing an identity or repeating one already read. */
  skipped: number;
}

const RARITY_TIERS = new Set<string>(RARITY_LEGEND.map((entry) => entry.tier));

// An export is a file the user can hand-edit or receive from someone else, and
// every URL in it ends up in an <img src> or an <a href>. Only these two schemes
// are ever legitimate here; anything else is dropped rather than rendered.
const SAFE_URL_SCHEMES = ["https:", "ipfs:"];

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readSafeUrl(value: unknown): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;

  try {
    return SAFE_URL_SCHEMES.includes(new URL(raw).protocol) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function readCard(entry: unknown): NFTCard | null {
  if (typeof entry !== "object" || entry === null) return null;

  const raw = entry as Record<string, unknown>;
  const contractAddress = readString(raw.contract_address);
  const tokenId = readString(raw.token_id);
  if (!contractAddress || !tokenId) return null;

  const editions = readFiniteNumber(raw.editions);
  const priceXtz = readFiniteNumber(raw.price_xtz);
  const rarity = readString(raw.rarity);

  return {
    token_id: tokenId,
    contract_address: contractAddress,
    name: readString(raw.name) || `OBJKT #${tokenId}`,
    description: readString(raw.description),
    display_uri: readSafeUrl(raw.display_uri),
    artifact_uri: readSafeUrl(raw.artifact_uri),
    thumbnail_uri: readSafeUrl(raw.thumbnail_uri),
    artist_alias: readString(raw.artist_alias),
    artist_address: readString(raw.artist_address),
    collection_name: readString(raw.collection_name),
    editions,
    price_mutez: readFiniteNumber(raw.price_mutez),
    price_xtz: priceXtz,
    // Never trusted from the file -- a link the user clicks is rebuilt from the
    // token's own contract and id, so a tampered file can't point at a drainer.
    objkt_url: `https://objkt.com/asset/${contractAddress}/${tokenId}`,
    rarity: rarity && RARITY_TIERS.has(rarity)
      ? (rarity as CardRarity)
      : (priceXtz === undefined
        ? calculateSupplyRarity(editions)
        : calculateRarity(editions, priceXtz)),
    quantity_owned: readFiniteNumber(raw.quantity_owned),
    // Absent on every wishlist saved before video playback existed, which is
    // correct: no mime means the card renders as an image, exactly as before.
    mime: readString(raw.mime),
  };
}

export function serializeWishlist(cards: NFTCard[], exportedAt = new Date()): string {
  return JSON.stringify(
    {
      version: WISHLIST_EXPORT_VERSION,
      exported_at: exportedAt.toISOString(),
      cards,
    },
    null,
    2,
  );
}

export function wishlistExportFilename(exportedAt = new Date()): string {
  return `tzdeck-wishlist-${exportedAt.toISOString().slice(0, 10)}.json`;
}

/**
 * Reads an export file back into cards, dropping entries it can't trust instead
 * of failing the import -- one malformed card shouldn't cost the user the other
 * forty. Throws only when the file holds no card list at all.
 */
export function parseWishlistExport(raw: string): ParsedWishlist {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That file couldn't be read as JSON.");
  }

  // A bare array is the shape the wishlist takes in localStorage, so a raw copy
  // of that value imports as readily as an export file does.
  const isBareArray = Array.isArray(parsed);
  const entries = isBareArray
    ? parsed
    : (parsed as { cards?: unknown } | null)?.cards;

  if (!Array.isArray(entries)) {
    throw new Error("That file isn't a TzDeck wishlist export.");
  }

  const cards: NFTCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const entry of entries) {
    const card = readCard(entry);
    if (!card) {
      skipped += 1;
      continue;
    }

    const key = getCardKey(card);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }

    seen.add(key);
    cards.push(card);
  }

  return {
    cards,
    exportedAt: isBareArray
      ? null
      : readString((parsed as { exported_at?: unknown }).exported_at) ?? null,
    skipped,
  };
}

/** Existing cards keep their place and their stored copy; new ones follow. */
export function mergeWishlists(existing: NFTCard[], incoming: NFTCard[]): NFTCard[] {
  const seen = new Set(existing.map(getCardKey));
  return [...existing, ...incoming.filter((card) => !seen.has(getCardKey(card)))];
}

export interface RefreshedWishlist {
  cards: NFTCard[];
  /** Cards re-resolved against OBJKT. */
  refreshed: number;
  /** Cards left on their stored copy because OBJKT didn't answer for them. */
  stale: number;
}

/**
 * Re-prices a wishlist against OBJKT, in place and in order. A card OBJKT has
 * nothing to say about keeps whatever was stored -- an unreachable API or a
 * delisted token costs accuracy, never the entry itself.
 */
export async function refreshWishlist(cards: NFTCard[]): Promise<RefreshedWishlist> {
  const resolved = await fetchCardsByKeys(cards);
  let refreshed = 0;

  const merged = cards.map((card) => {
    const fresh = resolved.get(getCardKey(card));
    if (!fresh) return card;
    refreshed += 1;
    return fresh;
  });

  return { cards: merged, refreshed, stale: cards.length - refreshed };
}
