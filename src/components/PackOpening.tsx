"use client";

import React, { useState } from "react";
import { NFTCard as NFTCardType } from "@/lib/objkt";
import NFTCard from "./NFTCard";
import { soundManager } from "@/lib/sound";
import { motion, AnimatePresence } from "framer-motion";

interface PackOpeningProps {
  onWishlistToggle?: (card: NFTCardType) => void;
  wishlistIds?: Set<string>;
}

type PackState = "idle" | "opening" | "revealing" | "complete";

export default function PackOpening({
  onWishlistToggle,
  wishlistIds = new Set(),
}: PackOpeningProps) {
  const [packState, setPackState] = useState<PackState>("idle");
  const [cards, setCards] = useState<NFTCardType[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPack = async () => {
    setIsLoading(true);
    setError(null);
    try {
      soundManager.playPackRip();
      setPackState("opening");

      const response = await fetch("/api/random-pack?count=5");
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to fetch booster pack");
      }

      setCards(data.cards);
      setFlippedIndices(new Set());

      // Small delay for the tear animation before showing cards
      setTimeout(() => {
        setPackState("revealing");
        setIsLoading(false);
      }, 700);
    } catch (err: unknown) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate pack. Please try again.",
      );
      setPackState("idle");
      setIsLoading(false);
    }
  };

  const handleFlipCard = (index: number) => {
    if (flippedIndices.has(index)) return;

    const newFlipped = new Set(flippedIndices);
    newFlipped.add(index);
    setFlippedIndices(newFlipped);

    const card = cards[index];
    soundManager.playCardFlip(card?.rarity);

    if (newFlipped.size === cards.length) {
      setTimeout(() => {
        setPackState("complete");
        soundManager.playPackComplete();
      }, 600);
    }
  };

  const handleRevealAll = () => {
    const all = new Set(cards.map((_, i) => i));
    setFlippedIndices(all);
    setPackState("complete");
    soundManager.playPackComplete();
  };

  const handleReset = () => {
    setPackState("idle");
    setCards([]);
    setFlippedIndices(new Set());
  };

  const totalValue = cards.reduce((sum, c) => sum + (c.price_xtz || 0), 0);
  const legendaryCount = cards.filter((c) => c.rarity === "legendary").length;
  const epicCount = cards.filter((c) => c.rarity === "epic").length;

  return (
    <div className="relative w-full max-w-6xl mx-auto py-6">
      <AnimatePresence mode="wait">
        {/* ================= IDLE STATE: SEALED PACK ================= */}
        {packState === "idle" && (
          <motion.div
            key="sealed-pack"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center justify-center text-center"
          >
            {/* Booster Foil Pack Graphic */}
            <motion.div
              whileHover={{ scale: 1.05, rotateY: 5, y: -8 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              onClick={openPack}
              className="group relative h-[420px] w-[290px] cursor-pointer rounded-3xl border-4 border-indigo-400/40 bg-gradient-to-b from-indigo-950 via-slate-900 to-purple-950 p-6 shadow-2xl shadow-indigo-900/60 transition-all hover:border-indigo-300 hover:shadow-indigo-500/50 select-none overflow-hidden"
            >
              {/* Metallic Foil Sheen */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-cyan-500/20 via-fuchsia-500/20 to-amber-500/20 opacity-70 group-hover:opacity-100 transition-opacity" />
              <div className="pointer-events-none absolute -top-24 -left-24 h-56 w-56 rounded-full bg-indigo-400/30 blur-2xl group-hover:bg-cyan-400/40 transition-colors" />
              <div className="pointer-events-none absolute -bottom-24 -right-24 h-56 w-56 rounded-full bg-purple-500/30 blur-2xl group-hover:bg-fuchsia-400/40 transition-colors" />

              {/* Pack Top Crimped Edge */}
              <div className="relative z-10 flex items-center justify-between border-b border-indigo-400/30 pb-3">
                <span className="text-xs font-black tracking-widest text-indigo-300">
                  TZDECK • BOOSTER
                </span>
                <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-200">
                  5 CARDS
                </span>
              </div>

              {/* Pack Center Artwork */}
              <div className="relative z-10 my-8 flex flex-col items-center justify-center">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-2xl border-2 border-indigo-400/60 bg-gradient-to-br from-indigo-600/30 via-purple-600/30 to-pink-600/30 shadow-xl backdrop-blur-md">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
                    className="absolute inset-1 rounded-xl border border-dashed border-indigo-300/40"
                  />
                  <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-indigo-200 to-purple-300">
                    ꜩ
                  </span>
                </div>
                <h2 className="mt-4 text-2xl font-black tracking-wider text-white">
                  OBJKT PACK
                </h2>
                <p className="text-xs text-indigo-200/80 font-medium">
                  Random Active Marketplace Pulls
                </p>
              </div>

              {/* Pack Bottom Footer */}
              <div className="relative z-10 border-t border-indigo-400/30 pt-3">
                <div className="rounded-xl bg-indigo-600/40 py-2 text-xs font-bold text-white border border-indigo-400/50 shadow-md group-hover:bg-indigo-500 transition-colors">
                  {isLoading ? "Opening..." : "Click to Rip Open"}
                </div>
              </div>
            </motion.div>

            {/* Error prompt */}
            {error && (
              <div className="mt-4 rounded-xl bg-red-950/80 border border-red-500/50 px-4 py-2 text-sm text-red-300 max-w-md">
                {error}
              </div>
            )}

            {/* Odds & Details banner */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-400 max-w-lg">
              <span className="flex items-center gap-1.5 rounded-lg bg-gray-900/80 px-3 py-1.5 border border-gray-800">
                <span className="h-2 w-2 rounded-full bg-slate-400" /> Common: 50%
              </span>
              <span className="flex items-center gap-1.5 rounded-lg bg-gray-900/80 px-3 py-1.5 border border-gray-800">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Uncommon: 25%
              </span>
              <span className="flex items-center gap-1.5 rounded-lg bg-gray-900/80 px-3 py-1.5 border border-gray-800">
                <span className="h-2 w-2 rounded-full bg-cyan-400" /> Rare: 15%
              </span>
              <span className="flex items-center gap-1.5 rounded-lg bg-gray-900/80 px-3 py-1.5 border border-gray-800">
                <span className="h-2 w-2 rounded-full bg-purple-400" /> Epic: 7%
              </span>
              <span className="flex items-center gap-1.5 rounded-lg bg-gray-900/80 px-3 py-1.5 border border-gray-800">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Legendary: 3%
              </span>
            </div>
          </motion.div>
        )}

        {/* ================= OPENING ANIMATION STATE ================= */}
        {packState === "opening" && (
          <motion.div
            key="opening-burst"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.1, opacity: 1 }}
            exit={{ scale: 1.4, opacity: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <motion.div
              animate={{ rotate: [0, -10, 10, -5, 5, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 0.6 }}
              className="text-7xl font-black text-indigo-400"
            >
              ✨ ꜩ ✨
            </motion.div>
            <h3 className="mt-4 text-2xl font-bold text-white tracking-wide animate-pulse">
              Ripping Open Pack...
            </h3>
          </motion.div>
        )}

        {/* ================= REVEALING & COMPLETE STATE ================= */}
        {(packState === "revealing" || packState === "complete") && (
          <motion.div
            key="cards-reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full flex flex-col items-center"
          >
            {/* Header Control Bar */}
            <div className="w-full mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gray-900/60 p-4 border border-gray-800 backdrop-blur-md">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>Booster Pack Pulls</span>
                  {packState === "complete" && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/50">
                      Pack Complete!
                    </span>
                  )}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {packState === "revealing"
                    ? "Click on each card to reveal your pull"
                    : `Revealed 5 cards • Total listed value: ${totalValue.toFixed(2)} XTZ`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {packState === "revealing" && (
                  <button
                    onClick={handleRevealAll}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shadow"
                  >
                    Reveal All
                  </button>
                )}

                <button
                  onClick={handleReset}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:from-blue-500 hover:to-indigo-500 transition-all shadow-md shadow-indigo-950/50"
                >
                  Open Another Pack
                </button>
              </div>
            </div>

            {/* Special Pull Alert Banner */}
            {packState === "complete" && (legendaryCount > 0 || epicCount > 0) && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full mb-6 rounded-2xl border border-amber-500/50 bg-gradient-to-r from-amber-950/80 via-purple-950/80 to-amber-950/80 p-4 text-center shadow-lg shadow-amber-500/10"
              >
                <span className="text-sm font-bold text-amber-200">
                  🎉 Outstanding Pull! You got{" "}
                  {legendaryCount > 0 && `${legendaryCount} Legendary `}
                  {legendaryCount > 0 && epicCount > 0 && "& "}
                  {epicCount > 0 && `${epicCount} Epic `}
                  NFTs in this booster pack!
                </span>
              </motion.div>
            )}

            {/* The 5 Cards Display Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 w-full">
              {cards.map((card, idx) => {
                const isFlipped = flippedIndices.has(idx);
                const isWish = wishlistIds.has(`${card.contract_address}-${card.token_id}`);

                return (
                  <div key={`${card.token_id}-${idx}`} className="w-full">
                    <NFTCard
                      card={card}
                      isFacedown={!isFlipped}
                      onFlip={() => handleFlipCard(idx)}
                      showCollectButton={isFlipped}
                      isWishlisted={isWish}
                      onToggleWishlist={onWishlistToggle}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
