"use client";

import React, { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatShortAddress } from "@/lib/objkt";
import { CheckIcon, CopyIcon, LogoutIcon } from "./icons";

interface ConnectButtonProps {
  variant?: "primary" | "quiet";
  /**
   * Icon-only below `sm`, for the header, where the full buttons pushed the
   * wallet onto its own row and the Packs screen off one phone screen. Each
   * button's text stays in the accessibility tree, visually hidden, so it
   * keeps its name.
   */
  compact?: boolean;
}

export default function ConnectButton({ variant = "primary", compact = false }: ConnectButtonProps) {
  const { address, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connect();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Hidden on phones when compact, but always read by screen readers.
  const phoneText = compact ? "max-sm:sr-only" : "";
  const phoneSquare = compact ? "max-sm:w-10 max-sm:px-0" : "";

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          title="Click to copy full address"
          className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-xs font-mono text-text-primary hover:border-border-strong transition-colors backdrop-blur-md ${compact ? "max-sm:px-2.5" : ""}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className={phoneText}>{formatShortAddress(address)}</span>
          {copied ? (
            <span className="flex items-center gap-1 text-2xs text-success font-sans">
              <CheckIcon className="h-3.5 w-3.5" />
              <span className={phoneText}>Copied</span>
            </span>
          ) : (
            <CopyIcon className="h-3.5 w-3.5 text-text-tertiary" />
          )}
        </button>

        <button
          onClick={disconnect}
          className={`flex min-h-10 items-center justify-center rounded-xl border border-danger/30 bg-danger-quiet px-3 py-2.5 text-xs font-semibold text-danger hover:bg-danger/20 hover:text-text-primary transition-colors ${phoneSquare}`}
        >
          {compact && <LogoutIcon className="h-4 w-4 shrink-0 sm:hidden" />}
          <span className={phoneText}>Disconnect</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isConnecting}
      className={`${variant === "primary" ? "button-primary" : "button-quiet"} gap-2 px-4 py-2 text-xs font-bold ${phoneSquare}`}
    >
      <span aria-hidden="true">ꜩ</span>
      <span className={phoneText}>{isConnecting ? "Connecting..." : "Connect Tezos Wallet"}</span>
    </button>
  );
}
