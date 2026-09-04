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
    border: string;
    badgeBg: string;
    badgeText: string;
    glow: string;
    foilGradient: string;
  }
> = {
  common: {
    label: "Common",
    border: "border-slate-700 hover:border-slate-500",
    badgeBg: "bg-slate-800/80 border-slate-600",
    badgeText: "text-slate-300",
    glow: "hover:shadow-slate-500/20",
    foilGradient: "from-slate-500/10 via-transparent to-transparent",
  },
  uncommon: {
    label: "Uncommon",
    border: "border-emerald-700/80 hover:border-emerald-500",
    badgeBg: "bg-emerald-950/80 border-emerald-600",
    badgeText: "text-emerald-300",
    glow: "hover:shadow-emerald-500/25",
    foilGradient: "from-emerald-400/15 via-transparent to-teal-400/15",
  },
  rare: {
    label: "Rare",
    border: "border-cyan-600 hover:border-cyan-400",
    badgeBg: "bg-cyan-950/80 border-cyan-500",
    badgeText: "text-cyan-300",
    glow: "hover:shadow-cyan-500/30",
    foilGradient: "from-cyan-400/20 via-blue-500/10 to-indigo-500/20",
  },
  epic: {
    label: "Epic",
    border: "border-purple-600 hover:border-purple-400",
    badgeBg: "bg-purple-950/80 border-purple-500",
    badgeText: "text-purple-300",
    glow: "hover:shadow-purple-500/35",
    foilGradient: "from-purple-400/25 via-fuchsia-500/15 to-pink-500/25",
  },
  legendary: {
    label: "Legendary",
    border: "border-amber-500 hover:border-amber-300 shadow-amber-500/20 shadow-lg",
    badgeBg: "bg-amber-950/90 border-amber-400",
    badgeText: "text-amber-200 font-bold",
    glow: "hover:shadow-amber-500/50",
    foilGradient: "from-amber-400/30 via-yellow-300/20 to-orange-500/30",
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
        className={`relative aspect-[5/7] w-full cursor-pointer rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 p-4 shadow-xl shadow-indigo-950/50 transition-all hover:border-indigo-400 select-none ${className}`}
      >
        <div className="flex h-full w-full flex-col items-center justify-between rounded-xl border border-indigo-400/20 bg-gray-950/40 p-4 backdrop-blur-sm">
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
            <span className="inline-block rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-medium text-indigo-200 border border-indigo-400/30 animate-pulse">
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
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 bg-gradient-to-b from-gray-900/90 to-gray-950/95 p-3.5 shadow-lg backdrop-blur-md transition-all duration-300 ${config.border} ${config.glow} ${className}`}
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

      {/* Rarity tint overlay */}
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-tr ${config.foilGradient}`} />

      {/* Top Header Row */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-2.5">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${config.badgeBg} ${config.badgeText}`}
        >
          {config.label}
        </span>

        <div className="flex items-center gap-1.5">
          {card.quantity_owned && card.quantity_owned > 1 && (
            <span className="rounded-md bg-blue-900/60 px-1.5 py-0.5 text-[10px] font-medium text-blue-200 border border-blue-700/50">
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
                  : "bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill={isWishlisted ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={isWishlisted ? "0" : "1.8"}
                className="h-3.5 w-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-4.704-3.414C3.218 11.91 2 10.147 2 8.167 2 5.312 4.148 3.167 6.833 3.167c1.354 0 2.656.592 3.5 1.579a4.67 4.67 0 013.5-1.579c2.685 0 4.833 2.145 4.833 5c0 1.98-1.218 3.743-2.93 5.321a20.76 20.76 0 01-4.704 3.414l-.019.01-.005.003h-.002a.739.739 0 01-.69 0l-.002-.001z"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Card Artwork Display */}
      <div className="relative z-10 aspect-square w-full overflow-hidden rounded-xl bg-gray-950 shadow-inner border border-gray-800">
        {!imageError && currentImageUrl ? (
          <button
            type="button"
            aria-label={`View details for ${card.name}`}
            disabled={!imageLoaded}
            onClick={() => setIsDetailsOpen(true)}
            className="relative block h-full w-full cursor-zoom-in overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400 disabled:cursor-default"
          >
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 animate-pulse">
                <span className="text-xl opacity-30">🖼️</span>
              </div>
            )}
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
              <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-gray-950/80 px-2 py-0.5 text-[10px] font-medium text-gray-300 backdrop-blur-md border border-gray-800">
                {card.editions === 1 ? "1 of 1" : `Editions: ${card.editions}`}
              </div>
            )}

            {card.price_xtz !== undefined && (
              <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-indigo-950/90 px-2 py-0.5 text-[11px] font-bold text-indigo-200 backdrop-blur-md border border-indigo-700/60 shadow">
                <span>ꜩ</span>
                <span>{card.price_xtz}</span>
              </div>
            )}
          </button>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-gray-500 bg-gray-900">
            <span className="text-2xl mb-1">🖼️</span>
            <span className="text-xs font-medium text-gray-400 line-clamp-1">{card.name}</span>
            <span className="text-[10px] text-gray-600 mt-0.5">Media unavailable</span>
          </div>
        )}

      </div>

      {/* Card Info Details */}
      <div className="relative z-10 pt-3">
        <h3 className="text-sm font-semibold text-white tracking-tight line-clamp-1 group-hover:text-indigo-300 transition-colors">
          {card.name}
        </h3>

        <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
          <span className="truncate max-w-[140px] font-medium text-gray-300">
            {card.artist_alias || "Unknown Artist"}
          </span>
          {card.collection_name && (
            <span className="truncate max-w-[100px] text-[11px] text-gray-500">
              {card.collection_name}
            </span>
          )}
        </div>
      </div>

      {/* Action Footer */}
      {showCollectButton && (
        <div className="relative z-10 mt-3 pt-2 border-t border-gray-800/80">
          <a
            href={card.objkt_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-900/30 transition-all hover:from-blue-500 hover:to-indigo-500 active:scale-98"
          >
            <span>Collect on OBJKT</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2.2"
              stroke="currentColor"
              className="h-3.5 w-3.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
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
