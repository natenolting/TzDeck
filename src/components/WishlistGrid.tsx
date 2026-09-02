"use client";

import React from "react";
import { NFTCard as NFTCardType } from "@/lib/objkt";
import NFTCard from "./NFTCard";

interface WishlistGridProps {
  wishlist: NFTCardType[];
  onWishlistToggle: (card: NFTCardType) => void;
  onClearWishlist: () => void;
}

export default function WishlistGrid({
  wishlist,
  onWishlistToggle,
  onClearWishlist,
}: WishlistGridProps) {
  if (wishlist.length === 0) {
    return (
      <div className="rounded-3xl border border-gray-800 bg-gray-900/40 p-12 text-center max-w-xl mx-auto my-12 backdrop-blur-md">
        <span className="text-4xl">⭐</span>
        <h3 className="mt-3 text-lg font-bold text-white">Your Wishlist is Empty</h3>
        <p className="mt-2 text-sm text-gray-400">
          When opening booster packs, click the heart icon on any card to save it to your wishlist and collect it on OBJKT later!
        </p>
      </div>
    );
  }

  const totalValue = wishlist.reduce((sum, c) => sum + (c.price_xtz || 0), 0);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-gray-800/80 bg-gray-900/60 p-4 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold text-white">Saved Wishlist ({wishlist.length})</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Total listed value: {totalValue.toFixed(2)} XTZ
          </p>
        </div>

        <button
          onClick={onClearWishlist}
          className="rounded-xl border border-red-800/50 bg-red-950/40 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/60 transition-colors"
        >
          Clear Wishlist
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {wishlist.map((card, index) => (
          <NFTCard
            key={`wishlist-${card.contract_address}-${card.token_id}-${index}`}
            card={card}
            showCollectButton={true}
            isWishlisted={true}
            onToggleWishlist={onWishlistToggle}
          />
        ))}
      </div>
    </div>
  );
}
