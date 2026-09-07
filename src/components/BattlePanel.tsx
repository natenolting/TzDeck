"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useWallet, UnsupportedWalletTypeError } from "@/context/WalletContext";
import { getCardKey, type NFTCard as NFTCardType } from "@/lib/objkt";

interface StatusCard {
  cardKey: string;
  xp: number;
  level: number;
  power: number;
  hp: number;
  recoveryUntil: string | null;
  recoveryReason: "offensive" | "defensive" | null;
}

interface StatusResponse {
  optedIn: boolean;
  effectiveAttackCount: number;
  attackResetAt: string | null;
  effectiveDefenseCount: number;
  defenseResetAt: string | null;
  holdingsRefreshedAt: string | null;
  cards: StatusCard[];
}

interface BattleResult {
  outcome: "win" | "draw" | "no_match";
  winner?: "attacker" | "defender" | null;
  xpAwarded?: number;
  winnerNewXp?: string | number;
  loserRecoveryUntil?: string | null;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "awaiting_signature" }
  | { kind: "declined" }
  | { kind: "unsupported_wallet" }
  | { kind: "result"; result: BattleResult; wasOverkillTiebreak: boolean }
  | { kind: "no_match" }
  | { kind: "cap_reached" }
  | { kind: "error"; message: string };

const ATTACK_CAP_MAX = 20;
const DEFENSE_CAP_MAX = 20;

interface BattlePanelProps {
  card: NFTCardType;
  onClose: () => void;
}

export function recoveryCopy(reason: "offensive" | "defensive" | null): string {
  if (reason === "defensive") return "Recovering from a defensive loss — shorter cooldown.";
  if (reason === "offensive") return "Recovering from an offensive loss.";
  return "";
}

export default function BattlePanel({ card, onClose }: BattlePanelProps) {
  const { address, signChallenge } = useWallet();
  const cardKey = getCardKey(card);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [mode, setMode] = useState<"random" | "challenge">("random");
  const [targetWallet, setTargetWallet] = useState("");
  const [panelState, setPanelState] = useState<PanelState>({ kind: "idle" });

  const loadStatus = useCallback(
    (walletAddress: string) =>
      fetch(`/api/battle/status?address=${encodeURIComponent(walletAddress)}`, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("status_unavailable");
          return response.json() as Promise<StatusResponse>;
        })
        .then((data) => {
          setStatus(data);
          setStatusUnavailable(false);
        })
        .catch(() => {
          setStatusUnavailable(true);
        })
        .finally(() => {
          setStatusLoading(false);
        }),
    [],
  );

  useEffect(() => {
    if (!address) return;
    void loadStatus(address);
  }, [address, loadStatus]);

  const refreshStatus = useCallback(() => {
    if (!address) return Promise.resolve();
    setStatusLoading(true);
    return loadStatus(address);
  }, [address, loadStatus]);

  const ownCardStatus = status?.cards.find((c) => c.cardKey === cardKey);
  const isRecovering = Boolean(ownCardStatus?.recoveryUntil && new Date(ownCardStatus.recoveryUntil) > new Date());
  const atAttackCap = (status?.effectiveAttackCount ?? 0) >= ATTACK_CAP_MAX;
  const atDefenseCap = (status?.effectiveDefenseCount ?? 0) >= DEFENSE_CAP_MAX;

  const toggleOptIn = async () => {
    if (!status) return;
    const nextOptedIn = !status.optedIn;
    setPanelState({ kind: "awaiting_signature" });
    try {
      const signed = await signChallenge("opt-in", [nextOptedIn]);
      setPanelState({ kind: "idle" });
      const response = await fetch("/api/battle/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...signed, claimedAddress: signed.address, optedIn: nextOptedIn }),
      });
      if (!response.ok && response.status !== 202) {
        const body = await response.json().catch(() => ({}));
        setPanelState({ kind: "error", message: body.error || "Failed to update opt-in status." });
        return;
      }
      await refreshStatus();
    } catch (error) {
      if (error instanceof UnsupportedWalletTypeError) {
        setPanelState({ kind: "unsupported_wallet" });
        return;
      }
      setPanelState({ kind: "declined" });
    }
  };

  const startBattle = async () => {
    if (isRecovering || atAttackCap) return;
    setPanelState({ kind: "awaiting_signature" });
    try {
      const action = mode === "random" ? "random" : "challenge";
      const params = mode === "random" ? [cardKey] : [cardKey, targetWallet];
      const signed = await signChallenge(action, params);
      setPanelState({ kind: "idle" });

      const body =
        mode === "random"
          ? { ...signed, claimedAddress: signed.address, attackerCardKey: cardKey }
          : { ...signed, claimedAddress: signed.address, attackerCardKey: cardKey, defenderWallet: targetWallet };

      const response = await fetch(`/api/battle/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();

      if (!response.ok) {
        if (json.error === "attack_cap_reached" || response.status === 429) {
          setPanelState({ kind: "cap_reached" });
          return;
        }
        setPanelState({ kind: "error", message: json.error || "Battle request failed." });
        return;
      }

      if (json.outcome === "no_match") {
        setPanelState({ kind: "no_match" });
        return;
      }

      // An overkill-tiebreak win is one where both sides' realized HP hit
      // zero the same round -- the server doesn't currently flag this
      // explicitly in the response, so this reads as an ordinary win until
      // that's added; documented here rather than guessed at.
      setPanelState({ kind: "result", result: json, wasOverkillTiebreak: false });
      await refreshStatus();
    } catch (error) {
      if (error instanceof UnsupportedWalletTypeError) {
        setPanelState({ kind: "unsupported_wallet" });
        return;
      }
      setPanelState({ kind: "declined" });
    }
  };

  if (statusUnavailable) {
    return (
      <div className="rounded-2xl border border-border-default bg-surface-1/80 p-6 text-center">
        <p className="text-sm font-medium text-text-secondary">Battles are temporarily unavailable.</p>
        <p className="mt-1 text-xs text-text-tertiary">The rest of TzDeck (deck browsing, packs, wishlist) still works normally.</p>
        <button onClick={onClose} className="button-secondary mt-4 px-4 py-2 text-xs font-semibold">
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border-default bg-surface-1/90 p-5 backdrop-blur-md"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Battle — {card.name}</h3>
        <button onClick={onClose} aria-label="Close battle panel" className="button-secondary h-8 w-8 text-xs">
          ✕
        </button>
      </div>

      {statusLoading ? (
        <p className="mt-4 text-xs text-text-tertiary">Loading battle status…</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border-default bg-surface-2 px-3 py-2">
            <span className="text-xs text-text-secondary">Defend against other wallets</span>
            <button
              onClick={toggleOptIn}
              disabled={panelState.kind === "awaiting_signature"}
              className={`button-secondary px-3 py-1.5 text-xs font-semibold ${status?.optedIn ? "text-accent" : ""}`}
            >
              {status?.optedIn ? "Opted in" : "Opt in"}
            </button>
          </div>
          {status?.optedIn && atDefenseCap && (
            <p className="mt-1 text-xs text-text-tertiary">
              You&apos;ve reached today&apos;s defense limit — other wallets can&apos;t match against you until it resets.
            </p>
          )}

          {ownCardStatus && (
            <div className="mt-3 text-xs text-text-secondary">
              <p>
                Level {ownCardStatus.level} · Power {ownCardStatus.power} · HP {ownCardStatus.hp}
              </p>
              {isRecovering && (
                <p className="mt-1 text-danger">{recoveryCopy(ownCardStatus.recoveryReason)}</p>
              )}
            </div>
          )}

          {isRecovering ? (
            <p className="mt-4 rounded-xl border border-danger/40 bg-danger-quiet px-3 py-2 text-xs text-danger">
              This card is recovering and can&apos;t battle right now.
            </p>
          ) : atAttackCap ? (
            <p className="mt-4 rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs text-text-secondary">
              Daily battle limit reached, resets {status?.attackResetAt ? new Date(status.attackResetAt).toLocaleTimeString() : "soon"}.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("random")}
                  className={`button-secondary flex-1 px-3 py-2 text-xs font-semibold ${mode === "random" ? "text-accent" : ""}`}
                >
                  Random Battle
                </button>
                <button
                  onClick={() => setMode("challenge")}
                  className={`button-secondary flex-1 px-3 py-2 text-xs font-semibold ${mode === "challenge" ? "text-accent" : ""}`}
                >
                  Challenge Wallet
                </button>
              </div>

              {mode === "challenge" && (
                <input
                  type="text"
                  value={targetWallet}
                  onChange={(e) => setTargetWallet(e.target.value)}
                  placeholder="Target wallet address (tz1...)"
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent"
                />
              )}
              {mode === "challenge" && targetWallet === address && (
                <p className="text-xs text-danger">You can&apos;t challenge your own wallet.</p>
              )}

              <button
                onClick={startBattle}
                disabled={
                  panelState.kind === "awaiting_signature" ||
                  (mode === "challenge" && (!targetWallet || targetWallet === address))
                }
                className="button-primary w-full px-4 py-2.5 text-xs font-semibold"
              >
                {panelState.kind === "awaiting_signature" ? "Awaiting wallet signature…" : "Battle!"}
              </button>
            </div>
          )}

          {panelState.kind === "declined" && (
            <p className="mt-3 text-xs text-danger">Signature declined or cancelled — nothing was sent.</p>
          )}
          {panelState.kind === "unsupported_wallet" && (
            <p className="mt-3 text-xs text-danger">This wallet type is not supported for battles.</p>
          )}
          {panelState.kind === "no_match" && (
            <p className="mt-3 text-xs text-text-secondary">No eligible opponent available right now. No allowance was used.</p>
          )}
          {panelState.kind === "cap_reached" && (
            <p className="mt-3 text-xs text-text-secondary">Daily limit reached.</p>
          )}
          {panelState.kind === "error" && <p className="mt-3 text-xs text-danger">{panelState.message}</p>}
          {panelState.kind === "result" && (
            <div className="mt-3 rounded-xl border border-accent/40 bg-surface-2 px-3 py-2 text-xs">
              {panelState.result.outcome === "draw" ? (
                <p className="text-text-secondary">Draw — no XP, no recovery for either side.</p>
              ) : panelState.result.winner === "attacker" ? (
                <p className="font-semibold text-accent">
                  {panelState.wasOverkillTiebreak ? "Won by margin! " : "Victory! "}
                  +{panelState.result.xpAwarded ?? 0} XP
                </p>
              ) : (
                <p className="text-danger">Defeated. Recovering for a while.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
