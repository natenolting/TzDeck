"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { NFTCard as NFTCardType } from "@/lib/objkt";
import NFTCard from "./NFTCard";

interface DeckGridProps {
  onWishlistToggle?: (card: NFTCardType) => void;
  wishlistIds?: Set<string>;
}

export default function DeckGrid({ onWishlistToggle, wishlistIds = new Set() }: DeckGridProps) {
  const { address } = useWallet();
  const [tokens, setTokens] = useState<NFTCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"latest" | "name" | "editions">("latest");

  const loadDeck = async () => {
    if (!address) {
      setTokens([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deck?address=${address}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTokens(data.tokens || []);
      }
    } catch (err) {
      setError("Failed to load deck from Tezos network.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeck();
  }, [address]);

  // Derived filtered & sorted tokens
  const filteredTokens = useMemo(() => {
    let result = [...tokens];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.artist_alias && t.artist_alias.toLowerCase().includes(q)) ||
          (t.collection_name && t.collection_name.toLowerCase().includes(q))
      );
    }

    if (rarityFilter !== "all") {
      result = result.filter((t) => t.rarity === rarityFilter);
    }

    if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "editions") {
      result.sort((a, b) => (a.editions || 1) - (b.editions || 1));
    }

    return result;
  }, [tokens, searchQuery, rarityFilter, sortBy]);

  // Collection Stats
  const uniqueArtists = useMemo(() => {
    const set = new Set(tokens.map((t) => t.artist_alias || t.artist_address).filter(Boolean));
    return set.size;
  }, [tokens]);

  const uniqueCollections = useMemo(() => {
    const set = new Set(tokens.map((t) => t.collection_name).filter(Boolean));
    return set.size;
  }, [tokens]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
        <p className="text-sm font-medium text-gray-400">Loading your Tezos collection & deck...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-8 text-center max-w-lg mx-auto my-12">
        <p className="text-red-300 font-medium mb-4">{error}</p>
        <button
          onClick={loadDeck}
          className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-3xl border border-gray-800 bg-gray-900/40 p-12 text-center max-w-xl mx-auto my-12 backdrop-blur-md">
        <span className="text-4xl">🎴</span>
        <h3 className="mt-3 text-lg font-bold text-white">No OBJKTs Found in Connected Wallet</h3>
        <p className="mt-2 text-sm text-gray-400">
          Your wallet doesn’t have any OBJKT NFTs yet. Open booster packs in TzDeck to discover and collect new art pieces!
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Stats Header Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-gray-400">Total Cards</span>
          <p className="mt-1 text-2xl font-black text-white">{tokens.length}</p>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-gray-400">Unique Artists</span>
          <p className="mt-1 text-2xl font-black text-indigo-300">{uniqueArtists}</p>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-gray-400">Collections</span>
          <p className="mt-1 text-2xl font-black text-purple-300">{uniqueCollections}</p>
        </div>
        <div className="rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-gray-400">Rares & Epics</span>
          <p className="mt-1 text-2xl font-black text-amber-300">
            {tokens.filter((t) => t.rarity === "rare" || t.rarity === "epic" || t.rarity === "legendary").length}
          </p>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="Search deck by title, artist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-700/80 bg-gray-950 px-3.5 py-2 pl-9 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="absolute left-3 top-2.5 h-4 w-4 text-gray-500"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Rarity Filter */}
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="rounded-xl border border-gray-700/80 bg-gray-950 px-3 py-2 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All Rarities</option>
            <option value="legendary">Legendary</option>
            <option value="epic">Epic</option>
            <option value="rare">Rare</option>
            <option value="uncommon">Uncommon</option>
            <option value="common">Common</option>
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="rounded-xl border border-gray-700/80 bg-gray-950 px-3 py-2 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
          >
            <option value="latest">Latest Acquired</option>
            <option value="name">Name (A-Z)</option>
            <option value="editions">Smallest Edition Size</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={loadDeck}
            title="Refresh Deck"
            className="rounded-xl border border-gray-700/80 bg-gray-800/80 p-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Deck Grid */}
      {filteredTokens.length === 0 ? (
        <div className="py-12 text-center text-gray-500 text-sm">
          No cards match your filter criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredTokens.map((token, index) => {
            const isWish = wishlistIds.has(`${token.contract_address}-${token.token_id}`);
            return (
              <NFTCard
                key={`${token.token_id}-${token.contract_address}-${index}`}
                card={token}
                showCollectButton={true}
                isWishlisted={isWish}
                onToggleWishlist={onWishlistToggle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}