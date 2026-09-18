import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type NFTCard = import("@/lib/objkt").NFTCard;
type StubbedClient = {
  request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
};

let testingLibrary: TestingLibrary | undefined;
let hookModule: typeof import("./useWishlistMimeBackfill") | undefined;
let objktClient: StubbedClient | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  hookModule ||= await import("./useWishlistMimeBackfill");
  objktClient ||= (await import("@/lib/objkt")).objktClient as unknown as StubbedClient;
  return { ...testingLibrary, ...hookModule, objktClient };
}

afterEach(() => {
  testingLibrary?.cleanup();
  hookModule?.resetMimeBackfillForTests();
  dom.window.localStorage.clear();
});

function card(overrides: Partial<NFTCard> = {}): NFTCard {
  return {
    token_id: "20",
    contract_address: "KT1Video",
    name: "A video token",
    display_uri: "https://example.com/poster.png",
    artifact_uri: "https://example.com/movie.mp4",
    objkt_url: "https://objkt.com/asset/KT1Video/20",
    rarity: "common",
    ...overrides,
  };
}

function objktRespondsWith(mime: string) {
  return async () => ({
    listing: [],
    token: [{
      name: "A video token",
      token_id: "20",
      fa_contract: "KT1Video",
      display_uri: "ipfs://QmPoster",
      artifact_uri: "ipfs://QmMovie",
      thumbnail_uri: null,
      supply: 1,
      mime,
      creators: [],
      fa: { name: "Videos" },
    }],
  });
}

function storedWishlist(): NFTCard[] {
  return JSON.parse(dom.window.localStorage.getItem("tzdeck_wishlist") || "[]");
}

test("needsMimeBackfill spots a wishlist saved before the field existed", async () => {
  const { needsMimeBackfill } = await loadTestHarness();

  assert.equal(needsMimeBackfill([card()]), true);
  assert.equal(needsMimeBackfill([card({ mime: "video/mp4" })]), false);
  assert.equal(needsMimeBackfill([card({ mime: "image/png" }), card()]), true);
  assert.equal(needsMimeBackfill([]), false);
});

test("a wishlist card saved before mime existed is upgraded in place", async () => {
  const { renderHook, waitFor, useWishlistMimeBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = objktRespondsWith("video/mp4");

  try {
    renderHook(() => useWishlistMimeBackfill([card()]));

    await waitFor(() => assert.equal(storedWishlist()[0]?.mime, "video/mp4"));
    // The card keeps its place; this is an upgrade, not a replacement.
    assert.equal(storedWishlist().length, 1);
    assert.equal(storedWishlist()[0].token_id, "20");
  } finally {
    objktClient.request = original;
  }
});

test("a wishlist that already knows every mime is left alone", async () => {
  const { renderHook, useWishlistMimeBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    renderHook(() => useWishlistMimeBackfill([card({ mime: "image/png" })]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 0, "no card needed upgrading, so OBJKT must not be asked");
  } finally {
    objktClient.request = original;
  }
});

test("an empty wishlist asks OBJKT nothing", async () => {
  const { renderHook, useWishlistMimeBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    renderHook(() => useWishlistMimeBackfill([]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 0);
  } finally {
    objktClient.request = original;
  }
});

test("the upgrade runs once, even for a token OBJKT reports no mime for", async () => {
  // Otherwise the card still lacks a mime after refreshing, the predicate stays
  // true, and every re-render fires another request.
  const { renderHook, useWishlistMimeBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    const { rerender } = renderHook(() => useWishlistMimeBackfill([card()]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 1, `expected a single attempt, made ${requests}`);
  } finally {
    objktClient.request = original;
  }
});

test("an unreachable OBJKT leaves the saved wishlist untouched", async () => {
  const { renderHook, useWishlistMimeBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = async () => {
    throw new Error("network down");
  };
  dom.window.localStorage.setItem("tzdeck_wishlist", JSON.stringify([card()]));

  try {
    renderHook(() => useWishlistMimeBackfill([card()]));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const saved = storedWishlist();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].token_id, "20");
    assert.equal(saved[0].mime, undefined);
  } finally {
    objktClient.request = original;
  }
});
