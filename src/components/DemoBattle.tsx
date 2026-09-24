"use client";

import React, { useMemo, useState } from "react";
import ConnectButton from "./ConnectButton";
import BattleResultScreen from "./BattleResultScreen";
import { useWallet } from "@/context/WalletContext";
import type { NFTCard as NFTCardType } from "@/lib/objkt";
import { buildDemoBattle, randomDemoSeed } from "@/lib/battle/demo";

interface DemoBattleProps {
  card: NFTCardType;
  /** The first fight's seed; every Replay after it rolls a fresh one. */
  initialSeed: number;
  onClose: () => void;
  /** Where a connected visitor goes to battle for real. Omitted when they're already there. */
  onGoToDeck?: () => void;
}

/**
 * The real battle screen, fed a fight resolved in the browser. No wallet,
 * signature or database is involved, so it works for anyone.
 */
export default function DemoBattle({ card, initialSeed, onClose, onGoToDeck }: DemoBattleProps) {
  const { address } = useWallet();
  const [seed, setSeed] = useState(initialSeed);
  const battle = useMemo(() => buildDemoBattle(card, seed), [card, seed]);

  const callToAction = address ? (
    onGoToDeck ? (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border-default bg-surface-1/80 p-4 text-center">
        <p className="text-xs text-text-secondary">Battle for real with any card you own.</p>
        <button
          type="button"
          onClick={() => {
            onClose();
            onGoToDeck();
          }}
          className="button-quiet px-4 py-2 text-xs font-bold"
        >
          Go to My Deck
        </button>
      </div>
    ) : null
  ) : (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border-default bg-surface-1/80 p-4 text-center">
      <p className="text-xs text-text-secondary">
        Connect a wallet to battle with the OBJKTs you own and earn XP. Battling never costs Tezos.
      </p>
      <ConnectButton />
    </div>
  );

  return (
    <BattleResultScreen
      // A new seed is a new fight: remount so the round-by-round reveal starts over.
      key={seed}
      attackerCard={card}
      result={battle.result}
      wasOverkillTiebreak={battle.wasOverkillTiebreak}
      onClose={onClose}
      demo={{ onReplay: () => setSeed(randomDemoSeed()), callToAction }}
    />
  );
}
