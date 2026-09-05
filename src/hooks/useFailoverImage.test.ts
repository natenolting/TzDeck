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
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type UseFailoverImageHook = typeof import("./useFailoverImage")["useFailoverImage"];

let testingLibrary: TestingLibrary | undefined;
let useFailoverImage: UseFailoverImageHook | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  useFailoverImage ||= (await import("./useFailoverImage")).useFailoverImage;

  return { ...testingLibrary, useFailoverImage };
}

afterEach(() => {
  testingLibrary?.cleanup();
});

test("a stalled load that never fires error still fails over, once the timeout elapses", async () => {
  const { renderHook, waitFor, useFailoverImage } = await loadTestHarness();
  const sources = ["ipfs://bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy"];

  const { result } = renderHook(() => useFailoverImage(sources, 20));

  assert.equal(
    result.current.imageUrl,
    "https://ipfs.filebase.io/ipfs/bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy",
  );
  assert.equal(result.current.failed, false);

  // No load, no error -- just silence, as a stalled gateway would produce.
  await waitFor(() => {
    assert.equal(
      result.current.imageUrl,
      "https://bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy.ipfs.dweb.link/",
    );
  });
});

test("a load timeout that lands after the image already loaded is a no-op", async () => {
  const { act, renderHook, useFailoverImage } = await loadTestHarness();
  const sources = ["https://example.com/art.jpg"];

  const { result } = renderHook(() => useFailoverImage(sources, 15));

  act(() => {
    result.current.handleLoad();
  });
  assert.equal(result.current.loaded, true);

  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(result.current.loaded, true);
  assert.equal(result.current.failed, false);
  assert.equal(result.current.imageUrl, "https://example.com/art.jpg");
});

test("exhausting every gateway and source without a load or error marks the image failed", async () => {
  const { renderHook, waitFor, useFailoverImage } = await loadTestHarness();
  const sources = ["https://example.com/one.jpg", "https://example.com/two.jpg"];

  const { result } = renderHook(() => useFailoverImage(sources, 10));

  await waitFor(() => {
    assert.equal(result.current.failed, true);
  });
});
