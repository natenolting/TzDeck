import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import type { NFTCard } from "@/lib/objkt";
import { soundManager } from "@/lib/sound";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLImageElement: dom.window.HTMLImageElement,
  SVGElement: dom.window.SVGElement,
  Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type PackOpeningComponent = typeof import("./PackOpening")["default"];

let testingLibrary: TestingLibrary | undefined;
let PackOpening: PackOpeningComponent | undefined;
const originalFetch = globalThis.fetch;
const originalPlayPackRip = soundManager.playPackRip;
const originalPlayCardFlip = soundManager.playCardFlip;
const originalPlayPackComplete = soundManager.playPackComplete;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  PackOpening ||= (await import("./PackOpening")).default;

  return { ...testingLibrary, PackOpening };
}

const cards: NFTCard[] = [
  {
    token_id: "1",
    contract_address: "KT1Pack",
    name: "First Pull",
    display_uri: "https://example.com/first.jpg",
    editions: 100,
    objkt_url: "https://objkt.com/asset/KT1Pack/1",
    rarity: "uncommon",
  },
  {
    token_id: "2",
    contract_address: "KT1Pack",
    name: "Second Pull",
    display_uri: "https://example.com/second.jpg",
    editions: 10,
    objkt_url: "https://objkt.com/asset/KT1Pack/2",
    rarity: "legendary",
  },
];

function mockSuccessfulPackRequest() {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ cards }),
  }) as Response;
}

function mutePackSounds() {
  soundManager.playPackRip = () => undefined;
  soundManager.playCardFlip = () => undefined;
}

async function renderRevealingPack() {
  const { fireEvent, render, screen, PackOpening } = await loadTestHarness();
  mockSuccessfulPackRequest();
  mutePackSounds();
  const rendered = render(<PackOpening />);

  fireEvent.click(screen.getByText("Click to Rip Open"));
  await screen.findByText(
    "Click on each card to reveal your pull",
    undefined,
    { timeout: 2_500 },
  );

  return { ...rendered, fireEvent, screen };
}

afterEach(() => {
  testingLibrary?.cleanup();
  globalThis.fetch = originalFetch;
  soundManager.playPackRip = originalPlayPackRip;
  soundManager.playCardFlip = originalPlayCardFlip;
  soundManager.playPackComplete = originalPlayPackComplete;
});

test("opening a pack ignores rapid duplicate clicks", async () => {
  const { act, render, screen, PackOpening } = await loadTestHarness();
  let requestCount = 0;
  globalThis.fetch = (() => {
    requestCount += 1;
    return new Promise<Response>(() => undefined);
  }) as typeof fetch;
  mutePackSounds();
  render(<PackOpening />);
  const packPrompt = screen.getByText("Click to Rip Open");

  act(() => {
    packPrompt.click();
    packPrompt.click();
  });

  assert.equal(requestCount, 1);
});

test("unmounting clears a pending pack completion timer", async () => {
  let completionCount = 0;
  soundManager.playPackComplete = () => {
    completionCount += 1;
  };
  const { fireEvent, screen, unmount } = await renderRevealingPack();

  for (const revealPrompt of screen.getAllByText("Click to Reveal")) {
    fireEvent.click(revealPrompt);
  }
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 650));

  assert.equal(completionCount, 0);
});

test("Reveal All cancels a pending completion callback", async () => {
  let completionCount = 0;
  soundManager.playPackComplete = () => {
    completionCount += 1;
  };
  const { fireEvent, screen } = await renderRevealingPack();

  for (const revealPrompt of screen.getAllByText("Click to Reveal")) {
    fireEvent.click(revealPrompt);
  }
  fireEvent.click(screen.getByRole("button", { name: "Reveal All" }));
  await new Promise((resolve) => setTimeout(resolve, 650));

  assert.equal(completionCount, 1);
});

test("resetting a pack clears a pending completion timer", async () => {
  let completionCount = 0;
  soundManager.playPackComplete = () => {
    completionCount += 1;
  };
  const { fireEvent, screen } = await renderRevealingPack();

  for (const revealPrompt of screen.getAllByText("Click to Reveal")) {
    fireEvent.click(revealPrompt);
  }
  fireEvent.click(screen.getByRole("button", { name: "Open Another Pack" }));
  await new Promise((resolve) => setTimeout(resolve, 650));

  assert.equal(completionCount, 0);
  assert.ok(screen.getByText("Click to Rip Open"));
});

test("pack completion keeps rare-pull emphasis on the cards", async () => {
  const { fireEvent, screen } = await renderRevealingPack();

  fireEvent.click(screen.getByRole("button", { name: "Reveal All" }));

  assert.ok(screen.getByText("Legendary"));
  assert.equal(screen.queryByText(/Outstanding Pull/), null);
});
