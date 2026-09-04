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
    <main className="min-h-screen bg-gray-950 text-white selection:bg-indigo-500 selection:text-white">
      {/* Background Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ================= HEADER NAVBAR ================= */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-4 border-b border-gray-800/80 pb-6">
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
                <h1 className="text-2xl font-black tracking-tight text-white">
                  TzDeck
                </h1>
                <span className="rounded-full bg-indigo-950 px-2 py-0.5 text-2xs font-bold text-indigo-300 border border-indigo-700/50">
                  OBJKT Gacha
                </span>
              </div>
              <p className="text-xs text-gray-400">Pull. Collect. Discover.</p>
            </div>
          </div>

          {/* Right Navigation & Wallet */}
          <div className="flex items-center gap-3">
            <SoundToggle />
            <ConnectButton />
          </div>
        </header>

        {/* ================= TABS NAVIGATION ================= */}
        <nav className="my-6 flex items-center justify-center gap-2 border-b border-gray-900 pb-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab("packs")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "packs"
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950"
                : "text-gray-400 hover:bg-gray-900 hover:text-white"
            }`}
          >
            <span>🎴</span>
            <span>Booster Packs</span>
          </button>

          <button
            onClick={() => setActiveTab("deck")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "deck"
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950"
                : "text-gray-400 hover:bg-gray-900 hover:text-white"
            }`}
          >
            <span>🃏</span>
            <span>My Deck</span>
            {address && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={() => setActiveTab("wishlist")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "wishlist"
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950"
                : "text-gray-400 hover:bg-gray-900 hover:text-white"
            }`}
          >
            <span>⭐</span>
            <span>Wishlist</span>
            {wishlist.length > 0 && (
              <span className="rounded-full bg-indigo-500/40 px-1.5 py-0.2 text-2xs font-bold tabular-nums text-indigo-200">
                {wishlist.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("about")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "about"
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950"
                : "text-gray-400 hover:bg-gray-900 hover:text-white"
            }`}
          >
            <span>ℹ️</span>
            <span>About</span>
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
                />
              ) : (
                <div className="rounded-3xl border border-gray-800/80 bg-gray-900/40 p-12 text-center max-w-lg mx-auto my-12 backdrop-blur-md">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10 border border-indigo-500/30 text-3xl mx-auto mb-4">
                    ꜩ
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    Connect Your Tezos Wallet
                  </h3>
                  <p className="mt-2 text-sm text-gray-400 mb-6">
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
            />
          )}

          {activeTab === "about" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-3xl mx-auto rounded-3xl border border-gray-800 bg-gray-900/50 p-8 sm:p-10 backdrop-blur-md space-y-6"
            >
              <div>
                <h2 className="text-2xl font-black text-white">
                  About TzDeck
                </h2>
                <p className="text-sm text-indigo-300 font-medium mt-1">
                  A Gamified NFT Discovery Layer for Tezos & OBJKT.com
                </p>
              </div>

              <div className="space-y-4 text-sm text-gray-300 leading-relaxed border-t border-gray-800 pt-6">
                <p>
                  <strong className="text-white">TzDeck</strong> is inspired by gacha card simulators like <a href="https://wikigacha.com" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300">wikigacha.com</a>. It transforms the vast Tezos art ecosystem on OBJKT into collectible virtual booster packs.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                    <span className="text-2xl">🎁</span>
                    <h4 className="font-bold text-white mt-2">1. Open Packs</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      Pull 5 random active marketplace listings currently for sale on OBJKT with simulated rarities and card animations.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                    <span className="text-2xl">✨</span>
                    <h4 className="font-bold text-white mt-2">2. Discover Art</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      Discover new artists and collections. Like a piece? Click through to collect it directly on OBJKT.com.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                    <span className="text-2xl">🃏</span>
                    <h4 className="font-bold text-white mt-2">3. Build Your Deck</h4>
                    <p className="text-xs text-gray-400 mt-1">
                      Connect your Tezos wallet to view all your owned OBJKTs dynamically as your playable, filterable digital card deck.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/30 p-4 mt-4">
                  <h4 className="font-bold text-indigo-200 text-xs uppercase tracking-wider">
                    How Purchases Work
                  </h4>
                  <p className="text-xs text-indigo-100/80 mt-1">
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
