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
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type WishlistGridComponent = typeof import("./WishlistGrid")["default"];

let testingLibrary: TestingLibrary | undefined;
let WishlistGrid: WishlistGridComponent | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  WishlistGrid ||= (await import("./WishlistGrid")).default;
  return { ...testingLibrary, WishlistGrid };
}

afterEach(() => testingLibrary?.cleanup());

test("the empty wishlist links back to booster packs", async () => {
  const { fireEvent, render, screen, WishlistGrid } = await loadTestHarness();
  let browseCount = 0;

  render(
    <WishlistGrid
      wishlist={[]}
      onWishlistToggle={() => undefined}
      onClearWishlist={() => undefined}
      onBrowsePacks={() => {
        browseCount += 1;
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Browse Booster Packs" }));

  assert.equal(browseCount, 1);
});
