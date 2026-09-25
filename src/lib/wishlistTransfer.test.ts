import assert from "node:assert/strict";
import { test } from "node:test";

import { objktClient, type NFTCard } from "./objkt";
import {
  WISHLIST_EXPORT_VERSION,
  mergeWishlists,
  parseWishlistExport,
  refreshWishlist,
  repairStoredEditions,
  serializeWishlist,
  wishlistExportFilename,
} from "./wishlistTransfer";

type StubbedClient = {
  request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
};

async function withObjktResponse<T>(
  respond: StubbedClient["request"],
  run: () => Promise<T>,
): Promise<T> {
  const client = objktClient as unknown as StubbedClient;
  const original = client.request;
  client.request = respond;
  try {
    return await run();
  } finally {
    client.request = original;
  }
}

function rawToken(tokenId: string, supply = 1) {
  return {
    name: `Fresh ${tokenId}`,
    token_id: tokenId,
    fa_contract: "KT1Example",
    display_uri: "ipfs://QmFresh",
    artifact_uri: null,
    thumbnail_uri: null,
    supply,
    description: null,
    creators: [{ holder: { alias: "Example Artist", address: "tz1Example" } }],
    fa: { name: "Example Collection" },
  };
}

function card(overrides: Partial<NFTCard> = {}): NFTCard {
  const tokenId = overrides.token_id ?? "0";
  return {
    token_id: tokenId,
    contract_address: "KT1Example",
    name: "Interference 1",
    display_uri: "https://ipfs.io/ipfs/QmExample",
    artist_alias: "Example Artist",
    artist_address: "tz1Example",
    collection_name: "Example Collection",
    editions: 1,
    price_xtz: 600,
    objkt_url: `https://objkt.com/asset/KT1Example/${tokenId}`,
    rarity: "legendary",
    ...overrides,
  };
}

/** What actually survives a file: JSON drops undefined-valued keys either way. */
function throughJson(cards: NFTCard[]): unknown {
  return JSON.parse(JSON.stringify(cards));
}

test("an exported wishlist round-trips back to the same cards", () => {
  const original = [card(), card({ token_id: "1", name: "Interference 2" })];

  const parsed = parseWishlistExport(serializeWishlist(original));

  assert.deepEqual(throughJson(parsed.cards), throughJson(original));
  assert.equal(parsed.skipped, 0);
});

test("the export records its version and timestamp", () => {
  const exportedAt = new Date("2026-09-18T12:00:00.000Z");

  const file = JSON.parse(serializeWishlist([card()], exportedAt));

  assert.equal(file.version, WISHLIST_EXPORT_VERSION);
  assert.equal(file.exported_at, "2026-09-18T12:00:00.000Z");
  assert.equal(parseWishlistExport(serializeWishlist([card()], exportedAt)).exportedAt, "2026-09-18T12:00:00.000Z");
});

test("the export filename is dated so successive backups don't collide", () => {
  assert.equal(
    wishlistExportFilename(new Date("2026-09-18T12:00:00.000Z")),
    "tzdeck-wishlist-2026-09-18.json",
  );
});

test("a bare array of cards imports too, so a raw localStorage copy works", () => {
  const parsed = parseWishlistExport(JSON.stringify([card()]));

  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.exportedAt, null);
});

test("cards missing an identity are skipped rather than failing the whole import", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [card(), { name: "no identity" }, card({ token_id: "2" })],
  });

  const parsed = parseWishlistExport(raw);

  assert.equal(parsed.cards.length, 2);
  assert.equal(parsed.skipped, 1);
});

test("a file that isn't JSON is rejected", () => {
  assert.throws(() => parseWishlistExport("not json at all"), /couldn't be read/i);
});

test("a JSON file with no card list is rejected", () => {
  assert.throws(() => parseWishlistExport(JSON.stringify({ version: 1 })), /wishlist export/i);
});

test("hostile image URLs are dropped instead of being rendered", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [
      card({
        display_uri: "javascript:alert(1)",
        thumbnail_uri: "data:text/html;base64,PHNjcmlwdD4=",
        artifact_uri: "ipfs://QmStillFine",
      }),
    ],
  });

  const [imported] = parseWishlistExport(raw).cards;

  assert.equal(imported.display_uri, undefined);
  assert.equal(imported.thumbnail_uri, undefined);
  assert.equal(imported.artifact_uri, "ipfs://QmStillFine");
});

test("a tampered objkt_url is rebuilt from the token's own identity", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [card({ objkt_url: "https://evil.example.com/drain-wallet" })],
  });

  const [imported] = parseWishlistExport(raw).cards;

  assert.equal(imported.objkt_url, "https://objkt.com/asset/KT1Example/0");
});

test("an unrecognized rarity is re-derived rather than trusted", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [card({ rarity: "mythic" as NFTCard["rarity"], editions: 1, price_xtz: 600 })],
  });

  const [imported] = parseWishlistExport(raw).cards;

  assert.equal(imported.rarity, "legendary");
});

test("non-numeric prices and edition counts are discarded", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [card({
      price_xtz: "600" as unknown as number,
      editions: Number.NaN,
    })],
  });

  const [imported] = parseWishlistExport(raw).cards;

  assert.equal(imported.price_xtz, undefined);
  assert.equal(imported.editions, undefined);
});

test("an edition count of zero imports as Unknown, not a scarce card", () => {
  const raw = JSON.stringify({ version: 1, cards: [card({ editions: 0, price_xtz: undefined, rarity: undefined })] });

  const [imported] = parseWishlistExport(raw).cards;

  assert.equal(imported.editions, undefined);
  assert.equal(imported.rarity, "common");
});

test("a saved edition count of zero is repaired to Unknown and the card regraded", () => {
  const unlisted = repairStoredEditions(card({ editions: 0, price_xtz: undefined, rarity: "epic" }));
  assert.equal(unlisted.editions, undefined);
  assert.equal(unlisted.rarity, "common");

  const listed = repairStoredEditions(card({ editions: 0, price_xtz: 200, rarity: "epic" }));
  assert.equal(listed.editions, undefined);
  assert.equal(listed.rarity, "rare", "a listed card grades on its price alone");
});

test("a saved card with a real edition count is returned untouched", () => {
  const saved = card({ editions: 25 });
  assert.equal(repairStoredEditions(saved), saved);
});

test("a video token's mime survives the export round-trip", () => {
  const video = card({ mime: "video/mp4" });

  const parsed = parseWishlistExport(serializeWishlist([video]));

  assert.equal(parsed.cards[0].mime, "video/mp4");
});

test("a card saved before mime existed still imports", () => {
  // Wishlists already in localStorage predate the field entirely; absent must
  // mean "treat as an image", which is exactly the old behaviour.
  const raw = JSON.stringify({ version: 1, cards: [card()] });

  assert.equal(parseWishlistExport(raw).cards[0].mime, undefined);
});

test("a non-string mime is discarded rather than trusted", () => {
  const raw = JSON.stringify({
    version: 1,
    cards: [card({ mime: { evil: true } as unknown as string })],
  });

  assert.equal(parseWishlistExport(raw).cards[0].mime, undefined);
});

test("merging keeps the existing wishlist order and appends what's new", () => {
  const existing = [card({ token_id: "1" }), card({ token_id: "2" })];
  const incoming = [card({ token_id: "2" }), card({ token_id: "3" })];

  const merged = mergeWishlists(existing, incoming);

  assert.deepEqual(merged.map((c) => c.token_id), ["1", "2", "3"]);
});

test("merging keeps the card already saved when both sides have it", () => {
  const existing = [card({ token_id: "1", name: "Saved name" })];
  const incoming = [card({ token_id: "1", name: "Imported name" })];

  const merged = mergeWishlists(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Saved name");
});

test("a file repeating the same token imports it once", () => {
  const raw = JSON.stringify({ version: 1, cards: [card(), card()] });

  assert.equal(parseWishlistExport(raw).cards.length, 1);
});

test("refreshing replaces a stale price with the current listing", async () => {
  const stale = [card({ price_xtz: 1, rarity: "common" })];

  const result = await withObjktResponse(
    async () => ({
      listing: [{ id: 9, price: 600_000_000, token: rawToken("0") }],
      token: [rawToken("0")],
    }),
    () => refreshWishlist(stale),
  );

  assert.equal(result.cards[0].price_xtz, 600);
  assert.equal(result.cards[0].rarity, "legendary");
  assert.equal(result.refreshed, 1);
  assert.equal(result.stale, 0);
});

test("refreshing clears the price of a token that is no longer listed", async () => {
  const stale = [card({ price_xtz: 600, rarity: "legendary" })];

  const result = await withObjktResponse(
    async () => ({ listing: [], token: [rawToken("0", 40)] }),
    () => refreshWishlist(stale),
  );

  assert.equal(result.cards[0].price_xtz, undefined);
  assert.equal(result.cards[0].rarity, "common");
  assert.equal(result.refreshed, 1);
});

test("refreshing keeps the stored card when OBJKT can't be reached", async () => {
  const stale = [card({ name: "Stored name", price_xtz: 600 })];

  const result = await withObjktResponse(
    async () => {
      throw new Error("network down");
    },
    () => refreshWishlist(stale),
  );

  assert.equal(result.cards[0].name, "Stored name");
  assert.equal(result.cards[0].price_xtz, 600);
  assert.equal(result.refreshed, 0);
  assert.equal(result.stale, 1);
});

test("refreshing preserves wishlist order across a partial response", async () => {
  const stale = [card({ token_id: "0" }), card({ token_id: "1" }), card({ token_id: "2" })];

  const result = await withObjktResponse(
    async () => ({ listing: [], token: [rawToken("1")] }),
    () => refreshWishlist(stale),
  );

  assert.deepEqual(result.cards.map((c) => c.token_id), ["0", "1", "2"]);
  assert.equal(result.cards[1].name, "Fresh 1");
  assert.equal(result.refreshed, 1);
  assert.equal(result.stale, 2);
});
