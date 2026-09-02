"use client";

import { useWallet } from "@/context/WalletContext";
import { NFTToken } from "@/lib/objkt";
import { useEffect, useState } from "react";

export default function DeckGrid() {
  const { address } = useWallet();
  const [tokens, setTokens] = useState<NFTToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setTokens([]);
      setLoading(false);
      return;
    }

    const loadDeck = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/deck?address=${address}`);
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setTokens(data.tokens);
        }
      } catch (err) {
        setError("Failed to load deck");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadDeck();
  }, [address]);

  if (loading) {
    return (
      <div className="text-center text-gray-400 py-10">
        Loading your deck...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-400 py-10">
        {error}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="text-center text-gray-400 py-10">
        No OBJKTs found in your wallet yet.
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Your Deck</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {tokens.map((token, index) => (
        <div
  key={`${token.token_id}-${token.contract_address}-${index}`}
  className="bg-gray-900 rounded-lg overflow-hidden hover:scale-105 transition-transform cursor-pointer"
  onClick={() =>
    window.open(
      token.objkt_url || `https://objkt.com/asset/${token.token_id}`,
      "_blank"
    )
  }
>
  <div className="aspect-square bg-gray-800">
    {token.thumbnail_uri || token.display_uri || token.artifact_uri ? (
      <img
        src={token.thumbnail_uri || token.display_uri || token.artifact_uri}
        alt={token.name}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Try fallback image sources
          const img = e.target as HTMLImageElement;
          if (img.src === token.thumbnail_uri && token.display_uri) {
            img.src = token.display_uri;
          } else if (img.src === token.display_uri && token.artifact_uri) {
            img.src = token.artifact_uri;
          } else {
            img.style.display = "none";
          }
        }}
      />
    ) : (
      <div className="w-full h-full flex items-center justify-center text-gray-600">
        No image
      </div>
    )}
  </div>
  <div className="p-3">
    <p className="text-sm font-medium truncate">{token.name}</p>
    <p className="text-xs text-gray-400 truncate">
      {token.artist_profile?.alias || "Unknown artist"}
    </p>
    {token.collection?.name && (
      <p className="text-xs text-gray-500 truncate">
        {token.collection.name}
      </p>
    )}
  </div>
</div>
        ))}
      </div>
    </div>
    
  );
}