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
  SVGElement: dom.window.SVGElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  Blob: dom.window.Blob,
  File: dom.window.File,
  // Node's own global URL has a createObjectURL that rejects a jsdom Blob, so
  // the document's URL has to win here.
  URL: dom.window.URL,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

// jsdom implements neither half of the object-URL pair that a download needs.
const objectUrls = new Map<string, Blob>();
dom.window.URL.createObjectURL = (blob: Blob) => {
  const url = `blob:mock/${objectUrls.size}`;
  objectUrls.set(url, blob);
  return url;
};
dom.window.URL.revokeObjectURL = (url: string) => {
  objectUrls.delete(url);
};

type TestingLibrary = typeof import("@testing-library/react");
type WishlistGridComponent = typeof import("./WishlistGrid")["default"];
type NFTCard = import("@/lib/objkt").NFTCard;
type StubbedClient = {
  request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
};

let testingLibrary: TestingLibrary | undefined;
let WishlistGrid: WishlistGridComponent | undefined;
let objktClient: StubbedClient | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  WishlistGrid ||= (await import("./WishlistGrid")).default;
  objktClient ||= (await import("@/lib/objkt")).objktClient as unknown as StubbedClient;
  return { ...testingLibrary, WishlistGrid, objktClient };
}

afterEach(() => testingLibrary?.cleanup());

function card(overrides: Partial<NFTCard> = {}): NFTCard {
  const tokenId = overrides.token_id ?? "0";
  return {
    token_id: tokenId,
    contract_address: "KT1Example",
    name: "Interference 1",
    display_uri: "https://ipfs.io/ipfs/QmExample",
    artist_alias: "Example Artist",
    collection_name: "Example Collection",
    editions: 1,
    price_xtz: 600,
    objkt_url: `https://objkt.com/asset/KT1Example/${tokenId}`,
    rarity: "legendary",
    ...overrides,
  };
}

function wishlistFile(cards: NFTCard[]): File {
  return new dom.window.File(
    [JSON.stringify({ version: 1, exported_at: "2026-09-18T12:00:00.000Z", cards })],
    "tzdeck-wishlist-2026-09-18.json",
    { type: "application/json" },
  ) as unknown as File;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input[type=file]");
  assert.ok(input, "expected a file input for importing a wishlist");
  return input as HTMLInputElement;
}

test("the empty wishlist links back to booster packs", async () => {
  const { fireEvent, render, screen, WishlistGrid } = await loadTestHarness();
  let browseCount = 0;

  render(
    <WishlistGrid
      wishlist={[]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => undefined}
      onImport={() => undefined}
      onBrowsePacks={() => {
        browseCount += 1;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Browse Booster Packs" }));

  assert.equal(browseCount, 1);
});

test("an empty wishlist can still import a backup", async () => {
  const { render, screen, WishlistGrid } = await loadTestHarness();

  render(
    <WishlistGrid
      wishlist={[]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => undefined}
      onImport={() => undefined}
      onBrowsePacks={() => undefined}
    />,
  );

  assert.ok(screen.getByRole("button", { name: /import/i }));
});

test("clearing asks first, and does nothing until it's confirmed", async () => {
  const { fireEvent, render, screen, WishlistGrid } = await loadTestHarness();
  let clearCount = 0;

  render(
    <WishlistGrid
      wishlist={[card(), card({ token_id: "1" })]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => {
        clearCount += 1;
      }}
      onImport={() => undefined}
      onBrowsePacks={() => undefined}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Clear Wishlist" }));

  assert.equal(clearCount, 0, "clearing must not happen on the first click");
  assert.ok(screen.getByRole("dialog"));
  // The count is named so the choice is made against the real stake.
  assert.ok(screen.getByText(/2 saved cards/i));

  const { within } = await loadTestHarness();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear Wishlist" }));

  assert.equal(clearCount, 1);
});

test("backing out of the clear prompt leaves the wishlist alone", async () => {
  const { fireEvent, render, screen, WishlistGrid } = await loadTestHarness();
  let clearCount = 0;

  render(
    <WishlistGrid
      wishlist={[card()]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => {
        clearCount += 1;
      }}
      onImport={() => undefined}
      onBrowsePacks={() => undefined}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Clear Wishlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  assert.equal(clearCount, 0);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("exporting downloads the wishlist as a dated JSON file", async () => {
  const { fireEvent, render, screen, WishlistGrid } = await loadTestHarness();
  const saved = [card(), card({ token_id: "1" })];
  let downloadName: string | undefined;
  let downloaded: Blob | undefined;

  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    downloadName = this.download;
    downloaded = objectUrls.get(this.href);
  };

  try {
    render(
      <WishlistGrid
        wishlist={saved}
        onWishlistToggle={() => undefined}
        onClearWishlist={() => undefined}
        onImport={() => undefined}
        onBrowsePacks={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    assert.match(downloadName ?? "", /^tzdeck-wishlist-\d{4}-\d{2}-\d{2}\.json$/);
    const contents = JSON.parse(await (downloaded as Blob).text());
    assert.equal(contents.version, 1);
    assert.deepEqual(contents.cards.map((c: NFTCard) => c.token_id), ["0", "1"]);
  } finally {
    dom.window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("importing merges new cards and hands back current prices", async () => {
  const { fireEvent, render, waitFor, WishlistGrid, objktClient } = await loadTestHarness();
  const originalRequest = objktClient.request;
  let imported: NFTCard[] | undefined;

  objktClient.request = async () => ({
    listing: [
      {
        id: 9,
        price: 5_000_000,
        token: {
          name: "Interference 2",
          token_id: "1",
          fa_contract: "KT1Example",
          display_uri: "ipfs://QmExample",
          artifact_uri: null,
          thumbnail_uri: null,
          supply: 100,
          description: null,
          creators: [{ holder: { alias: "Example Artist", address: "tz1Example" } }],
          fa: { name: "Example Collection" },
        },
      },
    ],
    token: [],
  });

  try {
    const { container } = render(
      <WishlistGrid
        wishlist={[card({ token_id: "0" })]}
        onWishlistToggle={() => undefined}
        onClearWishlist={() => undefined}
        onImport={(cards) => {
          imported = cards;
        }}
        onBrowsePacks={() => undefined}
      />,
    );

    fireEvent.change(fileInput(container), {
      target: { files: [wishlistFile([card({ token_id: "1", price_xtz: 999 })])] },
    });

    await waitFor(() => assert.ok(imported));
    assert.deepEqual(imported?.map((c) => c.token_id), ["0", "1"]);
    // The file claimed 999 XTZ; OBJKT says the listing is 5.
    assert.equal(imported?.[1].price_xtz, 5);
    assert.equal(imported?.[1].rarity, "uncommon");
  } finally {
    objktClient.request = originalRequest;
  }
});

test("re-importing a file you already have says so instead of counting zero", async () => {
  const { fireEvent, render, screen, waitFor, WishlistGrid, objktClient } = await loadTestHarness();
  const originalRequest = objktClient.request;

  objktClient.request = async () => ({ listing: [], token: [] });

  try {
    const { container } = render(
      <WishlistGrid
        wishlist={[card()]}
        onWishlistToggle={() => undefined}
        onClearWishlist={() => undefined}
        onImport={() => undefined}
        onBrowsePacks={() => undefined}
      />,
    );

    fireEvent.change(fileInput(container), { target: { files: [wishlistFile([card()])] } });

    await waitFor(() => assert.ok(screen.getByText(/already saved/i)));
  } finally {
    objktClient.request = originalRequest;
  }
});

test("importing a file that isn't a wishlist reports the problem and changes nothing", async () => {
  const { fireEvent, render, screen, waitFor, WishlistGrid } = await loadTestHarness();
  let importCount = 0;

  const { container } = render(
    <WishlistGrid
      wishlist={[card()]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => undefined}
      onImport={() => {
        importCount += 1;
      }}
      onBrowsePacks={() => undefined}
    />,
  );

  const notJson = new dom.window.File(["this is not json"], "notes.txt", {
    type: "text/plain",
  }) as unknown as File;

  fireEvent.change(fileInput(container), { target: { files: [notJson] } });

  await waitFor(() => assert.ok(screen.getByText(/couldn't be read/i)));
  assert.equal(importCount, 0);
});

test("an unreachable OBJKT still imports, and says the prices may be stale", async () => {
  const { fireEvent, render, screen, waitFor, WishlistGrid, objktClient } = await loadTestHarness();
  const originalRequest = objktClient.request;
  let imported: NFTCard[] | undefined;

  objktClient.request = async () => {
    throw new Error("network down");
  };

  try {
    const { container } = render(
      <WishlistGrid
        wishlist={[]}
        onWishlistToggle={() => undefined}
        onClearWishlist={() => undefined}
        onImport={(cards) => {
          imported = cards;
        }}
        onBrowsePacks={() => undefined}
      />,
    );

    fireEvent.change(fileInput(container), {
      target: { files: [wishlistFile([card({ price_xtz: 600 })])] },
    });

    await waitFor(() => assert.ok(imported));
    assert.equal(imported?.length, 1);
    assert.equal(imported?.[0].price_xtz, 600);
    await waitFor(() => assert.ok(screen.getByText(/couldn't be refreshed/i)));
  } finally {
    objktClient.request = originalRequest;
  }
});
