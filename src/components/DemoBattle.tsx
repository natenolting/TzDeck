"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ConnectButton from "./ConnectButton";
import BattleResultScreen from "./BattleResultScreen";
import { useWallet } from "@/context/WalletContext";
import { trackFunnelEvent } from "@/lib/analytics";
import type { NFTCard as NFTCardType } from "@/lib/objkt";
import { buildDemoBattle, randomDemoSeed } from "@/lib/battle/demo";

interface DemoBattleProps {
  card: NFTCardType;
  /** Which entry point opened it: My Deck's connect screen, or a pulled pack card. */
  source: "deck" | "pack";
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
export default function DemoBattle({ card, source, initialSeed, onClose, onGoToDeck }: DemoBattleProps) {
  const { address } = useWallet();
  const [seed, setSeed] = useState(initialSeed);
  const battle = useMemo(() => buildDemoBattle(card, seed), [card, seed]);

  // One event per demo opened, not per Replay: the funnel step is "someone
  // watched a battle", and replays would inflate it. The ref keeps the effect
  // on an empty dependency array without lying to exhaustive-deps.
  const sourceRef = useRef(source);
  useEffect(() => {
    trackFunnelEvent({ name: "demo_battle_started", source: sourceRef.current });
  }, []);

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
      demo={{
        onReplay: () => {
          // One per Replay press: a visitor who rerolls is the signal that the
          // fight itself is fun, which a single start event can't show.
          trackFunnelEvent({ name: "demo_battle_replayed", source: sourceRef.current });
          setSeed(randomDemoSeed());
        },
        callToAction,
      }}
    />
  );
}
