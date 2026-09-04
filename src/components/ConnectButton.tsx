"use client";

import React, { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatShortAddress } from "@/lib/objkt";
import { CheckIcon, CopyIcon } from "./icons";

interface ConnectButtonProps {
  variant?: "primary" | "quiet";
}

export default function ConnectButton({ variant = "primary" }: ConnectButtonProps) {
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

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          title="Click to copy full address"
          className="flex min-h-10 items-center gap-1.5 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-xs font-mono text-text-primary hover:border-border-strong transition-colors backdrop-blur-md"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{formatShortAddress(address)}</span>
          {copied ? (
            <span className="flex items-center gap-1 text-2xs text-emerald-400 font-sans">
              <CheckIcon className="h-3.5 w-3.5" />
              Copied
            </span>
          ) : (
            <CopyIcon className="h-3.5 w-3.5 text-text-tertiary" />
          )}
        </button>

        <button
          onClick={disconnect}
          className="min-h-10 rounded-xl border border-red-800/40 bg-red-950/40 px-3 py-2.5 text-xs font-semibold text-red-300 hover:bg-red-900/60 hover:text-text-primary transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isConnecting}
      className={`${variant === "primary" ? "button-primary" : "button-quiet"} gap-2 px-4 py-2 text-xs font-bold`}
    >
      <span>ꜩ</span>
      <span>{isConnecting ? "Connecting..." : "Connect Tezos Wallet"}</span>
    </button>
  );
}
