import { GraphQLClient } from "graphql-request";

const OBJKT_API_URL = process.env.NEXT_PUBLIC_OBJKT_API_URL || "https://data.objkt.com/v3/graphql";
export const objktClient = new GraphQLClient(OBJKT_API_URL);

export type CardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const RARITY_THRESHOLDS = {
  legendaryPrice: 50,
  epicEditions: 5,
  epicPrice: 20,
  rareEditions: 25,
  rarePrice: 5,
  uncommonEditions: 100,
  uncommonPrice: 1,
} as const;

export const RARITY_LEGEND: ReadonlyArray<{
  tier: CardRarity;
  label: string;
  rule: string;
}> = [
  {
    tier: "legendary",
    label: "Legendary",
    rule: `1 of 1 or ${RARITY_THRESHOLDS.legendaryPrice}ꜩ+`,
  },
  {
    tier: "epic",
    label: "Epic",
    rule: `≤${RARITY_THRESHOLDS.epicEditions} editions or ${RARITY_THRESHOLDS.epicPrice}ꜩ+`,
  },
  {
    tier: "rare",
    label: "Rare",
    rule: `≤${RARITY_THRESHOLDS.rareEditions} editions or ${RARITY_THRESHOLDS.rarePrice}ꜩ+`,
  },
  {
    tier: "uncommon",
    label: "Uncommon",
    rule: `≤${RARITY_THRESHOLDS.uncommonEditions} editions or ${RARITY_THRESHOLDS.uncommonPrice}ꜩ+`,
  },
  { tier: "common", label: "Common", rule: "Open edition · under 1ꜩ" },
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

export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
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
  const match = clean.match(/\/ipfs\/([^#]+)/);
  if (match) return match[1];
  if (/^(Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+)/.test(clean)) return clean;
  return null;
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
  if (editions === 1) return "legendary";
  if (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.legendaryPrice) return "legendary";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.epicEditions)
    || (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.epicPrice)) return "epic";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.rareEditions)
    || (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.rarePrice)) return "rare";
  if ((editions !== undefined && editions <= RARITY_THRESHOLDS.uncommonEditions)
    || (priceXtz !== undefined && priceXtz >= RARITY_THRESHOLDS.uncommonPrice)) return "uncommon";
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
    rarity: calculateRarity(editions, priceXtz),
    quantity_owned: options.quantityOwned,
  };
}

interface ObjktTokenHolderResponse {
  token_holder: Array<{
    quantity: number;
    token: ObjktRawToken;
  }>;
}

interface ObjktListingResponse {
  listing: Array<{
    id: number;
    price: number;
    token: ObjktRawToken;
  }>;
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
            rarity: calculateRarity(editions),
            quantity_owned: Number(item.balance || 1),
          };
        });
    }
  } catch (tzktErr) {
    console.error("TzKT fallback also failed:", tzktErr);
  }

  return [];
}

export async function fetchRandomPack(count = 5): Promise<NFTCard[]> {
  const randomOffset = Math.floor(Math.random() * 800);
  const fetchLimit = Math.max(count * 4, 24);

  const query = `
    query RandomActiveListings($limit: Int!, $offset: Int!) {
      listing(
        where: {
          status: { _eq: "active" },
          price: { _gt: 0 },
          token: { display_uri: { _is_null: false } }
        },
        limit: $limit,
        offset: $offset,
        order_by: { id: desc }
      ) {
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
      }
    }
  `;

  try {
    let data = await objktClient.request<ObjktListingResponse>(query, {
      limit: fetchLimit,
      offset: randomOffset,
    });

    let listings = data?.listing || [];
    if (listings.length === 0 && randomOffset > 0) {
      data = await objktClient.request<ObjktListingResponse>(query, {
        limit: fetchLimit,
        offset: 0,
      });
      listings = data?.listing || [];
    }

    if (listings.length === 0) {
      throw new Error("No active listings found");
    }

    const shuffled = shuffleArray(listings);
    const selected = shuffled.slice(0, count);

    return selected.map((item) => normalizeObjktToken(item.token, {
      listingId: item.id,
      priceMutez: item.price,
    }));
  } catch (err) {
    console.error("Failed to fetch random listings from OBJKT:", err);
    return [];
  }
}
