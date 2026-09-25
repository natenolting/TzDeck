"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BattleStatus } from "@/lib/battle/status";

export interface BattleStatusState {
  status: BattleStatus | null;
  unavailable: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * A wallet's battle status, loaded once and refreshed on demand. My Deck owns
 * the one instance and hands it to the battle panel, so a refresh after a
 * battle updates the deck's card stats too.
 */
export function useBattleStatus(address: string | null): BattleStatusState {
  const [status, setStatus] = useState<BattleStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!address) return Promise.resolve();
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    return fetch(`/api/battle/status?address=${encodeURIComponent(address)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("status_unavailable");
        return response.json() as Promise<BattleStatus>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setStatus(data);
        setUnavailable(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [address]);

  useEffect(() => {
    void load();
    return () => inFlight.current?.abort();
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  return { status, unavailable, loading, refresh };
}
