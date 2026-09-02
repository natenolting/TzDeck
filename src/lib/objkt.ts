import { GraphQLClient } from "graphql-request";

const OBJKT_API_URL = process.env.NEXT_PUBLIC_OBJKT_API_URL || "https://data.objkt.com/v3/graphql";
export const objktClient = new GraphQLClient(OBJKT_API_URL);

export type CardRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

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

const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

export function convertIpfsUrl(uri?: string, gatewayIndex = 0): string {
  if (!uri) return "";
  const cleanUri = uri.trim();
  
  if (cleanUri.startsWith("ipfs://ipfs/")) {
    const hash = cleanUri.replace("ipfs://ipfs/", "");
    return `${IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length]}${hash}`;
  }
  
  if (cleanUri.startsWith("ipfs://")) {
    const hash = cleanUri.replace("ipfs://", "");
    return `${IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length]}${hash}`;
  }
  
  if (cleanUri.startsWith("http://") || cleanUri.startsWith("https://")) {
    return cleanUri;
  }
  
  return cleanUri;
}

export function calculateRarity(editions?: number, priceXtz?: number): CardRarity {
  if (editions === 1) return "legendary";
  if (priceXtz && priceXtz >= 50) return "legendary";
  if ((editions && editions <= 5) || (priceXtz && priceXtz >= 20)) return "epic";
  if ((editions && editions <= 25) || (priceXtz && priceXtz >= 5)) return "rare";
  if ((editions && editions <= 100) || (priceXtz && priceXtz >= 1)) return "uncommon";
  return "common";
}

interface ObjktTokenHolderResponse {
  token_holder: Array<{
    quantity: number;
    token: {
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
    };
  }>;
}

interface ObjktListingResponse {
  listing: Array<{
    id: number;
    price: number;
    token: {
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
    };
  }>;
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
        order_by: { last_transfer_timestamp: desc_nulls_last }
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
        .map((h) => {
          const t = h.token;
          const artist = t.creators?.[0]?.holder;
          const editions = t.supply ?? 1;
          const displayUri = t.display_uri || t.thumbnail_uri || t.artifact_uri || "";
          
          return {
            token_id: t.token_id,
            contract_address: t.fa_contract,
            name: t.name || `OBJKT #${t.token_id}`,
            description: t.description || undefined,
            display_uri: convertIpfsUrl(displayUri),
            artifact_uri: convertIpfsUrl(t.artifact_uri || undefined),
            thumbnail_uri: convertIpfsUrl(t.thumbnail_uri || displayUri),
            artist_alias: artist?.alias || (artist?.address ? `${artist.address.slice(0, 6)}...${artist.address.slice(-4)}` : "Unknown Artist"),
            artist_address: artist?.address,
            collection_name: t.fa?.name || "Tezos Art",
            editions,
            objkt_url: `https://objkt.com/asset/${t.fa_contract}/${t.token_id}`,
            rarity: calculateRarity(editions),
            quantity_owned: h.quantity,
          };
        });
    }
  } catch (err) {
    console.warn("OBJKT token_holder query failed, attempting TzKT fallback:", err);
  }

  // Fallback to TzKT API
  try {
    const url = `https://api.tzkt.io/v1/tokens/balances?account=${address}&token.metadata.artifactUri.ne=null&limit=200`;
    const response = await fetch(url);
    const tzktData = await response.json();

    if (Array.isArray(tzktData)) {
      return tzktData
        .filter((item: any) => item.token && item.token.metadata)
        .map((item: any) => {
          const token = item.token;
          const metadata = token.metadata || {};
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
    const data = await objktClient.request<ObjktListingResponse>(query, {
      limit: fetchLimit,
      offset: randomOffset,
    });

    const listings = data?.listing || [];
    if (listings.length === 0) {
      throw new Error("No listings found in random offset range");
    }

    const shuffled = [...listings].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);

    return selected.map((item) => {
      const t = item.token;
      const artist = t.creators?.[0]?.holder;
      const editions = t.supply ?? 1;
      const priceXtz = item.price / 1_000_000;
      const displayUri = t.display_uri || t.thumbnail_uri || t.artifact_uri || "";

      return {
        listing_id: item.id,
        token_id: t.token_id,
        contract_address: t.fa_contract,
        name: t.name || `OBJKT #${t.token_id}`,
        description: t.description || undefined,
        display_uri: convertIpfsUrl(displayUri),
        artifact_uri: convertIpfsUrl(t.artifact_uri || undefined),
        thumbnail_uri: convertIpfsUrl(t.thumbnail_uri || displayUri),
        artist_alias: artist?.alias || (artist?.address ? `${artist.address.slice(0, 6)}...${artist.address.slice(-4)}` : "Tezos Artist"),
        artist_address: artist?.address,
        collection_name: t.fa?.name || "OBJKT Collection",
        editions,
        price_mutez: item.price,
        price_xtz: Number(priceXtz.toFixed(3)),
        objkt_url: `https://objkt.com/asset/${t.fa_contract}/${t.token_id}`,
        rarity: calculateRarity(editions, priceXtz),
      };
    });
  } catch (err) {
    console.error("Failed to fetch random listings from OBJKT:", err);
    return [];
  }
}