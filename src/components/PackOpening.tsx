"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CardRarity,
  getCardKey,
  NFTCard as NFTCardType,
  RARITY_LEGEND,
} from "@/lib/objkt";
import NFTCard from "./NFTCard";
import { soundManager } from "@/lib/sound";
import { motion, AnimatePresence } from "framer-motion";
import { SparklesIcon } from "./icons";
import Image from "next/image";

interface PackOpeningProps {
  onWishlistToggle?: (card: NFTCardType) => void;
  wishlistIds?: Set<string>;
}

type PackState = "idle" | "opening" | "revealing" | "complete";

const RARITY_DOT_CLASS: Record<CardRarity, string> = {
  legendary: "bg-rarity-legendary",
  epic: "bg-rarity-epic",
  rare: "bg-rarity-rare",
  uncommon: "bg-rarity-uncommon",
  common: "bg-rarity-common",
};

export default function PackOpening({
  onWishlistToggle,
  wishlistIds = new Set(),
}: PackOpeningProps) {
  const [packState, setPackState] = useState<PackState>("idle");
  const [cards, setCards] = useState<NFTCardType[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const openingRef = useRef(false);
  const mountedRef = useRef(true);

  const clearTimers = useCallback(() => {
    for (const timerId of timersRef.current) {
      window.clearTimeout(timerId);
    }
    timersRef.current.clear();
  }, []);

  const registerTimer = useCallback((callback: () => void, delay: number) => {
    const timerId = window.setTimeout(() => {
      timersRef.current.delete(timerId);
      callback();
    }, delay);
    timersRef.current.add(timerId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  const openPack = async () => {
    if (openingRef.current || isLoading || packState !== "idle") return;

    openingRef.current = true;
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

      if (!mountedRef.current) return;

      setCards(data.cards);
      setFlippedIndices(new Set());

      // Small delay for the tear animation before showing cards
      registerTimer(() => {
        setPackState("revealing");
        setIsLoading(false);
        openingRef.current = false;
      }, 700);
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to generate pack. Please try again.",
      );
      setPackState("idle");
      setIsLoading(false);
      openingRef.current = false;
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
      registerTimer(() => {
        setPackState("complete");
        soundManager.playPackComplete();
      }, 600);
    }
  };

  const handleRevealAll = () => {
    clearTimers();
    const all = new Set(cards.map((_, i) => i));
    setFlippedIndices(all);
    setPackState("complete");
    soundManager.playPackComplete();
  };

  const handleReset = () => {
    clearTimers();
    openingRef.current = false;
    setPackState("idle");
    setCards([]);
    setFlippedIndices(new Set());
  };

  const totalValue = cards.reduce((sum, c) => sum + (c.price_xtz || 0), 0);
  const revealedCards = useMemo(
    () => cards.filter((_, index) => flippedIndices.has(index)),
    [cards, flippedIndices],
  );

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
            <motion.button
              type="button"
              whileHover={{ y: -8 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              onClick={openPack}
              disabled={isLoading}
              aria-label={isLoading ? "Opening booster pack" : "Open booster pack"}
              className="group font-display relative flex h-[456px] w-[296px] cursor-pointer flex-col items-center text-left drop-shadow-2xl transition-all hover:drop-shadow-[0_24px_28px_rgb(99_102_241/0.3)] select-none disabled:cursor-wait"
            >
              {/* The seals are wider than the pouch, as on a real pillow pack.
                  Their clipped outer edge changes the actual silhouette. */}
              <div className="foil-pack-seal foil-pack-seal-top" aria-hidden="true" />

              <div className="foil-pack foil-pack-body relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Metallic foil sheen + light-catching holo sweep */}
                <div className="foil-sheen pointer-events-none absolute inset-0 opacity-60 group-hover:opacity-90 transition-opacity" />
                <div className="foil-holo-sweep pointer-events-none absolute inset-0" />
                <div className="pointer-events-none foil-glow-cool absolute -top-24 -left-24 h-56 w-56 rounded-full blur-2xl transition-colors" />
                <div className="pointer-events-none foil-glow-warm absolute -bottom-24 -right-24 h-56 w-56 rounded-full blur-2xl transition-colors" />

                {/* Pack Header: wordmark + corner count badge, like a rating stamp */}
                <div className="relative z-10 flex items-start justify-between px-5 pt-4">
                  <span className="mt-1.5 text-xs font-black tracking-[0.2em] text-accent-hover">
                    TZDECK
                  </span>
                  <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-2 border-accent-hover/70 bg-surface-0/70 text-accent-hover shadow-md backdrop-blur-sm">
                    <span className="text-sm font-black leading-none">5</span>
                    <span className="text-[0.55rem] font-bold leading-none tracking-wide">CARDS</span>
                  </div>
                </div>

                {/* Pack Center Artwork */}
                <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-5">
                  <div className="relative flex h-28 w-28 items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 24, ease: "linear" }}
                      className="foil-starburst pointer-events-none absolute -inset-6"
                    />
                    <Image
                      src="/tzdeck-icon-gradient-on-light.svg"
                      alt=""
                      width={112}
                      height={112}
                      className="relative z-10 h-28 w-28 rounded-2xl shadow-xl ring-2 ring-accent-hover/70"
                    />
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <span className="foil-ribbon px-5 py-1.5 text-lg font-black tracking-wider text-text-primary">
                      OBJKT PACK
                    </span>
                    <p className="text-xs text-text-secondary font-medium text-center">
                      Random Active Marketplace Pulls
                    </p>
                  </div>
                </div>

                {/* Pack Bottom Footer: full-bleed color band, like a set's product stripe */}
                <div className="relative z-10 mt-auto bg-gradient-to-r from-accent to-accent-hover py-3 text-center shadow-[0_-2px_12px_rgb(0_0_0/0.35)]">
                  <span className="text-sm font-black uppercase tracking-widest text-text-primary">
                    {isLoading ? "Opening..." : "Click to Rip Open"}
                  </span>
                </div>
              </div>

              <div className="foil-pack-seal foil-pack-seal-bottom" aria-hidden="true" />
            </motion.button>

            {/* Error prompt */}
            {error && (
              <div className="mt-4 rounded-xl bg-danger-quiet border border-danger/50 px-4 py-2 text-sm text-danger max-w-md">
                {error}
              </div>
            )}

            <div className="mt-8 max-w-3xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                How rarity is graded
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-text-secondary">
                {RARITY_LEGEND.map(({ tier, label, rule }) => (
                  <span
                    key={tier}
                    className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-1/80 px-3 py-1.5"
                  >
                    <span className={`h-2 w-2 rounded-full ${RARITY_DOT_CLASS[tier]}`} />
                    <span className="font-semibold text-text-primary">{label}</span>
                    <span>{rule}</span>
                  </span>
                ))}
              </div>
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
              className="flex items-center gap-4 text-7xl font-black text-accent-hover"
            >
              <SparklesIcon className="h-10 w-10" />
              <span>ꜩ</span>
              <SparklesIcon className="h-10 w-10" />
            </motion.div>
            <h3 className="mt-4 text-2xl font-bold text-text-primary tracking-wide animate-pulse">
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
            <div className="w-full mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface-1/80 p-4 border border-border-default backdrop-blur-md">
              <div>
                <h2 className="text-xl font-bold text-text-primary flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Booster Pack Pulls</span>
                  {packState === "complete" && (
                    <span className="whitespace-nowrap text-xs px-2.5 py-0.5 rounded-full bg-surface-2 text-text-secondary border border-border-default">
                      Pack Complete!
                    </span>
                  )}
                </h2>
                <p className="text-xs text-text-secondary mt-0.5 tabular-nums">
                  {packState === "revealing"
                    ? "Click on each card to reveal your pull"
                    : `Revealed 5 cards • Total listed value: ${totalValue.toFixed(2)} XTZ`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {packState === "revealing" && (
                  <button
                    onClick={handleRevealAll}
                    className="button-secondary px-4 py-2 text-xs font-semibold"
                  >
                    Reveal All
                  </button>
                )}

                <button
                  onClick={handleReset}
                  className="button-primary px-4 py-2 text-xs font-semibold"
                >
                  Open Another Pack
                </button>
              </div>
            </div>

            {/* The 5 Cards Display Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 w-full">
              {cards.map((card, idx) => {
                const isFlipped = flippedIndices.has(idx);
                const cardKey = getCardKey(card);
                const isWish = wishlistIds.has(cardKey);

                return (
                  <div key={cardKey} className="w-full">
                    <NFTCard
                      card={card}
                      isFacedown={!isFlipped}
                      facedownLabel={`Reveal card ${idx + 1} of ${cards.length}`}
                      onFlip={() => handleFlipCard(idx)}
                      showCollectButton={isFlipped}
                      isWishlisted={isWish}
                      detailCards={revealedCards}
                      detailWishlistIds={wishlistIds}
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
