"use client";

import React, { useState } from "react";
import ConnectButton from "@/components/ConnectButton";
import DeckGrid from "@/components/DeckGrid";
import PackOpening from "@/components/PackOpening";
import WishlistGrid from "@/components/WishlistGrid";
import SoundToggle from "@/components/SoundToggle";
import { useWallet } from "@/context/WalletContext";
import { getCardKey, NFTCard as NFTCardType } from "@/lib/objkt";
import { saveWishlist, useWishlist } from "@/hooks/useWishlist";
import { motion } from "framer-motion";
import Image from "next/image";
import {
  CardsIcon,
  DeckIcon,
  HeartIcon,
  InfoIcon,
  SparklesIcon,
} from "@/components/icons";

type ActiveTab = "packs" | "deck" | "wishlist" | "about";

export default function Home() {
  const { address } = useWallet();
  const [activeTab, setActiveTab] = useState<ActiveTab>("packs");
  const wishlist = useWishlist();

  const handleWishlistToggle = (card: NFTCardType) => {
    const key = getCardKey(card);
    const exists = wishlist.some((wishlistCard) => getCardKey(wishlistCard) === key);

    if (exists) {
      saveWishlist(wishlist.filter((wishlistCard) => getCardKey(wishlistCard) !== key));
    } else {
      saveWishlist([card, ...wishlist]);
    }
  };

  const handleClearWishlist = () => {
    saveWishlist([]);
  };

  const wishlistIds = new Set(wishlist.map(getCardKey));

  return (
    <main className="min-h-screen bg-surface-0 text-text-primary selection:bg-accent selection:text-text-primary">
      <div className="page-vignette pointer-events-none fixed inset-0" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ================= HEADER NAVBAR ================= */}
        <header className="flex flex-col items-start justify-between gap-4 border-b border-border-subtle pb-6 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            {/* Logo Emblem */}
            <Image
              src="/tzdeck-icon-gradient-on-dark.svg"
              alt=""
              width={44}
              height={44}
              priority
              className="h-11 w-11 rounded-xl shadow-lg shadow-indigo-500/20"
            />

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-text-primary">
                  TzDeck
                </h1>
                <span className="rounded-full bg-accent-quiet px-2 py-0.5 text-2xs font-bold text-accent-hover border border-accent/30">
                  OBJKT Gacha
                </span>
              </div>
              <p className="text-xs text-text-secondary">Pull. Collect. Discover.</p>
            </div>
          </div>

          {/* Right Navigation & Wallet */}
          <div className="flex items-center gap-3">
            <SoundToggle />
            <ConnectButton variant="quiet" />
          </div>
        </header>

        {/* ================= TABS NAVIGATION ================= */}
        <nav className="tab-scroller -mx-4 my-6 flex items-center justify-start gap-2 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:justify-center sm:px-6 lg:-mx-8 lg:px-8">
          <button
            onClick={() => setActiveTab("packs")}
            aria-label="Booster Packs"
            aria-pressed={activeTab === "packs"}
            className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "packs"
                ? "tab-button-active"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            <CardsIcon />
            <span className="tab-label">Booster Packs</span>
          </button>

          <button
            onClick={() => setActiveTab("deck")}
            aria-label="My Deck"
            aria-pressed={activeTab === "deck"}
            className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "deck"
                ? "tab-button-active"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            <DeckIcon />
            <span className="tab-label">My Deck</span>
            {address && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={() => setActiveTab("wishlist")}
            aria-label="Wishlist"
            aria-pressed={activeTab === "wishlist"}
            className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "wishlist"
                ? "tab-button-active"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            <HeartIcon filled />
            <span className="tab-label">Wishlist</span>
            {wishlist.length > 0 && (
              <span className="rounded-full bg-accent/40 px-1.5 py-0.2 text-2xs font-bold tabular-nums text-accent-hover">
                {wishlist.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("about")}
            aria-label="About"
            aria-pressed={activeTab === "about"}
            className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "about"
                ? "tab-button-active"
                : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            }`}
          >
            <InfoIcon />
            <span className="tab-label">About</span>
          </button>
        </nav>

        {/* ================= TAB CONTENTS ================= */}
        <div className="pb-16">
          {activeTab === "packs" && (
            <PackOpening
              onWishlistToggle={handleWishlistToggle}
              wishlistIds={wishlistIds}
            />
          )}

          {activeTab === "deck" && (
            <div>
              {address ? (
                <DeckGrid
                  key={address}
                  onWishlistToggle={handleWishlistToggle}
                  wishlistIds={wishlistIds}
                  onBrowsePacks={() => setActiveTab("packs")}
                />
              ) : (
                <div className="rounded-3xl border border-border-default bg-surface-1/80 p-12 text-center max-w-lg mx-auto my-12 backdrop-blur-md">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-quiet border border-accent/30 text-3xl mx-auto mb-4">
                    ꜩ
                  </div>
                  <h3 className="text-xl font-bold text-text-primary">
                    Connect Your Tezos Wallet
                  </h3>
                  <p className="mt-2 text-sm text-text-secondary mb-6">
                    Connect Temple, Kukai, or Beacon to view your owned OBJKT NFTs as your personal playable deck.
                  </p>
                  <div className="flex justify-center">
                    <ConnectButton />
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "wishlist" && (
            <WishlistGrid
              wishlist={wishlist}
              onWishlistToggle={handleWishlistToggle}
              onClearWishlist={handleClearWishlist}
              onBrowsePacks={() => setActiveTab("packs")}
            />
          )}

          {activeTab === "about" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto rounded-3xl border border-border-default bg-surface-1/80 p-8 sm:p-10 backdrop-blur-md space-y-6"
            >
              <div>
                <h2 className="text-2xl font-black text-text-primary">
                  About TzDeck
                </h2>
                <p className="text-sm text-accent-hover font-medium mt-1">
                  A Gamified NFT Discovery Layer for Tezos & OBJKT.com
                </p>
              </div>

              <div className="space-y-4 text-sm text-text-secondary leading-relaxed border-t border-border-subtle pt-6">
                <p>
                  <strong className="text-text-primary">TzDeck</strong> is inspired by gacha card simulators like <a href="https://wikigacha.com" target="_blank" rel="noopener noreferrer" className="text-accent-hover underline hover:text-text-primary">wikigacha.com</a>. It transforms the vast Tezos art ecosystem on OBJKT into collectible virtual booster packs.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="rounded-2xl border border-border-subtle bg-surface-0/60 p-4">
                    <CardsIcon className="h-6 w-6 text-accent-hover" />
                    <h4 className="font-bold text-text-primary mt-2">1. Open Packs</h4>
                    <p className="text-xs text-text-tertiary mt-1">
                      Pull 5 random active marketplace listings currently for sale on OBJKT with simulated rarities and card animations.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border-subtle bg-surface-0/60 p-4">
                    <SparklesIcon className="h-6 w-6 text-accent-hover" />
                    <h4 className="font-bold text-text-primary mt-2">2. Discover Art</h4>
                    <p className="text-xs text-text-tertiary mt-1">
                      Discover new artists and collections. Like a piece? Click through to collect it directly on OBJKT.com.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border-subtle bg-surface-0/60 p-4">
                    <DeckIcon className="h-6 w-6 text-accent-hover" />
                    <h4 className="font-bold text-text-primary mt-2">3. Build Your Deck</h4>
                    <p className="text-xs text-text-tertiary mt-1">
                      Connect your Tezos wallet to view all your owned OBJKTs dynamically as your playable, filterable digital card deck.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-accent/20 bg-accent-quiet p-4 mt-4">
                  <h4 className="font-bold text-accent-hover text-xs uppercase tracking-wider">
                    How Purchases Work
                  </h4>
                  <p className="text-xs text-text-secondary mt-1">
                    TzDeck is purely a discovery layer. All NFT acquisitions happen safely and directly on official Tezos marketplace contracts via OBJKT.com.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </main>
  );
}
