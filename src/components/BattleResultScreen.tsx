"use client";

import React, { useEffect, useMemo, useState } from "react";
import { fetchTokenByKey, formatShortAddress, getCardImageSources, type NFTCard as NFTCardType } from "@/lib/objkt";
import { useFailoverImage } from "@/hooks/useFailoverImage";
import type { RoundOutcome, RoundRecord } from "@/lib/battle/rules";
import type { BattleResult } from "./BattlePanel";

export const DEFAULT_BEAT_DELAY_MS = 650;

interface BattleResultScreenProps {
  attackerCard: NFTCardType;
  result: BattleResult;
  wasOverkillTiebreak: boolean;
  onClose: () => void;
  beatDelayMs?: number;
}

interface CombatBeat {
  round: number;
  side: "attacker" | "defender";
  damage: number;
  hpA: number;
  hpB: number;
  result: RoundOutcome;
}

function combatBeats(history: RoundRecord[] | undefined, attackerMaxHp: number, defenderMaxHp: number): CombatBeat[] {
  const beats: CombatBeat[] = [];
  let hpA = attackerMaxHp;
  let hpB = defenderMaxHp;
  for (const round of history ?? []) {
    beats.push({
      round: round.round,
      side: "attacker",
      damage: round.damageA,
      hpA,
      hpB: round.hpB,
      result: round.resultA ?? "hit",
    });
    hpB = round.hpB;
    beats.push({
      round: round.round,
      side: "defender",
      damage: round.damageB,
      hpA: round.hpA,
      hpB,
      result: round.resultB ?? "hit",
    });
    hpA = round.hpA;
  }
  return beats;
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

export default function BattleResultScreen({
  attackerCard,
  result,
  wasOverkillTiebreak,
  onClose,
  beatDelayMs = DEFAULT_BEAT_DELAY_MS,
}: BattleResultScreenProps) {
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

  const beats = useMemo(
    () => combatBeats(result.combat?.history, attackerMaxHp, defenderMaxHp),
    [result.combat, attackerMaxHp, defenderMaxHp],
  );

  const [revealedBeats, setRevealedBeats] = useState(0);

  useEffect(() => {
    if (revealedBeats >= beats.length) return;
    const timer = setTimeout(() => setRevealedBeats((n) => n + 1), beatDelayMs);
    return () => clearTimeout(timer);
  }, [revealedBeats, beats.length, beatDelayMs]);

  const sequenceComplete = revealedBeats >= beats.length;
  const lastRevealed = beats[revealedBeats - 1];
  const attackerHp = lastRevealed ? lastRevealed.hpA : attackerMaxHp;
  const defenderHp = lastRevealed ? lastRevealed.hpB : defenderMaxHp;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-surface-0/98 px-4 py-6 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <div className="mb-4 text-center">
          {!sequenceComplete ? null : result.outcome === "draw" ? (
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
            <HealthBar label="You" current={attackerHp} max={attackerMaxHp} />
          </div>
          <div className="mt-10 shrink-0 text-xs font-bold text-text-tertiary">VS</div>
          <div className="flex flex-1 flex-col items-center gap-2">
            <CardFace card={defenderCard} side="defender" />
            <HealthBar
              label={result.defenderWallet ? formatShortAddress(result.defenderWallet) : "Opponent"}
              current={defenderHp}
              max={defenderMaxHp}
            />
          </div>
        </div>

        <div className="mt-6 flex-1 space-y-1.5 overflow-y-auto rounded-xl border border-border-default bg-surface-1/60 p-3">
          {beats.slice(0, revealedBeats).map((beat, index) => {
            const name = beat.side === "attacker" ? attackerCard.name : (defenderCard?.name ?? "Opponent");
            if (beat.result === "miss") {
              return (
                <p key={index} className="text-xs italic text-text-tertiary">
                  {beat.side === "attacker" ? `${name}'s hit missed!` : `${name}'s counter missed!`}
                </p>
              );
            }
            if (beat.result === "critical") {
              return (
                <p key={index} className="text-xs font-bold text-accent">
                  {beat.side === "attacker"
                    ? `${name} landed a CRITICAL HIT for ${Math.round(beat.damage)}!`
                    : `${name} countered with a CRITICAL HIT for ${Math.round(beat.damage)}!`}
                </p>
              );
            }
            return (
              <p key={index} className="text-xs text-text-secondary">
                {beat.side === "attacker"
                  ? `${name} hit for ${Math.round(beat.damage)}!`
                  : `${name} hit back for ${Math.round(beat.damage)}!`}
              </p>
            );
          })}
        </div>

        {sequenceComplete ? (
          <button onClick={onClose} className="button-primary mt-6 w-full px-4 py-2.5 text-xs font-semibold">
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}
