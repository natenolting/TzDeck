"use client";

import { useCallback, useEffect, useState } from "react";
import { convertIpfsUrl, extractIpfsHash, IPFS_GATEWAYS } from "@/lib/ipfs";

/** NFT hosts are unbounded and often just slow rather than erroring, and a
 * stalled fetch never fires the `<img>` error event the gateway/source
 * fallback relies on -- without this, a stalled request leaves the image
 * stuck on its spinner forever instead of trying the next gateway. */
export const LOAD_TIMEOUT_MS = 8_000;

export function useFailoverImage(sources: string[], timeoutMs: number = LOAD_TIMEOUT_MS) {
  const [sourceIdx, setSourceIdx] = useState(0);
  const [gatewayIdx, setGatewayIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const rawUri = sources[sourceIdx] || "";
  const imageUrl = convertIpfsUrl(rawUri, gatewayIdx);

  const advance = useCallback(() => {
    setLoaded(false);

    if (extractIpfsHash(rawUri) && gatewayIdx < IPFS_GATEWAYS.length - 1) {
      setGatewayIdx((prev) => prev + 1);
    } else if (sourceIdx < sources.length - 1) {
      setSourceIdx((prev) => prev + 1);
      setGatewayIdx(0);
    } else {
      setFailed(true);
    }
  }, [rawUri, gatewayIdx, sourceIdx, sources.length]);

  useEffect(() => {
    if (!imageUrl || loaded || failed) return;

    const timer = window.setTimeout(advance, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [imageUrl, loaded, failed, advance, timeoutMs]);

  const handleLoad = useCallback(() => setLoaded(true), []);

  return { imageUrl, loaded, failed, handleLoad, handleError: advance };
}
