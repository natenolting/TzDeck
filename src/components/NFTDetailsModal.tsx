"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getArtistProfileUrl, getCardImageSources, getCardKey, getCollectionUrl, type NFTCard } from "@/lib/objkt";
import { useFailoverImage } from "@/hooks/useFailoverImage";
import { baseStatsFromSeed, deriveBaseSeed, xpThresholdForLevel } from "@/lib/battle/rules";
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, SwordsIcon } from "./icons";
import { RARITY_CONFIG } from "./rarityStyles";

export interface BattleCardStats {
  xp: number;
  level: number;
  power: number;
  hp: number;
}

interface NFTDetailsModalProps {
  card: NFTCard;
  isWishlisted: boolean;
  navigationCards?: NFTCard[];
  wishlistIds?: Set<string>;
  /** undefined outside a battle-aware context (section omitted); a card missing from the map means never battled (estimated preview shown). Resolved per actively displayed card, not just the one that opened the modal. */
  battleStatsByCardKey?: Map<string, BattleCardStats>;
  onClose: () => void;
  onToggleWishlist?: (card: NFTCard) => void;
  onBattle?: (card: NFTCard) => void;
}

function BattleStatsSection({ card, battleStats }: { card: NFTCard; battleStats: BattleCardStats | null }) {
  if (battleStats) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
        <dt className="text-xs text-text-tertiary">Battle Stats</dt>
        <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm font-bold text-text-primary">
          <span>Level {battleStats.level}</span>
          <span className="text-xs font-medium text-text-tertiary">Power</span>
          <span>{battleStats.power}</span>
          <span className="text-xs font-medium text-text-tertiary">HP</span>
          <span>{battleStats.hp}</span>
        </dd>
        <dd className="mt-1 text-xs tabular-nums text-text-tertiary">
          {battleStats.xp} / {xpThresholdForLevel(battleStats.level + 1)} XP
        </dd>
      </div>
    );
  }

  if (card.editions === undefined) return null;
  const preview = baseStatsFromSeed(deriveBaseSeed(card.editions, card.description));
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
      <dt className="text-xs text-text-tertiary">Battle Stats</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm font-bold text-text-primary">
        <span>Estimated Level 1</span>
        <span className="text-xs font-medium text-text-tertiary">Power</span>
        <span>{preview.power}</span>
        <span className="text-xs font-medium text-text-tertiary">HP</span>
        <span>{preview.hp}</span>
      </dd>
      <dd className="mt-1 text-xs tabular-nums text-text-tertiary">0 / {xpThresholdForLevel(2)} XP</dd>
      <dd className="mt-1 text-2xs text-text-muted">Never battled -- exact stats lock in on your first battle.</dd>
    </div>
  );
}

function ModalArtwork({ card }: { card: NFTCard }) {
  const sources = getCardImageSources(
    card.display_uri,
    card.thumbnail_uri,
    card.artifact_uri,
  );
  const { imageUrl, loaded, failed, handleLoad, handleError } = useFailoverImage(sources);

  if (failed || !imageUrl) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-text-tertiary">
        <ImageOffIcon className="mb-2 h-10 w-10 text-text-muted" />
        <span className="text-sm font-medium text-text-secondary">{card.name}</span>
        <span className="mt-1 text-xs text-text-muted">Media unavailable</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div
            aria-label="Loading token artwork"
            role="status"
            className="h-12 w-12 animate-spin rounded-full border-4 border-accent border-t-transparent"
          />
        </div>
      )}
      {/* NFT hosts are unbounded; useFailoverImage drives gateway failover
          on both an error event and a load timeout. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={card.name}
        onLoad={handleLoad}
        onError={handleError}
        decoding="async"
        className={`max-h-[75vh] w-full rounded-2xl object-contain shadow-2xl transition-opacity ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

export default function NFTDetailsModal({
  card,
  isWishlisted,
  navigationCards,
  wishlistIds,
  battleStatsByCardKey,
  onClose,
  onToggleWishlist,
  onBattle,
}: NFTDetailsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const initialCardKey = getCardKey(card);
  const cards = navigationCards?.some(
    (navigationCard) => getCardKey(navigationCard) === initialCardKey,
  )
    ? navigationCards
    : [card];
  const [activeCardKey, setActiveCardKey] = useState(initialCardKey);
  const matchedIndex = cards.findIndex(
    (navigationCard) => getCardKey(navigationCard) === activeCardKey,
  );
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const activeCard = cards[activeIndex];
  const activeKey = getCardKey(activeCard);
  const activeIsWishlisted = activeKey === initialCardKey
    ? isWishlisted
    : wishlistIds?.has(activeKey) ?? false;
  const rarity = RARITY_CONFIG[activeCard.rarity || "common"];
  const previousCard = cards[activeIndex - 1];
  const nextCard = cards[activeIndex + 1];
  const artistProfileUrl = getArtistProfileUrl(activeCard.artist_address);
  const battleStats = battleStatsByCardKey ? battleStatsByCardKey.get(activeKey) ?? null : undefined;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialog?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      data-testid="nft-details-backdrop"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:p-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative my-auto grid max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-3xl border border-border-strong bg-surface-0 shadow-2xl shadow-black/60 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close token details"
          className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-black/60 text-xl text-text-primary backdrop-blur-md transition hover:bg-black/80"
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="relative flex min-h-[320px] items-center justify-center bg-black/50 p-4 sm:p-6">
          <ModalArtwork key={activeKey} card={activeCard} />

          {previousCard && (
            <button
              type="button"
              onClick={() => setActiveCardKey(getCardKey(previousCard))}
              aria-label="View previous card"
              title="Previous card"
              className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-black/65 text-text-primary shadow-lg backdrop-blur-md transition-colors hover:bg-black/85 sm:left-5"
            >
              <ChevronLeftIcon className="h-6 w-6" />
            </button>
          )}

          {nextCard && (
            <button
              type="button"
              onClick={() => setActiveCardKey(getCardKey(nextCard))}
              aria-label="View next card"
              title="Next card"
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-black/65 text-text-primary shadow-lg backdrop-blur-md transition-colors hover:bg-black/85 sm:right-5"
            >
              <ChevronRightIcon className="h-6 w-6" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="pr-10">
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${rarity.badge}`}
            >
              {rarity.label}
            </span>
            <h2 id={titleId} className="mt-3 text-2xl font-extrabold text-text-primary sm:text-3xl">
              <a
                href={activeCard.objkt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-accent-hover"
              >
                {activeCard.name}
              </a>
            </h2>
            <p className="mt-2 text-sm font-medium text-accent-hover">
              {artistProfileUrl ? (
                <a href={artistProfileUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {activeCard.artist_alias || "Unknown Artist"}
                </a>
              ) : (
                activeCard.artist_alias || "Unknown Artist"
              )}
            </p>
            {activeCard.collection_name && (
              <p className="mt-1 text-xs text-text-muted">
                <a
                  href={getCollectionUrl(activeCard.contract_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-text-secondary hover:underline"
                >
                  {activeCard.collection_name}
                </a>
              </p>
            )}
          </div>

          {activeCard.description && (
            <p className="scroll-fade max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {activeCard.description}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            {activeCard.editions !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Editions</dt>
                <dd className="mt-1 font-bold tabular-nums text-text-primary">{activeCard.editions}</dd>
              </div>
            )}
            {activeCard.price_xtz !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Listed Price</dt>
                <dd className="mt-1 font-bold tabular-nums text-accent-hover">ꜩ {activeCard.price_xtz}</dd>
              </div>
            )}
            {activeCard.quantity_owned !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Owned</dt>
                <dd className="mt-1 font-bold tabular-nums text-text-primary">{activeCard.quantity_owned}</dd>
              </div>
            )}
          </dl>

          {battleStats !== undefined && (
            <dl>
              <BattleStatsSection card={activeCard} battleStats={battleStats} />
            </dl>
          )}

          <dl className="space-y-3 border-t border-border-subtle pt-4 text-xs">
            <div>
              <dt className="text-text-tertiary">Contract</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary">
                {activeCard.contract_address}
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Token ID</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary">{activeCard.token_id}</dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-col gap-2">
            {onBattle && (
              <button
                type="button"
                onClick={() => {
                  onBattle(activeCard);
                  onClose();
                }}
                aria-label={`Battle with ${activeCard.name}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-3"
              >
                <SwordsIcon className="h-4 w-4" />
                Battle
              </button>
            )}
            {onToggleWishlist && (
              <button
                type="button"
                onClick={() => onToggleWishlist(activeCard)}
                className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
                  activeIsWishlisted
                    ? "border-saved/50 bg-saved-quiet text-saved hover:bg-saved/20"
                    : "border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3"
                }`}
              >
                {activeIsWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
              </button>
            )}
            <a
              href={activeCard.objkt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="button-primary w-full px-4 py-3 text-sm font-bold"
            >
              Collect on OBJKT
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
