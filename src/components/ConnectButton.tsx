"use client";

import React, { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { formatShortAddress } from "@/lib/objkt";

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
          className="flex items-center gap-1.5 rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-xs font-mono text-text-primary hover:border-border-strong transition-colors backdrop-blur-md"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{formatShortAddress(address)}</span>
          {copied ? (
            <span className="text-2xs text-emerald-400 font-sans">✓ Copied</span>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.8"
              stroke="currentColor"
              className="h-3.5 w-3.5 text-text-tertiary"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
              />
            </svg>
          )}
        </button>

        <button
          onClick={disconnect}
          className="rounded-xl border border-red-800/40 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/60 hover:text-text-primary transition-colors"
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
