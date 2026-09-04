"use client";

import React from "react";
import { getCardKey, NFTCard as NFTCardType } from "@/lib/objkt";
import NFTCard from "./NFTCard";
import { HeartIcon } from "./icons";

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
      <div className="rounded-3xl border border-border-default bg-surface-1/80 p-12 text-center max-w-xl mx-auto my-12 backdrop-blur-md">
        <HeartIcon
          filled
          className="mx-auto h-10 w-10 text-accent-hover"
        />
        <h3 className="mt-3 text-lg font-bold text-text-primary">Your Wishlist is Empty</h3>
        <p className="mt-2 text-sm text-text-secondary">
          When opening booster packs, click the heart icon on any card to save it to your wishlist and collect it on OBJKT later!
        </p>
      </div>
    );
  }

  const totalValue = wishlist.reduce((sum, c) => sum + (c.price_xtz || 0), 0);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold tabular-nums text-text-primary">Saved Wishlist ({wishlist.length})</h2>
          <p className="text-xs text-text-secondary mt-0.5 tabular-nums">
            Total listed value: {totalValue.toFixed(2)} XTZ
          </p>
        </div>

        <button
          onClick={onClearWishlist}
          className="button-secondary px-3.5 py-1.5 text-xs font-semibold"
        >
          Clear Wishlist
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {wishlist.map((card) => (
          <NFTCard
            key={getCardKey(card)}
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
