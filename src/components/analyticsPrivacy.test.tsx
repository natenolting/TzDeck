import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import { trackFunnelEvent } from "@/lib/analytics";
import type { NFTCard } from "@/lib/card";
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
type NFTDetailsModalComponent = typeof import("./NFTDetailsModal")["default"];
type ShareCardButtonComponent = typeof import("./ShareCardButton")["default"];
type PackOpeningComponent = typeof import("./PackOpening")["default"];
type DemoBattleComponent = typeof import("./DemoBattle")["default"];

let testingLibrary: TestingLibrary | undefined;
let NFTDetailsModal: NFTDetailsModalComponent | undefined;
let ShareCardButton: ShareCardButtonComponent | undefined;
let PackOpening: PackOpeningComponent | undefined;
let DemoBattle: DemoBattleComponent | undefined;

const originalFetch = globalThis.fetch;
const originalPlayPackRip = soundManager.playPackRip;
const originalPlayCardFlip = soundManager.playCardFlip;
const originalPlayPackComplete = soundManager.playPackComplete;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  NFTDetailsModal ||= (await import("./NFTDetailsModal")).default;
  ShareCardButton ||= (await import("./ShareCardButton")).default;
  PackOpening ||= (await import("./PackOpening")).default;
  DemoBattle ||= (await import("./DemoBattle")).default;
  return { ...testingLibrary, NFTDetailsModal, ShareCardButton, PackOpening, DemoBattle };
}

/**
 * Anything a wallet address, a contract address, a token id or a card key
 * could be spelled as in this test's fixtures. Issue #73 forbids all of them
 * from reaching Vercel Analytics.
 */
const FORBIDDEN = [
  "KT1FORBIDDENCONTRACT",
  "987654321",
  "KT1FORBIDDENCONTRACT:987654321",
  "tz1FORBIDDENWALLET",
  "tz1FORBIDDENARTIST",
];

/**
 * The vendor's own seam. `track` ends by calling `window.va("event", ...)`,
 * and nothing in jsdom defines `window.va`, so this recorder sees exactly the
 * payload a browser would put on the wire. Production code gets no test hook.
 *
 * `options` is the vendor's third argument, always present and always
 * undefined here, so every expected payload below carries it too.
 */
function recordEvents(): unknown[][] {
  const recorded: unknown[][] = [];
  Object.defineProperty(globalThis.window, "va", {
    configurable: true,
    value: (...params: unknown[]) => { recorded.push(params); },
  });
  return recorded;
}

function createCard(overrides: Partial<NFTCard> = {}): NFTCard {
  return {
    token_id: "987654321",
    contract_address: "KT1FORBIDDENCONTRACT",
    name: "Forbidden Fighter",
    artist_alias: "Forbidden Artist",
    artist_address: "tz1FORBIDDENARTIST",
    collection_name: "Forbidden Collection",
    objkt_url: "https://objkt.com/asset/KT1FORBIDDENCONTRACT/987654321",
    rarity: "rare",
    ...overrides,
  };
}

function stubClipboard(options: { denied?: boolean; legacyCopyWorks?: boolean } = {}) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        if (options.denied) throw new DOMException("denied", "NotAllowedError");
      },
    },
  });
  Object.defineProperty(globalThis.document, "execCommand", {
    configurable: true,
    value: (command: string) => command === "copy" && options.legacyCopyWorks === true,
  });
}

function stubShareSheet(behaviour: "resolves" | "aborts") {
  Object.defineProperty(globalThis.navigator, "share", {
    configurable: true,
    value: async () => {
      if (behaviour === "aborts") throw new DOMException("dismissed", "AbortError");
    },
  });
}

function stubPackRequest(cards: NFTCard[]) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ cards }),
  })) as unknown as typeof fetch;
  soundManager.playPackRip = () => undefined;
  soundManager.playCardFlip = () => undefined;
}

async function openAPack(cards: NFTCard[]) {
  const { fireEvent, render, screen, PackOpening } = await loadTestHarness();
  stubPackRequest(cards);
  render(<PackOpening />);
  fireEvent.click(screen.getByText("Rip it open"));
  await screen.findByText("Reveal each card to see your pull", undefined, {
    timeout: 2_500,
  });
}

afterEach(() => {
  testingLibrary?.cleanup();
  Reflect.deleteProperty(globalThis.window, "va");
  Reflect.deleteProperty(globalThis.navigator, "share");
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  globalThis.fetch = originalFetch;
  soundManager.playPackRip = originalPlayPackRip;
  soundManager.playCardFlip = originalPlayCardFlip;
  soundManager.playPackComplete = originalPlayPackComplete;
});

test("opening the details modal sends one card_inspected carrying nothing but the rarity", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const recorded = recordEvents();

  render(<NFTDetailsModal card={createCard()} isWishlisted={false} onClose={() => {}} />);

  assert.deepStrictEqual(recorded, [
    ["event", { name: "card_inspected", data: { rarity: "rare" }, options: undefined }],
  ]);
});

test("scrubbing through the deck with the arrows still sends only the one card_inspected", async () => {
  const { fireEvent, render, screen, NFTDetailsModal } = await loadTestHarness();
  const first = createCard();
  const second = createCard({ token_id: "987654322", rarity: "legendary" });
  const recorded = recordEvents();

  render(
    <NFTDetailsModal
      card={first}
      isWishlisted={false}
      navigationCards={[first, second]}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /next/i }));

  assert.deepStrictEqual(recorded, [
    ["event", { name: "card_inspected", data: { rarity: "rare" }, options: undefined }],
  ]);
});

test("each of the three share paths sends one card_shared carrying nothing but the rarity", async () => {
  const expected = [
    ["event", { name: "card_shared", data: { rarity: "rare" }, options: undefined }],
  ];

  for (const path of ["share sheet", "clipboard", "legacy copy"] as const) {
    const { act, fireEvent, render, screen, ShareCardButton, cleanup } = await loadTestHarness();
    if (path === "share sheet") stubShareSheet("resolves");
    stubClipboard({ denied: path === "legacy copy", legacyCopyWorks: path === "legacy copy" });
    const recorded = recordEvents();

    render(<ShareCardButton card={createCard()} variant="icon" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share/i }));
    });

    assert.deepStrictEqual(recorded, expected, `the ${path} path`);
    cleanup();
    Reflect.deleteProperty(globalThis.navigator, "share");
  }
});

test("a dismissed share sheet and a blocked clipboard send nothing", async () => {
  const { act, fireEvent, render, screen, ShareCardButton, cleanup } = await loadTestHarness();

  stubShareSheet("aborts");
  stubClipboard();
  let recorded = recordEvents();
  render(<ShareCardButton card={createCard()} variant="icon" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
  });
  assert.deepStrictEqual(recorded, [], "a dismissed share sheet is a decision, not a share");

  cleanup();
  Reflect.deleteProperty(globalThis.navigator, "share");
  stubClipboard({ denied: true, legacyCopyWorks: false });
  recorded = recordEvents();
  render(<ShareCardButton card={createCard()} variant="icon" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
  });
  assert.deepStrictEqual(recorded, [], "nothing reached the clipboard, so nothing was shared");
});

test("opening a pack sends one pack_opened carrying nothing but the count", async () => {
  const recorded = recordEvents();

  await openAPack([createCard(), createCard({ token_id: "987654322" })]);

  assert.deepStrictEqual(recorded, [
    ["event", { name: "pack_opened", data: { packSize: 2 }, options: undefined }],
  ]);
});

test("a demo battle sends one demo_battle_started, then one demo_battle_replayed per Replay, each carrying nothing but its source", async () => {
  const { fireEvent, render, screen, DemoBattle } = await loadTestHarness();
  const recorded = recordEvents();

  render(<DemoBattle card={createCard({ editions: 50 })} source="pack" initialSeed={1} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Replay" }, { timeout: 15_000 }));
  fireEvent.click(await screen.findByRole("button", { name: "Replay" }, { timeout: 15_000 }));

  assert.deepStrictEqual(recorded, [
    ["event", { name: "demo_battle_started", data: { source: "pack" }, options: undefined }],
    ["event", { name: "demo_battle_replayed", data: { source: "pack" }, options: undefined }],
    ["event", { name: "demo_battle_replayed", data: { source: "pack" }, options: undefined }],
  ]);
});

test("the two wallet events send no data at all", () => {
  const recorded = recordEvents();

  trackFunnelEvent({ name: "wallet_connect_started" });
  trackFunnelEvent({ name: "wallet_connected" });

  assert.deepStrictEqual(recorded, [
    ["event", { name: "wallet_connect_started", options: undefined }],
    ["event", { name: "wallet_connected", options: undefined }],
  ]);
  for (const [, payload] of recorded) {
    assert.equal(
      "data" in (payload as object),
      false,
      "a wallet event must carry no property bag, so there is nowhere for an address to travel",
    );
  }
});

test("nothing the whole funnel sends contains a wallet address, a contract address, a token id or a card key", async () => {
  const { act, fireEvent, render, screen, NFTDetailsModal, ShareCardButton, DemoBattle } = await loadTestHarness();
  const card = createCard();
  const recorded = recordEvents();

  render(<NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />);
  stubClipboard();
  render(<ShareCardButton card={card} variant="corner" />);
  await act(async () => {
    for (const button of screen.getAllByRole("button", { name: /share/i })) {
      fireEvent.click(button);
    }
  });
  await openAPack([card, createCard({ token_id: "987654322" })]);
  render(<DemoBattle card={card} source="pack" initialSeed={1} onClose={() => {}} />);
  trackFunnelEvent({ name: "wallet_connect_started" });
  trackFunnelEvent({ name: "wallet_connected" });

  assert.ok(recorded.length > 0, "the drive-through recorded no events at all, so it proved nothing");
  const sent = JSON.stringify(recorded);
  for (const literal of FORBIDDEN) {
    assert.equal(
      sent.includes(literal),
      false,
      `${literal} reached Vercel Analytics. Issue #73 forbids any wallet address, contract address, token id or card key leaving the app; wallet-level truth belongs in Postgres, read by npm run funnel. Sent: ${sent}`,
    );
  }
});
