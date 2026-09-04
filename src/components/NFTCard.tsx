"use client";

import React, { useCallback, useState, useMemo } from "react";
import {
  NFTCard as NFTCardType,
  CardRarity,
  convertIpfsUrl,
  extractIpfsHash,
  getCardImageSources,
  IPFS_GATEWAYS,
} from "@/lib/objkt";
import { motion } from "framer-motion";
import Image from "next/image";
import NFTDetailsModal from "./NFTDetailsModal";
import { ExternalLinkIcon, HeartIcon, ImageOffIcon } from "./icons";

interface NFTCardProps {
  card: NFTCardType;
  isFacedown?: boolean;
  onFlip?: () => void;
  showCollectButton?: boolean;
  isWishlisted?: boolean;
  onToggleWishlist?: (card: NFTCardType) => void;
  className?: string;
}

const RARITY_CONFIG: Record<
  CardRarity,
  {
    label: string;
    ring: string;
    badge: string;
    glow: string;
  }
> = {
  common: {
    label: "Common",
    ring: "ring-1 ring-rarity-common/60 hover:ring-rarity-common",
    badge: "border-rarity-common/40 bg-rarity-common/15 text-rarity-common",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-common)] hover:shadow-[0_0_30px_-7px_var(--rarity-common)]",
  },
  uncommon: {
    label: "Uncommon",
    ring: "ring-1 ring-rarity-uncommon/60 hover:ring-rarity-uncommon",
    badge: "border-rarity-uncommon/40 bg-rarity-uncommon/15 text-rarity-uncommon",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-uncommon)] hover:shadow-[0_0_30px_-7px_var(--rarity-uncommon)]",
  },
  rare: {
    label: "Rare",
    ring: "ring-1 ring-rarity-rare/60 hover:ring-rarity-rare",
    badge: "border-rarity-rare/40 bg-rarity-rare/15 text-rarity-rare",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-rare)] hover:shadow-[0_0_30px_-7px_var(--rarity-rare)]",
  },
  epic: {
    label: "Epic",
    ring: "ring-1 ring-rarity-epic/60 hover:ring-rarity-epic",
    badge: "border-rarity-epic/40 bg-rarity-epic/15 text-rarity-epic",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-epic)] hover:shadow-[0_0_30px_-7px_var(--rarity-epic)]",
  },
  legendary: {
    label: "Legendary",
    ring: "ring-1 ring-rarity-legendary/60 hover:ring-rarity-legendary",
    badge: "border-rarity-legendary/40 bg-rarity-legendary/15 font-bold text-rarity-legendary",
    glow: "shadow-[0_0_28px_-8px_var(--rarity-legendary)] hover:shadow-[0_0_34px_-5px_var(--rarity-legendary)]",
  },
};

export default function NFTCard({
  card,
  isFacedown = false,
  onFlip,
  showCollectButton = true,
  isWishlisted = false,
  onToggleWishlist,
  className = "",
}: NFTCardProps) {
  // Ordered fallback sources
  const sources = useMemo(() => {
    return getCardImageSources(
      card.display_uri,
      card.thumbnail_uri,
      card.artifact_uri,
    );
  }, [card.display_uri, card.thumbnail_uri, card.artifact_uri]);

  const [sourceIdx, setSourceIdx] = useState(0);
  const [gatewayIdx, setGatewayIdx] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const rarity = card.rarity || "common";
  const config = RARITY_CONFIG[rarity];
  const revealDuration = rarity === "legendary"
    ? 0.65
    : rarity === "epic"
      ? 0.5
      : 0.3;

  const currentRawUri = sources[sourceIdx] || "";
  const currentImageUrl = convertIpfsUrl(currentRawUri, gatewayIdx);
  const closeDetails = useCallback(() => setIsDetailsOpen(false), []);

  const handleImageError = () => {
    setImageLoaded(false);

    if (extractIpfsHash(currentRawUri) && gatewayIdx < IPFS_GATEWAYS.length - 1) {
      setGatewayIdx((prev) => prev + 1);
    } else if (sourceIdx < sources.length - 1) {
      setSourceIdx((prev) => prev + 1);
      setGatewayIdx(0);
    } else {
      setImageError(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty("--foil-x", `${x}%`);
    e.currentTarget.style.setProperty("--foil-y", `${y}%`);
  };

  if (isFacedown) {
    return (
      <motion.div
        whileHover={{ scale: 1.04, y: -4 }}
        whileTap={{ scale: 0.98 }}
        onClick={onFlip}
        className={`relative aspect-[5/7] w-full cursor-pointer rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-950 via-surface-1 to-purple-950 p-4 shadow-xl shadow-indigo-950/50 transition-all hover:border-indigo-400 select-none ${className}`}
      >
        <div className="flex h-full w-full flex-col items-center justify-between rounded-xl border border-indigo-400/20 bg-surface-0/40 p-4 backdrop-blur-sm">
          {/* Card Back Top Logo */}
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-indigo-300">
            <span className="text-sm">ꜩ</span> TZDECK
          </div>

          {/* Card Back Center Emblem */}
          <div className="relative flex h-28 w-24 items-center justify-center">
            <div className="absolute h-20 w-20 rounded-full bg-purple-500/20 blur-xl" />
            <Image
              src="/tzdeck-shield-gradient-on-dark.svg"
              alt="TzDeck shield"
              width={88}
              height={113}
              className="relative h-24 w-auto drop-shadow-[0_10px_18px_rgba(79,70,229,0.28)]"
            />
          </div>

          {/* Card Back Prompt */}
          <div className="text-center">
            <span className="inline-block rounded-full bg-indigo-500/20 px-3 py-1 text-2xs font-medium text-indigo-200 border border-indigo-400/30 animate-pulse">
              Click to Reveal
            </span>
          </div>
        </div>
      </motion.div>
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
            <span className="rounded-md bg-blue-900/60 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-blue-200 border border-blue-700/50">
              x{card.quantity_owned}
            </span>
          )}

          {onToggleWishlist && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWishlist(card);
              }}
              title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
              className={`rounded-full p-1.5 transition-colors ${
                isWishlisted
                  ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                  : "bg-surface-2 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
              }`}
            >
              <HeartIcon
                filled={isWishlisted}
                className="h-3.5 w-3.5"
              />
            </button>
          )}
        </div>
      </div>

      {/* Card Artwork Display */}
      <div className="relative z-10 aspect-square w-full overflow-hidden rounded-xl bg-surface-0 shadow-inner border border-border-subtle">
        {!imageError && currentImageUrl ? (
          <button
            type="button"
            aria-label={`View details for ${card.name}`}
            disabled={!imageLoaded}
            onClick={() => setIsDetailsOpen(true)}
            className="relative block h-full w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-hover disabled:cursor-default"
          >
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-1/80 animate-pulse">
                <ImageOffIcon className="h-5 w-5 text-text-muted" />
              </div>
            )}
            {/* NFT hosts are unbounded, and native error events drive gateway failover. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImageUrl}
              alt={card.name}
              onLoad={() => setImageLoaded(true)}
              onError={handleImageError}
              loading="lazy"
              decoding="async"
              className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${
                imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-95"
              }`}
            />

            {card.editions !== undefined && (
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-surface-0/80 px-2 py-0.5 text-2xs font-medium tabular-nums text-text-secondary backdrop-blur-md border border-border-subtle">
                {card.editions === 1 ? "1 of 1" : `Editions: ${card.editions}`}
              </div>
            )}

            {card.price_xtz !== undefined && (
              <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-indigo-950/90 px-2 py-0.5 text-2xs font-bold tabular-nums text-indigo-200 backdrop-blur-md border border-indigo-700/60 shadow">
                <span>ꜩ</span>
                <span>{card.price_xtz}</span>
              </div>
            )}
          </button>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-text-tertiary bg-surface-1">
            <ImageOffIcon className="mb-1 h-8 w-8 text-text-muted" />
            <span className="text-xs font-medium text-text-secondary line-clamp-1">{card.name}</span>
            <span className="text-2xs text-text-muted mt-0.5">Media unavailable</span>
          </div>
        )}

      </div>

      {/* Card Info Details */}
      <div className="relative z-10 pt-3">
        <h3 className="text-sm font-semibold text-text-primary tracking-tight line-clamp-1 group-hover:text-indigo-300 transition-colors">
          {card.name}
        </h3>

        <div className="mt-1 space-y-0.5 text-xs">
          <p className="truncate font-medium text-text-secondary">
            {card.artist_alias || "Unknown Artist"}
          </p>
          {card.collection_name && (
            <p className="truncate text-2xs text-text-muted">
              {card.collection_name}
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
          imageUrl={currentImageUrl}
          isWishlisted={isWishlisted}
          onClose={closeDetails}
          onToggleWishlist={onToggleWishlist}
        />
      )}
    </>
  );
}
