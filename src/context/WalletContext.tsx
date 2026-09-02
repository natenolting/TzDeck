"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { BeaconWallet } from "@taquito/beacon-wallet";
import { NetworkType } from "@ecadlabs/beacon-types";
import { TezosToolkit } from "@taquito/taquito";

interface WalletContextType {
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  tezos: TezosToolkit | null;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  connect: async () => {},
  disconnect: async () => {},
  tezos: null,
});

export const useWallet = () => useContext(WalletContext);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<BeaconWallet | null>(null);
  const [tezos, setTezos] = useState<TezosToolkit | null>(null);

  useEffect(() => {
    const initializeWallet = async () => {
      const rpcUrl = process.env.NEXT_PUBLIC_TEZOS_RPC_URL || "https://mainnet.api.tez.ie";
      const tezosInstance = new TezosToolkit(rpcUrl);

      // Pass network when creating the wallet instance
      const walletInstance = new BeaconWallet({
        name: "TzDeck",
        network: { type: NetworkType.MAINNET },
      });

      tezosInstance.setWalletProvider(walletInstance);
      setWallet(walletInstance);
      setTezos(tezosInstance);

      // Check for existing active account
      const activeAccount = await walletInstance.client.getActiveAccount();
      if (activeAccount) {
        setAddress(activeAccount.address);
      }
    };

    initializeWallet();

    return () => {
      // Cleanup if needed
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

  return (
    <WalletContext.Provider value={{ address, connect, disconnect, tezos }}>
      {children}
    </WalletContext.Provider>
  );
};