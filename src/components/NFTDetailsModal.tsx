"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import type { NFTCard } from "@/lib/objkt";

interface NFTDetailsModalProps {
  card: NFTCard;
  imageUrl: string;
  isWishlisted: boolean;
  onClose: () => void;
  onToggleWishlist?: (card: NFTCard) => void;
}

function formatRarity(rarity: NFTCard["rarity"]): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

export default function NFTDetailsModal({
  card,
  imageUrl,
  isWishlisted,
  onClose,
  onToggleWishlist,
}: NFTDetailsModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
        className="relative my-auto grid max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-3xl border border-border-strong bg-surface-0 shadow-2xl shadow-indigo-950/70 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"
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

        <div className="flex min-h-[320px] items-center justify-center bg-black/50 p-4 sm:p-6">
          {/* Reuse the card's resolved gateway URL without adding an unbounded image allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={card.name}
            decoding="async"
            className="max-h-[75vh] w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>

        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="pr-10">
            <span className="inline-flex rounded-full border border-indigo-500/50 bg-indigo-950 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-200">
              {formatRarity(card.rarity || "common")}
            </span>
            <h2 id={titleId} className="mt-3 text-2xl font-black text-text-primary sm:text-3xl">
              {card.name}
            </h2>
            <p className="mt-2 text-sm font-medium text-indigo-300">
              {card.artist_alias || "Unknown Artist"}
            </p>
            {card.collection_name && (
              <p className="mt-1 text-xs text-text-muted">{card.collection_name}</p>
            )}
          </div>

          {card.description && (
            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {card.description}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            {card.editions !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Editions</dt>
                <dd className="mt-1 font-bold tabular-nums text-text-primary">{card.editions}</dd>
              </div>
            )}
            {card.price_xtz !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Listed Price</dt>
                <dd className="mt-1 font-bold tabular-nums text-indigo-200">ꜩ {card.price_xtz}</dd>
              </div>
            )}
            {card.quantity_owned !== undefined && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-3">
                <dt className="text-xs text-text-tertiary">Owned</dt>
                <dd className="mt-1 font-bold tabular-nums text-text-primary">{card.quantity_owned}</dd>
              </div>
            )}
          </dl>

          <dl className="space-y-3 border-t border-border-subtle pt-4 text-xs">
            <div>
              <dt className="text-text-tertiary">Contract</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary">
                {card.contract_address}
              </dd>
            </div>
            <div>
              <dt className="text-text-tertiary">Token ID</dt>
              <dd className="mt-1 break-all font-mono text-text-secondary">{card.token_id}</dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-col gap-2 sm:flex-row">
            {onToggleWishlist && (
              <button
                type="button"
                onClick={() => onToggleWishlist(card)}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
                  isWishlisted
                    ? "border-rose-500/50 bg-rose-950/60 text-rose-300 hover:bg-rose-900/70"
                    : "border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3"
                }`}
              >
                {isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
              </button>
            )}
            <a
              href={card.objkt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-sm font-bold text-text-primary transition hover:from-blue-500 hover:to-indigo-500"
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
