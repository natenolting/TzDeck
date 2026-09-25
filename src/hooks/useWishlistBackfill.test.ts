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
let hookModule: typeof import("./useWishlistBackfill") | undefined;
let wishlistModule: typeof import("./useWishlist") | undefined;
let objktClient: StubbedClient | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  hookModule ||= await import("./useWishlistBackfill");
  wishlistModule ||= await import("./useWishlist");
  objktClient ||= (await import("@/lib/objkt")).objktClient as unknown as StubbedClient;
  return { ...testingLibrary, ...hookModule, useWishlist: wishlistModule.useWishlist, objktClient };
}

afterEach(() => {
  testingLibrary?.cleanup();
  hookModule?.resetBackfillForTests();
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
  const { renderHook, waitFor, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = objktRespondsWith("video/mp4");

  try {
    renderHook(() => useWishlistBackfill([card()]));

    await waitFor(() => assert.equal(storedWishlist()[0]?.mime, "video/mp4"));
    // The card keeps its place; this is an upgrade, not a replacement.
    assert.equal(storedWishlist().length, 1);
    assert.equal(storedWishlist()[0].token_id, "20");
  } finally {
    objktClient.request = original;
  }
});

test("a wishlist that already knows every mime is left alone", async () => {
  const { renderHook, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    // A known edition count too, so the one-time editions recheck has nothing to ask.
    renderHook(() => useWishlistBackfill([card({ mime: "image/png", editions: 25 })]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 0, "no card needed upgrading, so OBJKT must not be asked");
  } finally {
    objktClient.request = original;
  }
});

test("an empty wishlist asks OBJKT nothing", async () => {
  const { renderHook, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    renderHook(() => useWishlistBackfill([]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 0);
  } finally {
    objktClient.request = original;
  }
});

test("the upgrade runs once, even for a token OBJKT reports no mime for", async () => {
  // Otherwise the card still lacks a mime after refreshing, the predicate stays
  // true, and every re-render fires another request.
  const { renderHook, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  objktClient.request = async () => {
    requests += 1;
    return { listing: [], token: [] };
  };

  try {
    const { rerender } = renderHook(() => useWishlistBackfill([card()]));
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
  const { renderHook, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = async () => {
    throw new Error("network down");
  };
  dom.window.localStorage.setItem("tzdeck_wishlist", JSON.stringify([card()]));

  try {
    renderHook(() => useWishlistBackfill([card()]));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const saved = storedWishlist();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].token_id, "20");
    assert.equal(saved[0].mime, undefined);
  } finally {
    objktClient.request = original;
  }
});

function objktReportsSupply(supply: number | null) {
  return async () => ({
    listing: [],
    token: [{
      name: "A video token",
      token_id: "20",
      fa_contract: "KT1Video",
      display_uri: "ipfs://QmPoster",
      artifact_uri: "ipfs://QmMovie",
      thumbnail_uri: null,
      supply,
      mime: "video/mp4",
      creators: [],
      fa: { name: "Videos" },
    }],
  });
}

test("needsEditionsRecheck asks about saved 1 of 1s and Unknowns, once per browser", async () => {
  const { needsEditionsRecheck } = await loadTestHarness();

  assert.equal(needsEditionsRecheck([card({ editions: 1 })]), true);
  assert.equal(needsEditionsRecheck([card({ editions: undefined })]), true);
  assert.equal(needsEditionsRecheck([card({ editions: 25 })]), false);
  assert.equal(needsEditionsRecheck([]), false);

  dom.window.localStorage.setItem("tzdeck_wishlist_editions_checked", "1");
  assert.equal(needsEditionsRecheck([card({ editions: 1 })]), false);
});

test("a saved 1 of 1 whose supply OBJKT doesn't know is corrected to Unknown", async () => {
  const { renderHook, waitFor, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = objktReportsSupply(null);

  try {
    renderHook(() => useWishlistBackfill([card({ mime: "video/mp4", editions: 1, rarity: "legendary" })]));

    await waitFor(() => assert.equal(storedWishlist()[0]?.rarity, "common"));
    assert.equal(storedWishlist()[0].editions, undefined);
    assert.equal(dom.window.localStorage.getItem("tzdeck_wishlist_editions_checked"), "1");
  } finally {
    objktClient.request = original;
  }
});

test("a genuine 1 of 1 is not re-checked on later visits once the recheck has run", async () => {
  const { renderHook, waitFor, useWishlistBackfill, resetBackfillForTests, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  let requests = 0;
  const respond = objktReportsSupply(1);
  objktClient.request = async () => {
    requests += 1;
    return respond();
  };
  const genuine = card({ mime: "video/mp4", editions: 1, rarity: "legendary" });

  try {
    renderHook(() => useWishlistBackfill([genuine]));
    await waitFor(() => assert.equal(dom.window.localStorage.getItem("tzdeck_wishlist_editions_checked"), "1"));
    assert.equal(storedWishlist()[0].editions, 1);

    resetBackfillForTests(); // a fresh page load
    renderHook(() => useWishlistBackfill([genuine]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(requests, 1, `a real 1 of 1 must not cost a request on every visit, made ${requests}`);
  } finally {
    objktClient.request = original;
  }
});

test("an unreachable OBJKT leaves the editions recheck to try again next visit", async () => {
  const { renderHook, useWishlistBackfill, objktClient } = await loadTestHarness();
  const original = objktClient.request;
  objktClient.request = async () => {
    throw new Error("network down");
  };

  try {
    renderHook(() => useWishlistBackfill([card({ mime: "video/mp4", editions: 1 })]));
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(dom.window.localStorage.getItem("tzdeck_wishlist_editions_checked"), null);
  } finally {
    objktClient.request = original;
  }
});

test("loading a saved wishlist turns an edition count of zero into Unknown before anything is fetched", async () => {
  const { act, renderHook, useWishlist } = await loadTestHarness();
  const { result } = renderHook(() => useWishlist());

  dom.window.localStorage.setItem(
    "tzdeck_wishlist",
    JSON.stringify([card({ editions: 0, rarity: "epic" })]),
  );
  // Another tab writing the wishlist is how the hook re-reads storage.
  act(() => {
    dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key: "tzdeck_wishlist" }));
  });

  assert.equal(result.current.length, 1);
  assert.equal(result.current[0].editions, undefined);
  assert.equal(result.current[0].rarity, "common");
});
