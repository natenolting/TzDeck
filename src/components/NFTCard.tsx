"use client";

import React, { useCallback, useState, useMemo } from "react";
import {
  distinctCollectionName, NFTCard as NFTCardType, getCardImageSources, isImageArtifact } from "@/lib/objkt";
import { useFailoverImage } from "@/hooks/useFailoverImage";
import { motion } from "framer-motion";
import Image from "next/image";
import NFTDetailsModal, { type BattleCardStats } from "./NFTDetailsModal";
import { RARITY_CONFIG } from "./rarityStyles";
import { ExternalLinkIcon, HeartIcon, ImageOffIcon, SwordsIcon } from "./icons";

interface NFTCardProps {
  card: NFTCardType;
  isFacedown?: boolean;
  onFlip?: () => void;
  /** Names the face-down card without revealing the pull, e.g. "Reveal card 2 of 5". */
  facedownLabel?: string;
  showCollectButton?: boolean;
  isWishlisted?: boolean;
  detailCards?: NFTCardType[];
  detailWishlistIds?: Set<string>;
  /** undefined outside a battle-aware context (My Deck); a card missing from the map means never battled. */
  battleStatsByCardKey?: Map<string, BattleCardStats>;
  onToggleWishlist?: (card: NFTCardType) => void;
  onBattle?: (card: NFTCardType) => void;
  /** Names the battle action, e.g. "Demo battle" where no real battle is on offer. */
  battleLabel?: string;
  className?: string;
}


export default function NFTCard({
  card,
  isFacedown = false,
  onFlip,
  facedownLabel = "Reveal card",
  showCollectButton = true,
  isWishlisted = false,
  detailCards,
  detailWishlistIds,
  battleStatsByCardKey,
  onToggleWishlist,
  onBattle,
  battleLabel = "Battle",
  className = "",
}: NFTCardProps) {
  // Ordered fallback sources
  const sources = useMemo(() => {
    return getCardImageSources(
      card.thumbnail_uri,
      card.display_uri,
      // Only when the artifact is itself an image -- a video or interactive
      // artifact can only fail here, and can be very large.
      isImageArtifact(card) ? card.artifact_uri : undefined,
    );
  }, [card]);

  const {
    imageUrl: currentImageUrl,
    loaded: imageLoaded,
    failed: imageError,
    handleLoad,
    handleError: handleImageError,
  } = useFailoverImage(sources);
  const [isHovered, setIsHovered] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const rarity = card.rarity || "common";
  const config = RARITY_CONFIG[rarity];
  const collection = distinctCollectionName(card);
  const revealDuration = rarity === "legendary"
    ? 0.65
    : rarity === "epic"
      ? 0.5
      : 0.3;

  const closeDetails = useCallback(() => setIsDetailsOpen(false), []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty("--foil-x", `${x}%`);
    e.currentTarget.style.setProperty("--foil-y", `${y}%`);
  };

  if (isFacedown) {
    return (
      <motion.button
        type="button"
        whileHover={{ scale: 1.04, y: -4 }}
        whileTap={{ scale: 0.98 }}
        onClick={onFlip}
        aria-label={facedownLabel}
        className={`relative aspect-[5/7] w-full cursor-pointer foil-card-back rounded-2xl border-2 p-4 shadow-xl shadow-black/50 transition-all select-none ${className}`}
      >
        <div className="relative flex h-full w-full flex-col items-center justify-between rounded-xl border border-border-subtle bg-surface-0/40 p-4 backdrop-blur-sm">
          <div aria-hidden="true" className="h-px w-full bg-border-subtle" />

          {/* Card Back Center Emblem */}
          <div className="absolute left-1/2 top-1/2 flex w-[46%] -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <div className="foil-glow-warm absolute aspect-square w-full rounded-full blur-xl" />
            <Image
              src="/tzdeck-shield-gradient-on-dark.svg"
              alt="TzDeck shield"
              width={88}
              height={113}
              className="relative h-auto w-full drop-shadow-[0_10px_18px_rgba(79,70,229,0.28)]"
            />
          </div>

          {/* Card Back Prompt */}
          <div className="text-center">
            <span className="inline-block rounded-full bg-accent-quiet px-3 py-1 text-2xs font-medium text-accent-hover border border-accent/30">
              Reveal
            </span>
          </div>
        </div>
      </motion.button>
    );
  }

  return (
    <>
      <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: revealDuration }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-gradient-to-b from-surface-1 to-surface-0 p-3.5 backdrop-blur-md transition-all duration-300 ${config.ring} ${config.glow} ${className}`}
    >
      {/* Holographic foil shine overlay on hover */}
      {isHovered && (
        <div
          className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay transition-opacity"
          style={{
            background: "radial-gradient(circle at var(--foil-x, 50%) var(--foil-y, 50%), rgba(255,255,255,0.8) 0%, transparent 60%)",
          }}
        />
      )}

      {/* Top Header Row */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wider ${config.badge}`}
        >
          {config.label}
        </span>

        <div className="flex items-center gap-1.5">
          {card.quantity_owned && card.quantity_owned > 1 && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-text-secondary border border-border-default">
              x{card.quantity_owned}
            </span>
          )}

          {onBattle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBattle(card);
              }}
              title={battleLabel}
              aria-label={`${battleLabel} with ${card.name}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary"
            >
              <SwordsIcon className="h-4 w-4" />
            </button>
          )}

          {onToggleWishlist && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWishlist(card);
              }}
              title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                isWishlisted
                  ? "bg-saved-quiet text-saved hover:bg-saved/25"
                  : "bg-surface-2 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
              }`}
            >
              <HeartIcon
                filled={isWishlisted}
                className="h-4 w-4"
              />
            </button>
          )}
        </div>
      </div>

      {/* Card Artwork Display */}
      <div className="relative z-10 aspect-square w-full overflow-hidden rounded-xl bg-surface-0 shadow-inner border border-border-subtle">
        {/* The preview and the token are different things: the card stays
            openable even when the artwork is still loading or never arrives.
            A video token's poster is often the heaviest asset on the card, and
            gating on it made exactly those tokens unreachable. */}
        <button
          type="button"
          aria-label={`View details for ${card.name}`}
          onClick={() => setIsDetailsOpen(true)}
          className="relative block h-full w-full cursor-zoom-in overflow-hidden text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-hover"
        >
          {!imageError && currentImageUrl ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-1/80">
                  <div
                    aria-hidden="true"
                    className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent"
                  />
                </div>
              )}
              {/* NFT hosts are unbounded; useFailoverImage drives gateway failover
                  on both an error event and a load timeout. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImageUrl}
                alt={card.name}
                onLoad={handleLoad}
                onError={handleImageError}
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${
                  imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
                }`}
              />
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-text-tertiary bg-surface-1">
              <ImageOffIcon className="mb-1 h-8 w-8 text-text-muted" />
              <span className="text-xs font-medium text-text-secondary line-clamp-1">{card.name}</span>
              <span className="text-2xs text-text-muted mt-0.5">Media unavailable</span>
            </div>
          )}

            <div className="art-chip pointer-events-none absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-2xs font-medium tabular-nums text-text-primary">
              {card.editions === undefined ? "Editions: Unknown" : card.editions === 1 ? "1 of 1" : `Editions: ${card.editions}`}
            </div>

            {card.price_xtz !== undefined && (
              <div className="art-chip art-chip-accent pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-bold tabular-nums text-accent-hover">
                <span>ꜩ</span>
                <span>{card.price_xtz}</span>
              </div>
            )}
        </button>

      </div>

      {/* Card Info Details */}
      <div className="relative z-10 pt-3">
        <h3 className="text-sm font-semibold text-text-primary tracking-tight line-clamp-1 group-hover:text-accent-hover transition-colors">
          {card.name}
        </h3>

        <div className="mt-1 space-y-0.5 text-xs">
          <p className="truncate font-medium text-text-secondary">
            {card.artist_alias || "Unknown Artist"}
          </p>
          {collection && (
            <p className="truncate text-2xs text-text-muted">
              {collection}
            </p>
          )}
        </div>
      </div>

      {/* Action Footer */}
      {showCollectButton && (
        <div className="relative z-10 mt-3 pt-2 border-t border-border-subtle">
          <a
            href={card.objkt_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="button-quiet w-full gap-1.5 px-3 py-2 text-xs font-semibold"
          >
            <span>Collect on OBJKT</span>
            <ExternalLinkIcon className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      </motion.div>

      {isDetailsOpen && (
        <NFTDetailsModal
          card={card}
          isWishlisted={isWishlisted}
          navigationCards={detailCards}
          wishlistIds={detailWishlistIds}
          battleStatsByCardKey={battleStatsByCardKey}
          onClose={closeDetails}
          onToggleWishlist={onToggleWishlist}
          onBattle={onBattle}
          battleLabel={battleLabel}
        />
      )}
    </>
  );
}
