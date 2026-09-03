import assert from "node:assert/strict";
import test from "node:test";

import type { NFTCard } from "@/lib/objkt";
import { calculateDeckStats } from "./DeckGrid";

function createCard(overrides: Partial<NFTCard>): NFTCard {
  return {
    token_id: "1",
    contract_address: "KT1Deck",
    name: "Deck Card",
    objkt_url: "https://objkt.com/asset/KT1Deck/1",
    rarity: "common",
    ...overrides,
  };
}

test("calculateDeckStats counts the collection in one shared result", () => {
  const stats = calculateDeckStats([
    createCard({ artist_alias: "Artist A", collection_name: "Collection A" }),
    createCard({
      token_id: "2",
      artist_alias: "Artist A",
      collection_name: "Collection B",
      rarity: "rare",
    }),
    createCard({
      token_id: "3",
      artist_address: "tz1ArtistB",
      collection_name: "Collection B",
      rarity: "legendary",
    }),
  ]);

  assert.deepEqual(stats, {
    total: 3,
    artists: 2,
    collections: 2,
    highRarityCount: 2,
  });
});
