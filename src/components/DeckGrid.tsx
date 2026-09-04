"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useWallet } from "@/context/WalletContext";
import { getCardKey, NFTCard as NFTCardType } from "@/lib/objkt";
import NFTCard from "./NFTCard";
import { CardsIcon, RefreshIcon, SearchIcon } from "./icons";

interface DeckGridProps {
  onWishlistToggle?: (card: NFTCardType) => void;
  wishlistIds?: Set<string>;
  onBrowsePacks: () => void;
}

type SortBy = "latest" | "name" | "editions";

interface DeckApiResponse {
  tokens?: NFTCardType[];
  error?: string;
}

export function calculateDeckStats(tokens: NFTCardType[]) {
  const artists = new Set<string>();
  const collections = new Set<string>();
  let highRarityCount = 0;

  for (const token of tokens) {
    const artist = token.artist_alias || token.artist_address;
    if (artist) artists.add(artist);
    if (token.collection_name) collections.add(token.collection_name);
    if (
      token.rarity === "rare"
      || token.rarity === "epic"
      || token.rarity === "legendary"
    ) {
      highRarityCount += 1;
    }
  }

  return {
    total: tokens.length,
    artists: artists.size,
    collections: collections.size,
    highRarityCount,
  };
}

async function requestDeck(address: string, signal: AbortSignal): Promise<NFTCardType[]> {
  const response = await fetch(`/api/deck?address=${encodeURIComponent(address)}`, { signal });
  const data = (await response.json()) as DeckApiResponse;

  if (!response.ok || data.error) {
    throw new Error(data.error || "Failed to load deck from Tezos network.");
  }

  return data.tokens || [];
}

export default function DeckGrid({
  onWishlistToggle,
  wishlistIds = new Set(),
  onBrowsePacks,
}: DeckGridProps) {
  const { address } = useWallet();
  const [tokens, setTokens] = useState<NFTCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  // Filters and Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("latest");

  useEffect(() => {
    if (!address) return;

    const controller = new AbortController();

    requestDeck(address, controller.signal)
      .then((nextTokens) => {
        setTokens(nextTokens);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        console.error(requestError);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load deck from Tezos network.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [address, requestVersion]);

  const reloadDeck = () => {
    setLoading(true);
    setError(null);
    setRequestVersion((version) => version + 1);
  };

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

  const stats = useMemo(() => calculateDeckStats(tokens), [tokens]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
        <p className="text-sm font-medium text-text-secondary">Loading your Tezos collection & deck...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-8 text-center max-w-lg mx-auto my-12">
        <p className="text-red-300 font-medium mb-4">{error}</p>
        <button
          onClick={reloadDeck}
          className="button-primary px-4 py-2 text-xs font-semibold"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-3xl border border-border-default bg-surface-1/80 p-12 text-center max-w-xl mx-auto my-12 backdrop-blur-md">
        <CardsIcon className="mx-auto h-10 w-10 text-accent-hover" />
        <h3 className="mt-3 text-lg font-bold text-text-primary">No OBJKTs Found in Connected Wallet</h3>
        <p className="mt-2 text-sm text-text-secondary">
          Your wallet doesn’t have any OBJKT NFTs yet. Open booster packs in TzDeck to discover and collect new art pieces!
        </p>
        <button
          type="button"
          onClick={onBrowsePacks}
          className="button-primary mt-6 px-4 py-2.5 text-xs font-semibold"
        >
          Browse Booster Packs
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Stats Header Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-text-secondary">Total Cards</span>
          <p className="mt-1 text-2xl font-black tabular-nums text-text-primary">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-text-secondary">Unique Artists</span>
          <p className="mt-1 text-2xl font-black tabular-nums text-indigo-300">{stats.artists}</p>
        </div>
        <div className="rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-text-secondary">Collections</span>
          <p className="mt-1 text-2xl font-black tabular-nums text-purple-300">{stats.collections}</p>
        </div>
        <div className="rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
          <span className="text-xs font-medium text-text-secondary">Rares & Epics</span>
          <p className="mt-1 text-2xl font-black tabular-nums text-amber-300">
            {stats.highRarityCount}
          </p>
        </div>
      </div>

      <p className="text-xs text-text-tertiary">
        Deck rarity is graded by edition size alone because wallet holdings do not include listing prices.
      </p>

      {/* Filter and Search Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder="Search deck by title, artist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border-default bg-surface-2 px-3.5 py-2 pl-9 text-xs text-text-primary placeholder:text-text-muted focus:border-accent"
          />
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Rarity Filter */}
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs text-text-secondary focus:border-accent"
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
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs text-text-secondary focus:border-accent"
          >
            <option value="latest">Latest Acquired</option>
            <option value="name">Name (A-Z)</option>
            <option value="editions">Smallest Edition Size</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={reloadDeck}
            title="Refresh Deck"
            aria-label="Refresh deck"
            className="button-secondary h-10 w-10"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {/* Deck Grid */}
      {filteredTokens.length === 0 ? (
        <div className="py-12 text-center text-text-tertiary text-sm">
          No cards match your filter criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredTokens.map((token) => {
            const cardKey = getCardKey(token);
            const isWish = wishlistIds.has(cardKey);
            return (
              <NFTCard
                key={cardKey}
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
