"use client";

import ConnectButton from "@/components/ConnectButton";
import DeckGrid from "@/components/DeckGrid";
import { useWallet } from "@/context/WalletContext";

export default function Home() {
  const { address } = useWallet();

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">TzDeck</h1>
            <p className="text-gray-400 text-sm">
              Open OBJKT booster packs & build your deck
            </p>
          </div>
          <ConnectButton />
        </header>

        {address ? (
          <DeckGrid />
        ) : (
          <div className="text-center text-gray-400 py-20">
            <p className="mb-4">Connect your Tezos wallet to view your deck.</p>
          </div>
        )}
      </div>
    </main>
  );
}