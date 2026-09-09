"use client";

import React, { useEffect, useMemo, useState } from "react";
import { fetchTokenByKey, formatShortAddress, getCardImageSources, type NFTCard as NFTCardType } from "@/lib/objkt";
import { useFailoverImage } from "@/hooks/useFailoverImage";
import type { BattleResult } from "./BattlePanel";

interface BattleResultScreenProps {
  attackerCard: NFTCardType;
  result: BattleResult;
  wasOverkillTiebreak: boolean;
  onClose: () => void;
}

function CardFace({ card, side }: { card: NFTCardType | null; side: "attacker" | "defender" }) {
  const sources = useMemo(
    () => (card ? getCardImageSources(card.thumbnail_uri, card.display_uri, card.artifact_uri) : []),
    [card],
  );
  const { imageUrl, loaded, failed, handleLoad, handleError } = useFailoverImage(sources);

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-xl border border-border-default bg-surface-2 sm:h-36 sm:w-36">
        {card && imageUrl && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={card.name}
            className={`h-full w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : (
          <span className="text-xs text-text-tertiary">{card ? card.name : side === "defender" ? "Loading…" : ""}</span>
        )}
      </div>
      <p className="max-w-[9rem] truncate text-xs font-semibold text-text-primary">
        {card ? card.name : side === "defender" ? "Loading…" : ""}
      </p>
    </div>
  );
}

function HealthBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div className="w-full max-w-[9rem]">
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-tertiary">
        {label} — {current} / {max} HP
      </p>
    </div>
  );
}

export default function BattleResultScreen({ attackerCard, result, wasOverkillTiebreak, onClose }: BattleResultScreenProps) {
  const [defenderCard, setDefenderCard] = useState<NFTCardType | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!result.defenderCardKey) return;
    const separatorIndex = result.defenderCardKey.lastIndexOf(":");
    if (separatorIndex === -1) return;
    const contractAddress = result.defenderCardKey.slice(0, separatorIndex);
    const tokenId = result.defenderCardKey.slice(separatorIndex + 1);

    fetchTokenByKey(contractAddress, tokenId).then((card) => {
      if (!cancelled) setDefenderCard(card);
    });
    return () => {
      cancelled = true;
    };
  }, [result.defenderCardKey]);

  const attackerMaxHp = result.attackerStats?.hp ?? result.combat?.finalHpA ?? 0;
  const defenderMaxHp = result.defenderStats?.hp ?? result.combat?.finalHpB ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-surface-0/98 px-4 py-6 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <div className="mb-4 text-center">
          {result.outcome === "draw" ? (
            <p className="text-sm font-semibold text-text-secondary">Draw — no XP, no recovery for either side.</p>
          ) : result.winner === "attacker" ? (
            <p className="text-sm font-bold text-accent">
              {wasOverkillTiebreak ? "Won by margin! " : "Victory! "}+{result.xpAwarded ?? 0} XP
            </p>
          ) : (
            <p className="text-sm font-bold text-danger">Defeated. Recovering for a while.</p>
          )}
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-1 flex-col items-center gap-2">
            <CardFace card={attackerCard} side="attacker" />
            <HealthBar label="You" current={result.combat?.finalHpA ?? 0} max={attackerMaxHp} />
          </div>
          <div className="mt-10 shrink-0 text-xs font-bold text-text-tertiary">VS</div>
          <div className="flex flex-1 flex-col items-center gap-2">
            <CardFace card={defenderCard} side="defender" />
            <HealthBar
              label={result.defenderWallet ? formatShortAddress(result.defenderWallet) : "Opponent"}
              current={result.combat?.finalHpB ?? 0}
              max={defenderMaxHp}
            />
          </div>
        </div>

        <div className="mt-6 flex-1 space-y-1.5 overflow-y-auto rounded-xl border border-border-default bg-surface-1/60 p-3">
          {(result.combat?.history ?? []).map((round) => (
            <p key={round.round} className="text-xs text-text-secondary">
              Round {round.round} — you dealt {Math.round(round.damageA)}, they dealt {Math.round(round.damageB)}
            </p>
          ))}
        </div>

        <button onClick={onClose} className="button-primary mt-6 w-full px-4 py-2.5 text-xs font-semibold">
          Close
        </button>
      </div>
    </div>
  );
}
