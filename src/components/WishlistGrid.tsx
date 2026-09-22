"use client";

import React, { useRef, useState } from "react";
import {
  fetchCardsByKeys,
  getCardKey,
  NFTCard as NFTCardType,
  parseTokenReference,
} from "@/lib/objkt";
import {
  mergeWishlists,
  parseWishlistExport,
  refreshWishlist,
  serializeWishlist,
  wishlistExportFilename,
} from "@/lib/wishlistTransfer";
import ConfirmDialog from "./ConfirmDialog";
import NFTCard from "./NFTCard";
import { HeartIcon } from "./icons";

interface WishlistGridProps {
  wishlist: NFTCardType[];
  onWishlistToggle: (card: NFTCardType) => void;
  onClearWishlist: () => void;
  onImport: (wishlist: NFTCardType[]) => void;
  onBrowsePacks: () => void;
}

type ImportStatus =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "done"; message: string }
  | { state: "error"; message: string };

function describeImport(added: number, skipped: number, stale: number): string {
  const parts = [
    added === 0
      ? "Every card in that file was already saved."
      : (added === 1 ? "Added 1 card." : `Added ${added} cards.`),
  ];
  if (skipped > 0) parts.push(`${skipped} couldn't be read.`);
  if (stale > 0) {
    parts.push(
      stale === 1
        ? "1 card couldn't be refreshed, so its price may be out of date."
        : `${stale} cards couldn't be refreshed, so their prices may be out of date.`,
    );
  }
  return parts.join(" ");
}

export default function WishlistGrid({
  wishlist,
  onWishlistToggle,
  onClearWishlist,
  onImport,
  onBrowsePacks,
}: WishlistGridProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>({ state: "idle" });
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [tokenReference, setTokenReference] = useState("");
  // Its own flag rather than the shared status. Adding a card and importing a
  // file are separate requests, and neither should grey out the other's button.
  const [addingCard, setAddingCard] = useState(false);

  const handleExport = () => {
    const blob = new Blob([serializeWishlist(wishlist)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = wishlistExportFilename();

    // The anchor has to be in the document for Firefox to honour the click at
    // all, and the blob URL has to outlive it: a download is asynchronous, so
    // revoking in this same tick can abort or truncate the file.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Selecting the same file twice in a row fires no change event unless the
    // input is reset, which is exactly what a retry after a failure looks like.
    event.target.value = "";
    if (!file) return;

    setStatus({ state: "reading" });

    let parsed;
    try {
      parsed = parseWishlistExport(await file.text());
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "That file couldn't be read.",
      });
      return;
    }

    const merged = mergeWishlists(wishlist, parsed.cards);
    const added = merged.length - wishlist.length;
    const { cards, stale } = await refreshWishlist(merged);

    onImport(cards);
    setStatus({ state: "done", message: describeImport(added, parsed.skipped, stale) });
  };

  const handleAddByReference = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const reference = parseTokenReference(tokenReference);
    if (!reference) {
      setStatus({
        state: "error",
        message: "That isn't an OBJKT token link, or a contract and token id.",
      });
      return;
    }

    const key = getCardKey(reference);
    if (wishlist.some((saved) => getCardKey(saved) === key)) {
      setStatus({ state: "done", message: "That card is already saved." });
      setTokenReference("");
      return;
    }

    setAddingCard(true);
    try {
      const card = (await fetchCardsByKeys([reference])).get(key);
      if (!card) {
        setStatus({
          state: "error",
          message: "OBJKT has no token with that contract and id.",
        });
        return;
      }

      onImport(mergeWishlists(wishlist, [card]));
      setStatus({ state: "done", message: `Added ${card.name}.` });
      setTokenReference("");
    } finally {
      setAddingCard(false);
    }
  };

  const addControls = (
    <form onSubmit={handleAddByReference} className="flex items-center gap-2">
      <input
        type="text"
        value={tokenReference}
        onChange={(event) => setTokenReference(event.target.value)}
        placeholder="Paste an OBJKT link"
        aria-label="Add a card by OBJKT link, or by contract and token id"
        className="w-48 rounded-xl border border-border-default bg-surface-2 px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent"
      />
      <button
        type="submit"
        disabled={addingCard || tokenReference.trim() === ""}
        className="button-secondary px-3.5 py-1.5 text-xs font-semibold disabled:opacity-60"
      >
        {addingCard ? "Adding…" : "Add"}
      </button>
    </form>
  );

  const importControls = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={status.state === "reading"}
        className="button-secondary px-3.5 py-1.5 text-xs font-semibold disabled:opacity-60"
      >
        {status.state === "reading" ? "Importing…" : "Import"}
      </button>
    </>
  );

  const statusMessage = status.state === "done" || status.state === "error"
    ? (
      <p
        role="status"
        className={`text-xs ${status.state === "error" ? "text-rarity-legendary" : "text-text-secondary"}`}
      >
        {status.message}
      </p>
    )
    : null;

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
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onBrowsePacks}
            className="button-primary px-4 py-2.5 text-xs font-semibold"
          >
            Browse Booster Packs
          </button>
          {addControls}
        </div>
        <div className="mt-2 flex justify-center">{importControls}</div>
        <p className="mt-3 text-xs text-text-secondary">
          Already have a backup? Import it to restore your saved cards.
        </p>
        {statusMessage && <div className="mt-2">{statusMessage}</div>}
      </div>
    );
  }

  const totalValue = wishlist.reduce((sum, c) => sum + (c.price_xtz || 0), 0);
  const wishlistIds = new Set(wishlist.map(getCardKey));

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border-default bg-surface-1/80 p-4 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold tabular-nums text-text-primary">Saved Wishlist ({wishlist.length})</h2>
          <p className="text-xs text-text-secondary mt-0.5 tabular-nums">
            Total listed value: {totalValue.toFixed(2)} XTZ
          </p>
          {statusMessage && <div className="mt-1">{statusMessage}</div>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {addControls}
          <button
            type="button"
            onClick={handleExport}
            className="button-secondary px-3.5 py-1.5 text-xs font-semibold"
          >
            Export
          </button>
          {importControls}
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="button-secondary px-3.5 py-1.5 text-xs font-semibold"
          >
            Clear Wishlist
          </button>
        </div>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title="Clear your wishlist?"
          message={`This removes ${wishlist.length === 1 ? "the 1 saved card" : `all ${wishlist.length} saved cards`} from this browser and can't be undone. Export a backup first if you might want them back.`}
          confirmLabel="Clear Wishlist"
          onConfirm={() => {
            setConfirmingClear(false);
            setStatus({ state: "idle" });
            onClearWishlist();
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {wishlist.map((card) => (
          <NFTCard
            key={getCardKey(card)}
            card={card}
            showCollectButton={true}
            isWishlisted={true}
            detailCards={wishlist}
            detailWishlistIds={wishlistIds}
            onToggleWishlist={onWishlistToggle}
          />
        ))}
      </div>
    </div>
  );
}
