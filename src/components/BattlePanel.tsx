"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet, UnsupportedWalletTypeError } from "@/context/WalletContext";
import { getCardImageSources, getCardKey, type NFTCard as NFTCardType } from "@/lib/objkt";
import { useFailoverImage } from "@/hooks/useFailoverImage";
import { baseStatsFromSeed, deriveBaseSeed, type RoundRecord } from "@/lib/battle/rules";
import { RARITY_CONFIG } from "./rarityStyles";
import Switch from "./Switch";
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
  | { kind: "submitting" }
  | { kind: "syncing" }
  | { kind: "declined" }
  | { kind: "unsupported_wallet" }
  | { kind: "result"; result: BattleResult; wasOverkillTiebreak: boolean }
  | { kind: "no_match" }
  | { kind: "cap_reached" }
  | { kind: "expired" }
  | { kind: "uncertain" }
  | { kind: "refreshing_holdings" }
  | { kind: "error"; message: string };

const ATTACK_CAP_MAX = 20;
const DEFENSE_CAP_MAX = 20;

// Large wallets need more than MAX_PAGES_PER_INVOCATION pages of holdings
// synced (opt-in/route.ts, refresh/route.ts), so the server returns 202 and
// expects the same signed request resubmitted to resume from its stored
// cursor. Bounded like MAX_NOT_HELD_REROLLS in random/route.ts so a
// persistently-202 server can't hang the UI forever. Shared by both opt-in
// and the authenticated holdings refresh (item 4) -- same underlying
// materialization pipeline, same continuation contract.
const HOLDINGS_SYNC_MAX_ATTEMPTS = 50;
const HOLDINGS_SYNC_POLL_DELAY_MS = 300;

// opt-in/refresh allow 20 requests/minute per wallet, independent of the
// signed attempt itself -- a large enough wallet's continuation loop can hit
// that budget before finishing. The server already marks the attempt
// retryable on 429 (its nonce/progress are never abandoned), so this waits
// out the window and resubmits the SAME signed body rather than surfacing a
// dead end that would force a fresh signature and restart staging from
// scratch. A separate bound from the 202 loop above so a large wallet's
// legitimate continuation isn't starved by an unrelated rate-limit episode.
const HOLDINGS_RATE_LIMIT_MAX_ATTEMPTS = 15;
const HOLDINGS_RATE_LIMIT_DELAY_MS = 5000;

/** UI policy (item 4): how long a holdings sync is considered fresh before we nudge the user to refresh. */
export const HOLDINGS_STALE_MS = 24 * 60 * 60 * 1000;

export function isHoldingsStale(holdingsRefreshedAt: string | null, now: Date, staleMs: number): boolean {
  if (!holdingsRefreshedAt) return true;
  return now.getTime() - new Date(holdingsRefreshedAt).getTime() > staleMs;
}

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
  maxRateLimitAttempts: number = HOLDINGS_RATE_LIMIT_MAX_ATTEMPTS,
  rateLimitDelayMs: number = HOLDINGS_RATE_LIMIT_DELAY_MS,
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

// ---------------------------------------------------------------------------
// Review follow-up items 1/2: preserving a signed battle attempt across
// network failures and the server's own bounded-retry signals, instead of
// discarding it and mislabeling every post-submission failure as a declined
// signature.
// ---------------------------------------------------------------------------

/**
 * Error strings the battle-route/attempt-ledger contract marks retryable
 * (server called failAttempt/commit_battle with retryable=true, or the
 * request never reached a persisted attempt at all -- attempt_in_progress).
 * Every other non-2xx response is a terminal business rejection per the
 * existing contract (random/route.ts, challenge/route.ts, commit_battle.sql)
 * -- NOT every 409 is retryable: attack_cap_reached, self_challenge,
 * attacker_card_not_held, etc. are all 409 and all terminal, while
 * conflicting_first_use_materialization is also 409 but IS retryable.
 */
const RETRYABLE_BATTLE_ERRORS = new Set([
  "attempt_in_progress",
  "rate_limited",
  "ownership_unverifiable",
  "attacker_metadata_unavailable",
  "attempt_expired",
  "conflicting_first_use_materialization",
]);

const BATTLE_RETRY_MAX_ATTEMPTS = 5;
const BATTLE_RETRY_DELAY_MS = 2000;

export type BattleAttemptOutcome =
  | { kind: "success"; json: Record<string, unknown> }
  | { kind: "terminal"; status: number; error: string }
  | { kind: "expired" }
  | { kind: "uncertain" };

type ClassifiedResponse = BattleAttemptOutcome | { kind: "retry"; retryAfterMs?: number };

async function classifyBattleResponse(post: () => Promise<Response>): Promise<ClassifiedResponse> {
  let response: Response;
  try {
    response = await post();
  } catch {
    return { kind: "retry" };
  }

  let json: Record<string, unknown> = {};
  try {
    json = await response.json();
  } catch {
    return { kind: "retry" };
  }

  if (response.ok) return { kind: "success", json };

  const error = typeof json.error === "string" ? json.error : "battle_request_failed";
  if (error === "nonce_expired") return { kind: "expired" };
  if (RETRYABLE_BATTLE_ERRORS.has(error)) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    return { kind: "retry", retryAfterMs };
  }
  return { kind: "terminal", status: response.status, error };
}

/**
 * Resubmits `post()` -- the identical signed body, never re-signed -- while
 * the response is one the attempt ledger marks retryable. Honors a 409
 * attempt_in_progress's Retry-After header; falls back to `defaultDelayMs`
 * otherwise. Exhausting `maxAttempts` reports "uncertain" (the request may
 * have settled server-side even though this client never confirmed it)
 * rather than a false success or a false terminal failure. `wait` is
 * injectable so tests don't need real timers.
 */
export async function resubmitBattleAttempt(
  post: () => Promise<Response>,
  maxAttempts: number = BATTLE_RETRY_MAX_ATTEMPTS,
  defaultDelayMs: number = BATTLE_RETRY_DELAY_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<BattleAttemptOutcome> {
  let attempts = 0;
  for (;;) {
    const outcome = await classifyBattleResponse(post);
    if (outcome.kind !== "retry") return outcome;
    attempts += 1;
    if (attempts > maxAttempts) return { kind: "uncertain" };
    await wait(outcome.retryAfterMs ?? defaultDelayMs);
  }
}

/**
 * Pure mapping from a classified attempt outcome to the resulting panel
 * state, isolated from React so every branch is directly testable. Only
 * "uncertain" retains the pending attempt -- every other outcome is either a
 * definite answer (success, a business rejection) or requires a fresh
 * signature (expired), so resubmitting the same body would be pointless or
 * wrong.
 */
export function applyBattleOutcome(outcome: BattleAttemptOutcome): {
  panelState: PanelState;
  clearPendingAttempt: boolean;
} {
  switch (outcome.kind) {
    case "success": {
      const json = outcome.json;
      if (json.outcome === "no_match") {
        return { panelState: { kind: "no_match" }, clearPendingAttempt: true };
      }
      // An overkill-tiebreak win is one where both sides' realized HP hit
      // zero the same round -- the server doesn't currently flag this
      // explicitly in the response, so this reads as an ordinary win until
      // that's added; documented here rather than guessed at.
      return {
        panelState: { kind: "result", result: json as unknown as BattleResult, wasOverkillTiebreak: false },
        clearPendingAttempt: true,
      };
    }
    case "terminal":
      if (outcome.error === "attack_cap_reached" || outcome.error === "defense_cap_reached") {
        return { panelState: { kind: "cap_reached" }, clearPendingAttempt: true };
      }
      return { panelState: { kind: "error", message: outcome.error }, clearPendingAttempt: true };
    case "expired":
      return { panelState: { kind: "expired" }, clearPendingAttempt: true };
    case "uncertain":
      return { panelState: { kind: "uncertain" }, clearPendingAttempt: false };
  }
}

interface PendingBattleAttempt {
  /** The wallet that actually signed this attempt (from signChallenge's own result), not a possibly-stale reactive address. */
  wallet: string;
  endpoint: string;
  body: string;
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
  const [pendingAttempt, setPendingAttempt] = useState<PendingBattleAttempt | null>(null);
  // Bumped on every new attempt (initial submit or manual retry) so a
  // superseded async resolution can never overwrite a later one's UI --
  // "only the active attempt may update the result or release the busy
  // state" (item 1).
  const attemptIdRef = useRef(0);

  const rarity = card.rarity || "common";
  const rarityConfig = RARITY_CONFIG[rarity];
  const cardImageSources = useMemo(
    () => getCardImageSources(card.thumbnail_uri, card.display_uri, card.artifact_uri),
    [card.thumbnail_uri, card.display_uri, card.artifact_uri],
  );
  const { imageUrl: cardImageUrl, loaded: cardImageLoaded, failed: cardImageFailed, handleLoad: handleCardImageLoad, handleError: handleCardImageError } =
    useFailoverImage(cardImageSources);

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
  const holdingsStale = isHoldingsStale(status?.holdingsRefreshedAt ?? null, new Date(), HOLDINGS_STALE_MS);

  // One shared busy flag: a battle submission, an opt-in sync, and a
  // holdings refresh must never run concurrently (item 2), and every
  // action-triggering control in the panel disables on the same condition.
  const isBusy =
    panelState.kind === "awaiting_signature" ||
    panelState.kind === "syncing" ||
    panelState.kind === "submitting" ||
    panelState.kind === "refreshing_holdings";

  const toggleOptIn = async () => {
    // Duplicate-invocation guard beyond the disabled control (item 2).
    if (isBusy || !status) return;
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
      const { response, timedOut } = await resubmitWhilePending(postOptIn, HOLDINGS_SYNC_MAX_ATTEMPTS, HOLDINGS_SYNC_POLL_DELAY_MS);
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

  // Item 4: an explicit, authenticated holdings refresh -- opt-in only reads
  // status today, so a card acquired after opting in stays outside the
  // defender pool until the wallet opts out and back in. Signs the existing
  // `refresh` action with `[]` (GET /api/battle/status stays read-only) and
  // reuses the same bounded-continuation/rate-limit handling as opt-in,
  // since refresh/route.ts shares the identical materialization pipeline --
  // opt-in state itself is never touched by this call.
  const refreshHoldings = async () => {
    if (isBusy) return;
    setPanelState({ kind: "awaiting_signature" });
    try {
      const signed = await signChallenge("refresh", []);
      const requestBody = JSON.stringify({ ...signed, claimedAddress: signed.address });
      const postRefresh = () =>
        fetch("/api/battle/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });

      setPanelState({ kind: "refreshing_holdings" });
      const { response, timedOut } = await resubmitWhilePending(postRefresh, HOLDINGS_SYNC_MAX_ATTEMPTS, HOLDINGS_SYNC_POLL_DELAY_MS);
      if (timedOut) {
        setPanelState({ kind: "error", message: "Holdings refresh is taking too long. Please try again." });
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setPanelState({ kind: "error", message: body.error || "Failed to refresh holdings." });
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

  // Submits (or resubmits, on manual Retry) one already-signed attempt.
  // Never calls signChallenge -- that only happens once, in startBattle,
  // before an attempt exists. Item 1: retains the exact signed body across
  // automatic retries and an exhausted-retry manual Retry alike.
  const submitAttempt = useCallback(
    async (attempt: PendingBattleAttempt) => {
      const attemptId = ++attemptIdRef.current;
      setPanelState({ kind: "submitting" });

      const post = () =>
        fetch(attempt.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: attempt.body,
        });
      const outcome = await resubmitBattleAttempt(post);

      // A newer attempt superseded this one, or the wallet that signed it
      // is no longer the connected wallet -- drop this stale resolution
      // rather than letting it clobber the current UI (item 1).
      if (attemptIdRef.current !== attemptId || address !== attempt.wallet) return;

      const { panelState: nextState, clearPendingAttempt } = applyBattleOutcome(outcome);
      setPanelState(nextState);
      if (clearPendingAttempt) setPendingAttempt(null);
      if (nextState.kind === "result") await refreshStatus();
    },
    [address, refreshStatus],
  );

  const startBattle = async () => {
    // Guards the handler itself, not just the disabled control (item 2).
    if (isBusy) return;
    if (isRecovering || atAttackCap) return;
    setPanelState({ kind: "awaiting_signature" });

    let signed: Awaited<ReturnType<typeof signChallenge>>;
    try {
      const action = mode === "random" ? "random" : "challenge";
      const params = mode === "random" ? [cardKey] : [cardKey, targetWallet];
      signed = await signChallenge(action, params);
    } catch (error) {
      // Only a wallet-signing rejection/cancellation reaches this catch --
      // nothing after this point (the POST phase) is allowed to land here
      // and be mislabeled as a declined signature (item 1).
      if (error instanceof UnsupportedWalletTypeError) {
        setPanelState({ kind: "unsupported_wallet" });
        return;
      }
      setPanelState({ kind: "declined" });
      return;
    }

    const body =
      mode === "random"
        ? { ...signed, claimedAddress: signed.address, attackerCardKey: cardKey }
        : { ...signed, claimedAddress: signed.address, attackerCardKey: cardKey, defenderWallet: targetWallet };
    const attempt: PendingBattleAttempt = {
      wallet: signed.address,
      endpoint: `/api/battle/${mode}`,
      body: JSON.stringify(body),
    };
    setPendingAttempt(attempt);
    await submitAttempt(attempt);
  };

  const retryPendingAttempt = async () => {
    if (!pendingAttempt || isBusy) return;
    await submitAttempt(pendingAttempt);
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
      className="overflow-hidden rounded-2xl border border-border-default bg-surface-1/90 backdrop-blur-md"
      aria-live="polite"
    >
      {statusLoading ? (
        <p className="p-5 text-xs text-text-tertiary">Loading battle status…</p>
      ) : (
        <>
          {/* Focal header -- the card itself leads, not a caption naming it. */}
          <div className="relative flex items-center gap-4 p-5">
            <button
              onClick={onClose}
              aria-label="Close battle panel"
              className="button-secondary absolute right-4 top-4 h-8 w-8 min-h-8 shrink-0 rounded-full p-0 text-xs"
            >
              ✕
            </button>

            <div
              className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-surface-2 transition-all ${rarityConfig.ring} ${rarityConfig.glow}`}
            >
              {!cardImageFailed && cardImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardImageUrl}
                  alt={card.name}
                  onLoad={handleCardImageLoad}
                  onError={handleCardImageError}
                  className={`h-full w-full object-cover transition-opacity ${cardImageLoaded ? "opacity-100" : "opacity-0"}`}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <SwordsIcon className="h-6 w-6 text-text-muted" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 pr-8">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${rarityConfig.badge}`}
              >
                {rarityConfig.label}
              </span>
              <h3 className="mt-1.5 truncate text-base font-bold text-text-primary">{card.name}</h3>
              {ownCardStatus ? (
                <p className="mt-0.5 text-xs text-text-secondary">
                  Level {ownCardStatus.level} · Power {ownCardStatus.power} · HP {ownCardStatus.hp}
                </p>
              ) : (
                previewStats && (
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    Est. Level 1 · Power {previewStats.power} · HP {previewStats.hp}
                  </p>
                )
              )}
              {isRecovering && (
                <p className="mt-1 text-xs font-medium text-danger">{recoveryCopy(ownCardStatus?.recoveryReason ?? null)}</p>
              )}
            </div>
          </div>

          {/* Demoted settings -- quieter than the card above and the action below on purpose. */}
          <div className="divide-y divide-border-subtle border-y border-border-subtle px-5 text-2xs text-text-tertiary">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="font-medium text-text-secondary">Defend against other wallets</p>
                {status?.optedIn ? (
                  atDefenseCap && <p className="mt-0.5">Today&apos;s defense limit reached — opponents can&apos;t match against you until it resets.</p>
                ) : (
                  <p className="mt-0.5">You can still attack without opting in, but your cards stay invisible as opponents.</p>
                )}
                {panelState.kind === "syncing" && <p className="mt-0.5 text-accent-hover">Syncing your holdings…</p>}
              </div>
              <Switch checked={Boolean(status?.optedIn)} onChange={toggleOptIn} disabled={isBusy} label="Defend against other wallets" />
            </div>

            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p>
                  {status?.holdingsRefreshedAt
                    ? `Holdings synced ${new Date(status.holdingsRefreshedAt).toLocaleString()}`
                    : "Holdings never synced"}
                </p>
                {holdingsStale && <p className="mt-0.5">Newly acquired cards may be missing until you refresh.</p>}
              </div>
              <button
                onClick={refreshHoldings}
                disabled={isBusy}
                className="button-quiet shrink-0 px-2.5 py-1 text-2xs font-semibold"
              >
                {panelState.kind === "refreshing_holdings" ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Action zone. */}
          <div className="p-5">
            {panelState.kind === "uncertain" ? (
              <div className="rounded-xl border border-danger/40 bg-danger-quiet px-3 py-3 text-xs text-danger">
                <p>
                  We couldn&apos;t confirm whether this battle completed. Retrying resubmits the exact same signed
                  request — it will never start a second battle.
                </p>
                <button onClick={retryPendingAttempt} className="button-secondary mt-2 w-full px-3 py-2 text-xs font-semibold">
                  Retry
                </button>
              </div>
            ) : isRecovering ? (
              <p className="rounded-xl border border-danger/40 bg-danger-quiet px-3 py-2 text-xs text-danger">
                This card is recovering and can&apos;t battle right now.
              </p>
            ) : atAttackCap ? (
              <p className="rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs text-text-secondary">
                Daily battle limit reached, resets {status?.attackResetAt ? new Date(status.attackResetAt).toLocaleTimeString() : "soon"}.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
                  <button
                    onClick={() => setMode("random")}
                    aria-pressed={mode === "random"}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === "random" ? "tab-button-active" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Random Battle
                  </button>
                  <button
                    onClick={() => setMode("challenge")}
                    aria-pressed={mode === "challenge"}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === "challenge" ? "tab-button-active" : "text-text-secondary hover:text-text-primary"
                    }`}
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
                  disabled={isBusy || (mode === "challenge" && (!targetWallet || targetWallet === address))}
                  className="button-primary w-full px-4 py-2.5 text-xs font-semibold"
                >
                  {panelState.kind === "awaiting_signature"
                    ? "Awaiting wallet signature…"
                    : panelState.kind === "submitting"
                      ? "Battling…"
                      : "Battle!"}
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
            {panelState.kind === "expired" && (
              <p className="mt-3 text-xs text-danger">
                This battle attempt expired before it could complete. Click Battle! to try again with a fresh
                signature.
              </p>
            )}
            {panelState.kind === "error" && <p className="mt-3 text-xs text-danger">{panelState.message}</p>}
          </div>
        </>
      )}
    </div>
  );
}
