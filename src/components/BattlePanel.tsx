"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useWallet, UnsupportedWalletTypeError } from "@/context/WalletContext";
import { getCardKey, type NFTCard as NFTCardType } from "@/lib/objkt";
import { baseStatsFromSeed, deriveBaseSeed, type RoundRecord } from "@/lib/battle/rules";
import BattleResultScreen from "./BattleResultScreen";
import { SwordsIcon } from "./icons";

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

export interface BattleResult {
  outcome: "win" | "draw" | "no_match";
  winner?: "attacker" | "defender" | null;
  xpAwarded?: number;
  winnerNewXp?: string | number;
  loserRecoveryUntil?: string | null;
  defenderWallet?: string;
  defenderCardKey?: string;
  attackerStats?: { power: number; hp: number };
  defenderStats?: { power: number; hp: number };
  combat?: {
    rounds: number;
    finalHpA: number;
    finalHpB: number;
    history: RoundRecord[];
  };
}

type PanelState =
  | { kind: "idle" }
  | { kind: "awaiting_signature" }
  | { kind: "syncing" }
  | { kind: "declined" }
  | { kind: "unsupported_wallet" }
  | { kind: "result"; result: BattleResult; wasOverkillTiebreak: boolean }
  | { kind: "no_match" }
  | { kind: "cap_reached" }
  | { kind: "error"; message: string };

const ATTACK_CAP_MAX = 20;
const DEFENSE_CAP_MAX = 20;

// Large wallets need more than MAX_PAGES_PER_INVOCATION pages of holdings
// synced (opt-in/route.ts), so the server returns 202 and expects the same
// signed request resubmitted to resume from its stored cursor. Bounded like
// MAX_NOT_HELD_REROLLS in random/route.ts so a persistently-202 server can't
// hang the UI forever.
const OPT_IN_SYNC_MAX_ATTEMPTS = 50;
const OPT_IN_SYNC_POLL_DELAY_MS = 300;

// opt-in/route.ts allows 20 requests/minute per wallet, independent of the
// signed attempt itself -- a large enough wallet's continuation loop can hit
// that budget before finishing. The server already marks the attempt
// retryable on 429 (its nonce/progress are never abandoned), so this waits
// out the window and resubmits the SAME signed body rather than surfacing a
// dead end that would force a fresh signature and restart staging from
// scratch. A separate bound from the 202 loop above so a large wallet's
// legitimate continuation isn't starved by an unrelated rate-limit episode.
const OPT_IN_RATE_LIMIT_MAX_ATTEMPTS = 15;
const OPT_IN_RATE_LIMIT_DELAY_MS = 5000;

interface BattlePanelProps {
  card: NFTCardType;
  onClose: () => void;
}

export function recoveryCopy(reason: "offensive" | "defensive" | null): string {
  if (reason === "defensive") return "Recovering from a defensive loss — shorter cooldown.";
  if (reason === "offensive") return "Recovering from an offensive loss.";
  return "";
}

/**
 * A never-battled card has no wallet_card_progress row, so there's nothing
 * to fetch -- this estimates its Level 1 Power/HP from data already loaded
 * in the deck view, using the same seed derivation the server uses. Null
 * when editions isn't loaded, rather than guessing at a fabricated number.
 * The real seed is captured fresh from upstream at battle-commit time, so
 * this can drift slightly if the edition count changes before then.
 */
export function previewStatsForCard(
  card: Pick<NFTCardType, "editions" | "description">,
): { power: number; hp: number } | null {
  if (typeof card.editions !== "number") return null;
  const seed = deriveBaseSeed(card.editions, card.description);
  const { power, hp } = baseStatsFromSeed(seed);
  return { power, hp };
}

export interface ResubmitResult {
  response: Response;
  timedOut: boolean;
}

/**
 * Resubmits `post()` -- the identical signed body, never re-signed -- while
 * the response keeps coming back 202 (bounded continuation still in
 * progress) or 429 (the wallet's own request budget, independent of the
 * signed attempt, which the server has already marked retryable rather than
 * abandoned). 202 waits `pollDelayMs` between tries, bounded to
 * `maxAttempts`; 429 waits the longer `rateLimitDelayMs` between tries,
 * bounded separately to `maxRateLimitAttempts` so a large wallet's
 * legitimate continuation isn't starved by an unrelated rate-limit episode,
 * or vice versa. Either persistently-202 or persistently-429 eventually
 * gives up rather than hanging the caller forever. `wait` is injectable so
 * tests don't need real timers.
 */
export async function resubmitWhilePending(
  post: () => Promise<Response>,
  maxAttempts: number,
  pollDelayMs: number,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxRateLimitAttempts: number = OPT_IN_RATE_LIMIT_MAX_ATTEMPTS,
  rateLimitDelayMs: number = OPT_IN_RATE_LIMIT_DELAY_MS,
): Promise<ResubmitResult> {
  let response = await post();
  let attempts = 0;
  let rateLimitAttempts = 0;
  while (response.status === 202 || response.status === 429) {
    if (response.status === 429) {
      rateLimitAttempts += 1;
      if (rateLimitAttempts > maxRateLimitAttempts) {
        return { response, timedOut: true };
      }
      await wait(rateLimitDelayMs);
    } else {
      attempts += 1;
      if (attempts > maxAttempts) {
        return { response, timedOut: true };
      }
      await wait(pollDelayMs);
    }
    response = await post();
  }
  return { response, timedOut: false };
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
  const previewStats = ownCardStatus ? null : previewStatsForCard(card);
  const isRecovering = Boolean(ownCardStatus?.recoveryUntil && new Date(ownCardStatus.recoveryUntil) > new Date());
  const atAttackCap = (status?.effectiveAttackCount ?? 0) >= ATTACK_CAP_MAX;
  const atDefenseCap = (status?.effectiveDefenseCount ?? 0) >= DEFENSE_CAP_MAX;

  const toggleOptIn = async () => {
    if (!status) return;
    const nextOptedIn = !status.optedIn;
    setPanelState({ kind: "awaiting_signature" });
    try {
      const signed = await signChallenge("opt-in", [nextOptedIn]);
      // The signed envelope carries a nonce the server uses to resume this
      // exact attempt -- re-signing would mint a new nonce and restart a
      // large wallet's holdings sync from scratch, so the same signed body
      // is resubmitted on every 202 (bounded continuation) or 429 (the
      // wallet's own request budget -- the server marks the attempt
      // retryable, never abandons it) rather than re-prompting the wallet.
      const requestBody = JSON.stringify({ ...signed, claimedAddress: signed.address, optedIn: nextOptedIn });
      const postOptIn = () =>
        fetch("/api/battle/opt-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });

      setPanelState({ kind: "syncing" });
      const { response, timedOut } = await resubmitWhilePending(postOptIn, OPT_IN_SYNC_MAX_ATTEMPTS, OPT_IN_SYNC_POLL_DELAY_MS);
      if (timedOut) {
        // A clear restart path: this signed attempt's own bounded budget
        // (continuation or rate-limit backoff) ran out, well short of the
        // server's own retry window -- clicking again mints a fresh
        // signature and attempt rather than leaving the user stuck.
        setPanelState({ kind: "error", message: "Opt-in sync is taking too long. Please try again." });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setPanelState({ kind: "error", message: body.error || "Failed to update opt-in status." });
        return;
      }
      setPanelState({ kind: "idle" });
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

  if (panelState.kind === "result") {
    return (
      <BattleResultScreen
        attackerCard={card}
        result={panelState.result}
        wasOverkillTiebreak={panelState.wasOverkillTiebreak}
        onClose={() => setPanelState({ kind: "idle" })}
      />
    );
  }

  return (
    <div
      className="rounded-2xl border border-border-default bg-surface-1/90 p-5 backdrop-blur-md"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-text-primary">
          <SwordsIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">Battle — {card.name}</span>
        </h3>
        <button
          onClick={onClose}
          aria-label="Close battle panel"
          className="button-secondary h-10 w-10 min-h-10 shrink-0 rounded-full p-0 text-xs"
        >
          ✕
        </button>
      </div>

      {statusLoading ? (
        <p className="mt-4 text-xs text-text-tertiary">Loading battle status…</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-text-tertiary">
            Battle other wallets&apos; cards for XP and levels. Opting in lets other players challenge you back —
            winning as a defender earns XP too, and a defensive loss recovers faster than an offensive one.
          </p>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-border-default bg-surface-2 px-3 py-2">
            <span className="text-xs text-text-secondary">Defend against other wallets</span>
            <button
              onClick={toggleOptIn}
              disabled={panelState.kind === "awaiting_signature" || panelState.kind === "syncing"}
              className={`button-secondary px-3 py-1.5 text-xs font-semibold ${status?.optedIn ? "text-accent" : ""}`}
            >
              {panelState.kind === "syncing" ? "Syncing your holdings…" : status?.optedIn ? "Opted in" : "Opt in"}
            </button>
          </div>
          {status?.optedIn ? (
            atDefenseCap && (
              <p className="mt-1 text-xs text-text-tertiary">
                You&apos;ve reached today&apos;s defense limit — other wallets can&apos;t match against you until it resets.
              </p>
            )
          ) : (
            <p className="mt-1 text-xs text-text-tertiary">
              You can still attack without opting in — but your own cards stay invisible as opponents until you do.
            </p>
          )}

          {ownCardStatus ? (
            <div className="mt-3 text-xs text-text-secondary">
              <p>
                Level {ownCardStatus.level} · Power {ownCardStatus.power} · HP {ownCardStatus.hp}
              </p>
              {isRecovering && (
                <p className="mt-1 text-danger">{recoveryCopy(ownCardStatus.recoveryReason)}</p>
              )}
            </div>
          ) : (
            previewStats && (
              <p className="mt-3 text-xs text-text-tertiary">
                Estimated Level 1 · Power {previewStats.power} · HP {previewStats.hp} — never battled, exact stats lock in on your first battle.
              </p>
            )
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
              <p className="text-xs text-text-tertiary">
                {mode === "random"
                  ? "Automatically matched against a similar-strength opponent."
                  : "Target one specific wallet's best-matching card instead."}
              </p>

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
                  panelState.kind === "syncing" ||
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
        </>
      )}
    </div>
  );
}
