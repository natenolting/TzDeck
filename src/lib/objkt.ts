import { GraphQLClient } from "graphql-request";
import { CID } from "multiformats/cid";

const OBJKT_API_URL = process.env.NEXT_PUBLIC_OBJKT_API_URL || "https://data.objkt.com/v3/graphql";
export const objktClient = new GraphQLClient(OBJKT_API_URL);

export type CardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_THRESHOLDS = {
  topTierPrice: 500,
  epicEditions: 5,
  scarceTierPrice: 180,
  rareEditions: 1,
  rarePrice: 110,
  // Edition-only "rare" breakpoint for calculateSupplyRarity's 5-tier ladder --
  // distinct from rareEditions above, which is a price-inclusive threshold.
  // Placeholder value (Open Questions: exact epic/legendary edition thresholds).
  supplyRareEditions: 10,
  uncommonEditions: 25,
  uncommonPrice: 5,
} as const;

/** Renders an edition ceiling the way a collector reads it: a lone edition is "1 of 1". */
function formatEditionRule(maximumEditions: number): string {
  return maximumEditions === 1 ? "1 of 1" : `≤${maximumEditions} editions`;
}

export const RARITY_LEGEND: ReadonlyArray<{
  tier: CardRarity;
  label: string;
  rule: string;
}> = [
  {
    tier: "legendary",
    label: "Legendary",
    rule: `${formatEditionRule(1)} and ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
  },
  {
    tier: "epic",
    label: "Epic",
    rule: `${formatEditionRule(RARITY_THRESHOLDS.epicEditions)} and ${RARITY_THRESHOLDS.scarceTierPrice}ꜩ+ · or ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`,
  },
  {
    tier: "rare",
    label: "Rare",
    rule: `${formatEditionRule(RARITY_THRESHOLDS.rareEditions)} or ${RARITY_THRESHOLDS.rarePrice}ꜩ+`,
  },
  {
    tier: "uncommon",
    label: "Uncommon",
    rule: `${formatEditionRule(RARITY_THRESHOLDS.uncommonEditions)} or ${RARITY_THRESHOLDS.uncommonPrice}ꜩ+`,
  },
  {
    tier: "common",
    label: "Common",
    rule: `>${RARITY_THRESHOLDS.uncommonEditions} editions and under ${RARITY_THRESHOLDS.uncommonPrice}ꜩ`,
  },
];

export interface NFTCard {
  listing_id?: number;
  token_id: string;
  contract_address: string;
  name: string;
  description?: string;
  artifact_uri?: string;
  display_uri?: string;
  thumbnail_uri?: string;
  artist_alias?: string;
  artist_address?: string;
  collection_name?: string;
  editions?: number;
  price_mutez?: number;
  price_xtz?: number;
  objkt_url: string;
  rarity: CardRarity;
  quantity_owned?: number;
}

export function formatShortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getCardKey(
  card: Pick<NFTCard, "contract_address" | "token_id">,
): string {
  return `${card.contract_address}:${card.token_id}`;
}

// Pinata's public gateway now rate-limits every anonymous request (429,
// verified 2026-09-05) -- it is a dead hop, not a real fallback, so it is
// left out rather than kept as a step every retry chain has to burn through.
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://{cid}.ipfs.dweb.link/",
];

export function extractIpfsHash(uri?: string): string | null {
  if (!uri) return null;
  const clean = uri.trim();
  if (clean.startsWith("/api/media?")) {
    const params = new URLSearchParams(clean.slice(clean.indexOf("?") + 1));
    const proxiedIpfs = params.get("ipfs");
    if (proxiedIpfs) return extractIpfsHash(proxiedIpfs);
  }
  if (clean.startsWith("ipfs://ipfs/")) return clean.slice(12);
  if (clean.startsWith("ipfs://")) return clean.slice(7);
  const subdomain = clean.match(/^https?:\/\/([^.]+)\.ipfs\.[^/?#]+(.*)$/i);
  if (subdomain) return subdomain[1] + (subdomain[2] === "/" ? "" : subdomain[2]);
  const match = clean.match(/\/ipfs\/(.+)/);
  if (match) return match[1];
  try {
    CID.parse(clean.split(/[/?#]/, 1)[0]);
    return clean;
  } catch {
    return null;
  }
}

export function convertIpfsUrl(uri?: string, gatewayIndex = 0): string {
  if (!uri) return "";
  const clean = uri.trim();

  if (clean.startsWith("/api/media?")) {
    const params = new URLSearchParams(clean.slice(clean.indexOf("?") + 1));
    const proxiedUrl = params.get("url");
    if (proxiedUrl) return convertIpfsUrl(proxiedUrl, gatewayIndex);
  }

  const hash = extractIpfsHash(uri);
  if (hash) {
    const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length];
    if (gateway.includes("{cid}")) {
      const [cid] = hash.split(/[/?#]/, 1);
      const suffix = hash.slice(cid.length);
      try {
        // DNS hostnames require CIDv1/base32, including for legacy Qm… CIDs.
        const hostnameCid = CID.parse(cid).toV1().toString();
        return `${gateway.replace("{cid}", hostnameCid)}${suffix.replace(/^\//, "")}`;
      } catch {
        // Malformed token metadata must not throw during card rendering.
        return uri;
      }
    }
    return `${gateway}${hash}`;
  }
  return uri;
}

export function getCardImageSources(...uris: Array<string | undefined>): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();

  for (const uri of uris) {
    const clean = uri?.trim();
    if (!clean) continue;

    const hash = extractIpfsHash(clean);
    const identity = hash ? `ipfs:${hash}` : `url:${clean}`;
    if (seen.has(identity)) continue;

    seen.add(identity);
    sources.push(clean);
  }

  return sources;
}

export function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

export function calculateRarity(editions?: number, priceXtz?: number): CardRarity {
  if (editions === 1
    && priceXtz !== undefined
    && priceXtz >= RARITY_THRESHOLDS.topTierPrice) return "legendary";
  if ((editions !== undefined
      && editions <= RARITY_THRESHOLDS.epicEditions
      && priceXtz !== undefined
      && priceXtz >= RARITY_THRESHOLDS.scarceTierPrice)
    || (priceXtz !== undefined
      && priceXtz >= RARITY_THRESHOLDS.topTierPrice)) return "epic";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.rareEditions)
    || (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.rarePrice)) return "rare";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.uncommonEditions)
    || (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.uncommonPrice)) return "uncommon";
  return "common";
}

export function calculateSupplyRarity(editions?: number): CardRarity {
  if (editions === 1) return "legendary";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.epicEditions) return "epic";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.supplyRareEditions) return "rare";
  if (editions !== undefined
    && editions <= RARITY_THRESHOLDS.uncommonEditions) return "uncommon";
  return "common";
}

export interface ObjktRawToken {
  name: string | null;
  token_id: string;
  fa_contract: string;
  display_uri: string | null;
  artifact_uri: string | null;
  thumbnail_uri: string | null;
  supply: number | null;
  description?: string | null;
  creators?: Array<{
    holder: {
      alias: string | null;
      address: string;
    };
  }>;
  fa?: {
    name: string | null;
  };
}

interface NormalizeTokenOptions {
  listingId?: number;
  priceMutez?: number;
  quantityOwned?: number;
}

export function normalizeObjktToken(
  token: ObjktRawToken,
  options: NormalizeTokenOptions = {},
): NFTCard {
  const editions = token.supply ?? 1;
  const priceXtz = options.priceMutez !== undefined
    ? options.priceMutez / 1_000_000
    : undefined;
  const artist = token.creators?.[0]?.holder;
  const displayUri = token.display_uri || token.thumbnail_uri || token.artifact_uri || "";

  return {
    listing_id: options.listingId,
    token_id: token.token_id,
    contract_address: token.fa_contract,
    name: token.name || `OBJKT #${token.token_id}`,
    description: token.description || undefined,
    display_uri: convertIpfsUrl(displayUri),
    artifact_uri: convertIpfsUrl(token.artifact_uri || undefined),
    thumbnail_uri: convertIpfsUrl(token.thumbnail_uri || displayUri),
    artist_alias: artist?.alias || (artist?.address
      ? formatShortAddress(artist.address)
      : "Unknown Artist"),
    artist_address: artist?.address,
    collection_name: token.fa?.name || "Tezos Art",
    editions,
    price_mutez: options.priceMutez,
    price_xtz: priceXtz !== undefined ? Number(priceXtz.toFixed(3)) : undefined,
    objkt_url: `https://objkt.com/asset/${token.fa_contract}/${token.token_id}`,
    rarity: priceXtz === undefined
      ? calculateSupplyRarity(editions)
      : calculateRarity(editions, priceXtz),
    quantity_owned: options.quantityOwned,
  };
}

interface ObjktTokenHolderResponse {
  token_holder: Array<{
    quantity: number;
    token: ObjktRawToken;
  }>;
}

export interface ObjktListingRow {
  id: number;
  price: number;
  token: ObjktRawToken;
}

interface ObjktListingResponse {
  listing: ObjktListingRow[];
}

/** Three independently offset windows, aliased so one round trip covers them all. */
interface ObjktPackWindowsResponse {
  w1?: ObjktListingRow[];
  w2?: ObjktListingRow[];
  w3?: ObjktListingRow[];
}

interface TzktTokenBalance {
  balance?: number | string;
  token?: {
    tokenId?: number | string;
    token_id?: number | string;
    totalSupply?: number | string;
    contract?: {
      address?: string;
      alias?: string;
    };
    metadata?: {
      name?: string;
      description?: string;
      artifactUri?: string;
      displayUri?: string;
      thumbnailUri?: string;
      editions?: number | string;
      creators?: string[];
      artist?: string;
      collectionName?: string;
    };
  };
}

function isTzktTokenBalance(value: unknown): value is TzktTokenBalance {
  if (!value || typeof value !== "object") return false;
  const token = (value as { token?: unknown }).token;
  if (!token || typeof token !== "object") return false;
  const metadata = (token as { metadata?: unknown }).metadata;
  return Boolean(metadata && typeof metadata === "object");
}

export async function fetchUserHoldings(address: string): Promise<NFTCard[]> {
  const query = `
    query UserHoldings($address: String!) {
      token_holder(
        where: {
          holder_address: { _eq: $address },
          quantity: { _gt: "0" }
        },
        limit: 250,
        order_by: { last_incremented_at: desc_nulls_last }
      ) {
        quantity
        token {
          name
          token_id
          fa_contract
          display_uri
          artifact_uri
          thumbnail_uri
          supply
          description
          creators {
            holder {
              alias
              address
            }
          }
          fa {
            name
          }
        }
      }
    }
  `;

  try {
    const data = await objktClient.request<ObjktTokenHolderResponse>(query, { address });
    
    if (data?.token_holder?.length > 0) {
      return data.token_holder
        .filter((h) => h.token && (h.token.display_uri || h.token.artifact_uri || h.token.name))
        .map((holding) => normalizeObjktToken(holding.token, {
          quantityOwned: holding.quantity,
        }));
    }
  } catch (err) {
    console.warn("OBJKT token_holder query failed, attempting TzKT fallback:", err);
  }

  // Fallback to TzKT API
  try {
    const url = `https://api.tzkt.io/v1/tokens/balances?account=${address}&token.metadata.artifactUri.ne=null&limit=200`;
    const response = await fetch(url);
    const tzktData: unknown = await response.json();

    if (Array.isArray(tzktData)) {
      return tzktData
        .filter(isTzktTokenBalance)
        .map((item) => {
          const token = item.token!;
          const metadata = token.metadata!;
          const contractAddress = token.contract?.address || "";
          const tokenId = String(token.tokenId || token.token_id || "0");
          const editions = Number(token.totalSupply || metadata.editions || 1);
          const displayUri = metadata.displayUri || metadata.thumbnailUri || metadata.artifactUri || "";

          return {
            token_id: tokenId,
            contract_address: contractAddress,
            name: metadata.name || `OBJKT #${tokenId}`,
            description: metadata.description || undefined,
            display_uri: convertIpfsUrl(displayUri),
            artifact_uri: convertIpfsUrl(metadata.artifactUri || undefined),
            thumbnail_uri: convertIpfsUrl(metadata.thumbnailUri || displayUri),
            artist_alias: metadata.creators?.[0] || metadata.artist || "Unknown Artist",
            collection_name: token.contract?.alias || metadata.collectionName || "Tezos NFT",
            editions,
            objkt_url: `https://objkt.com/asset/${contractAddress}/${tokenId}`,
            rarity: calculateSupplyRarity(editions),
            quantity_owned: Number(item.balance || 1),
          };
        });
    }
  } catch (tzktErr) {
    console.error("TzKT fallback also failed:", tzktErr);
  }

  return [];
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
function cheapestPerToken(listings: ObjktListingRow[]): ObjktListingRow[] {
  const byToken = new Map<string, ObjktListingRow>();

  for (const item of listings) {
    const key = `${item.token.fa_contract}:${item.token.token_id}`;
    const existing = byToken.get(key);
    if (!existing || item.price < existing.price) {
      byToken.set(key, item);
    }
  }

  return [...byToken.values()];
}

export async function fetchRandomPack(count = 5): Promise<NFTCard[]> {
  // Three windows rather than one contiguous block. A single offset+limit over
  // `id desc` returns adjacent listing IDs, so an artist who bulk-lists fills
  // the whole window -- which is how a pack ends up being one collection. The
  // bands are staggered so the first is nearly always populated while the
  // others reach deeper than the newest few hundred listings.
  const windowSize = Math.max(count * 2, 10);
  const offsets = [
    Math.floor(Math.random() * 400),
    400 + Math.floor(Math.random() * 1_200),
    1_600 + Math.floor(Math.random() * 2_400),
  ];

  const listingFields = `
    id
    price
    token {
      name
      token_id
      fa_contract
      display_uri
      artifact_uri
      thumbnail_uri
      supply
      description
      creators {
        holder {
          alias
          address
        }
      }
      fa {
        name
      }
    }
  `;
  const activeWhere = `
    status: { _eq: "active" },
    price: { _gt: 0 },
    token: { display_uri: { _is_null: false } }
  `;
  const window = (alias: string, offsetVar: string) => `
    ${alias}: listing(
      where: { ${activeWhere} },
      limit: $limit,
      offset: ${offsetVar},
      order_by: { id: desc }
    ) { ${listingFields} }
  `;

  const windowsQuery = `
    query RandomActiveListings($limit: Int!, $o1: Int!, $o2: Int!, $o3: Int!) {
      ${window("w1", "$o1")}
      ${window("w2", "$o2")}
      ${window("w3", "$o3")}
    }
  `;

  const fallbackQuery = `
    query NewestActiveListings($limit: Int!) {
      listing(
        where: { ${activeWhere} },
        limit: $limit,
        offset: 0,
        order_by: { id: desc }
      ) { ${listingFields} }
    }
  `;

  try {
    const windows = await objktClient.request<ObjktPackWindowsResponse>(windowsQuery, {
      limit: windowSize,
      o1: offsets[0],
      o2: offsets[1],
      o3: offsets[2],
    });

    let listings = [
      ...(windows?.w1 || []),
      ...(windows?.w2 || []),
      ...(windows?.w3 || []),
    ];

    // Deep offsets overrun the active set on a quiet market; fall back to the
    // newest listings rather than serving a short pack.
    if (listings.length < count) {
      const fallback = await objktClient.request<ObjktListingResponse>(fallbackQuery, {
        limit: Math.max(count * 4, 24),
      });
      listings = [...listings, ...(fallback?.listing || [])];
    }

    if (listings.length === 0) {
      throw new Error("No active listings found");
    }

    const unique = cheapestPerToken(shuffleArray(listings));
    const selected = selectDiverseListings(unique, count);

    return selected.map((item) => normalizeObjktToken(item.token, {
      listingId: item.id,
      priceMutez: item.price,
    }));
  } catch (err) {
    console.error("Failed to fetch random listings from OBJKT:", err);
    return [];
  }
}
