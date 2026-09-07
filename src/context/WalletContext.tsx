"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { BeaconWallet } from "@taquito/beacon-wallet";
import { NetworkType, SigningType } from "@ecadlabs/beacon-types";
import { TezosToolkit } from "@taquito/taquito";
import { runWalletInitialization } from "./walletInitialization";
import { bytesToSignInBrowser, isImplicitAccountPublicKey } from "@/lib/battle/signPayload";
import type { NonceEnvelope } from "@/lib/battle/signPayload";

export interface SignedChallenge {
  envelope: NonceEnvelope;
  publicKey: string;
  signature: string;
  address: string;
}

/** Thrown by signChallenge when the connected account has no usable implicit-account public key. */
export class UnsupportedWalletTypeError extends Error {
  constructor() {
    super("This wallet type is not supported for battles.");
    this.name = "UnsupportedWalletTypeError";
  }
}

interface WalletContextType {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  tezos: TezosToolkit | null;
  signChallenge: (
    action: string,
    params: ReadonlyArray<string | number | boolean>,
  ) => Promise<SignedChallenge>;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  connect: async () => {},
  disconnect: async () => {},
  tezos: null,
  signChallenge: async () => {
    throw new Error("Wallet not connected");
  },
});

export const useWallet = () => useContext(WalletContext);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<BeaconWallet | null>(null);
  const [tezos, setTezos] = useState<TezosToolkit | null>(null);

  useEffect(() => {
    let mounted = true;

    void runWalletInitialization({
      initialize: async () => {
        const rpcUrl = process.env.NEXT_PUBLIC_TEZOS_RPC_URL || "https://mainnet.api.tez.ie";
        const tezosInstance = new TezosToolkit(rpcUrl);
        const walletInstance = new BeaconWallet({
          name: "TzDeck",
          network: { type: NetworkType.MAINNET },
        });

        tezosInstance.setWalletProvider(walletInstance);
        const activeAccount = await walletInstance.client.getActiveAccount();

        return { activeAccount, tezosInstance, walletInstance };
      },
      isMounted: () => mounted,
      onReady: ({ activeAccount, tezosInstance, walletInstance }) => {
        setWallet(walletInstance);
        setTezos(tezosInstance);
        if (activeAccount) setAddress(activeAccount.address);
      },
      onError: (error) => {
        console.error("Failed to initialize wallet:", error);
      },
    });

    return () => {
      mounted = false;
    };
  }, []);

  const connect = async () => {
    if (!wallet) return;
    try {
      // No network property here — it's already set in the wallet instance
      await wallet.requestPermissions();
      const activeAccount = await wallet.client.getActiveAccount();
      if (activeAccount) {
        setAddress(activeAccount.address);
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  const disconnect = async () => {
    if (!wallet) return;
    await wallet.clearActiveAccount();
    setAddress(null);
  };

  // Reuses the { initialize, isMounted, onReady, onError } lifecycle shape's
  // spirit -- a single async flow with no lingering state after unmount,
  // consistent with walletInitialization.ts's pattern -- but doesn't need
  // the mounted-check itself, since it's a one-shot call the caller awaits,
  // not a subscription set up in an effect.
  const signChallenge = async (
    action: string,
    params: ReadonlyArray<string | number | boolean>,
  ): Promise<SignedChallenge> => {
    if (!wallet) throw new Error("Wallet not connected");
    const activeAccount = await wallet.client.getActiveAccount();
    if (!activeAccount) throw new Error("Wallet not connected");

    const publicKey = activeAccount.publicKey;
    if (!publicKey || !isImplicitAccountPublicKey(publicKey)) {
      throw new UnsupportedWalletTypeError();
    }

    const sessionResponse = await fetch("/api/battle/session", { cache: "no-store" });
    if (!sessionResponse.ok) throw new Error("Failed to fetch battle session nonce");
    const session: NonceEnvelope & { appId: string; protocolVersion: number } =
      await sessionResponse.json();
    const envelope: NonceEnvelope = {
      timestamp: session.timestamp,
      random: session.random,
      mac: session.mac,
    };

    const payload = await bytesToSignInBrowser(
      envelope,
      session.protocolVersion,
      session.appId,
      action,
      params,
    );

    const { signature } = await wallet.client.requestSignPayload({
      signingType: SigningType.MICHELINE,
      payload,
      sourceAddress: activeAccount.address,
    });

    return { envelope, publicKey, signature, address: activeAccount.address };
  };

  return (
    <WalletContext.Provider value={{ address, connect, disconnect, tezos, signChallenge }}>
      {children}
    </WalletContext.Provider>
  );
};
