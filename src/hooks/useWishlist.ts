"use client";

import { useSyncExternalStore } from "react";

import type { NFTCard } from "@/lib/objkt";
import { repairStoredEditions } from "@/lib/wishlistTransfer";

const STORAGE_KEY = "tzdeck_wishlist";
const CHANGE_EVENT = "tzdeck:wishlist-change";
const EMPTY_WISHLIST: NFTCard[] = [];

let currentWishlist = EMPTY_WISHLIST;
let isInitialized = false;

function readWishlist(): NFTCard[] {
  if (typeof window === "undefined") return EMPTY_WISHLIST;
  if (isInitialized) return currentWishlist;

  isInitialized = true;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      currentWishlist = EMPTY_WISHLIST;
      return currentWishlist;
    }

    const parsed: unknown = JSON.parse(saved);
    currentWishlist = Array.isArray(parsed) ? (parsed as NFTCard[]).map(repairStoredEditions) : EMPTY_WISHLIST;
  } catch (error) {
    console.error("Failed to load wishlist:", error);
    currentWishlist = EMPTY_WISHLIST;
  }

  return currentWishlist;
}

function getServerWishlist(): NFTCard[] {
  return EMPTY_WISHLIST;
}

function subscribeToWishlist(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      isInitialized = false;
      onStoreChange();
    }
  };
  const handleLocalChange = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, handleLocalChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, handleLocalChange);
  };
}

export function useWishlist(): NFTCard[] {
  return useSyncExternalStore(
    subscribeToWishlist,
    readWishlist,
    getServerWishlist,
  );
}

export function saveWishlist(wishlist: NFTCard[]): void {
  currentWishlist = wishlist;
  isInitialized = true;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wishlist));
  } catch (error) {
    console.error("Failed to save wishlist:", error);
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}
