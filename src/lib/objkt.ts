export interface NFTToken {
  token_id: number;
  contract_address: string;
  name: string;
  description?: string;
  artifact_uri: string;
  display_uri?: string;
  thumbnail_uri?: string;
  artist_profile?: {
    alias?: string;
  };
  collection?: {
    name?: string;
  };
  editions?: number;
  objkt_url?: string;
}

function convertIpfsUrl(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return uri.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  return uri;
}

export async function fetchUserHoldings(address: string): Promise<NFTToken[]> {
  try {
    // Use TzKT API to fetch NFT balances for the wallet
    const url = `https://api.tzkt.io/v1/tokens/balances?account=${address}&token.metadata.artifactUri.ne=null&limit=1000`;
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) {
      console.error("Unexpected TzKT response:", data);
      return [];
    }

    // Map TzKT response to our NFTToken format
    const tokens: NFTToken[] = data
      .filter((item: any) => item.token && item.token.metadata)
      .map((item: any) => {
        const token = item.token;
        const metadata = token.metadata || {};
        const contractAddress = token.contract?.address || "";
        const tokenId = token.tokenId || token.token_id || 0;
        
        // Build Objkt URL - try multiple formats
        const objktUrl = `https://objkt.com/asset/${contractAddress}/${tokenId}`;
        
        return {
          token_id: tokenId,
          contract_address: contractAddress,
          name: metadata.name || `OBJKT #${tokenId}`,
          description: metadata.description || "",
          artifact_uri: convertIpfsUrl(metadata.artifactUri || metadata.artifact_uri || ""),
          display_uri: convertIpfsUrl(metadata.displayUri || metadata.display_uri || ""),
          thumbnail_uri: convertIpfsUrl(metadata.thumbnailUri || metadata.thumbnail_uri || ""),
          artist_profile: {
            alias: metadata.creators?.[0] || metadata.artist || undefined,
          },
          collection: {
            name: metadata.collectionName || metadata.collection || undefined,
          },
          editions: token.editions || metadata.editions || 1,
          objkt_url: objktUrl,
        };
      });

    return tokens;
  } catch (error) {
    console.error("Error fetching holdings from TzKT:", error);
    return [];
  }
}