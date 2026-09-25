import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import { getCardKey, type NFTCard as NFTCardType } from "@/lib/objkt";
import { calculateDeckStats } from "./DeckGrid";

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
type WalletContextModule = typeof import("@/context/WalletContext");
type DeckGridComponent = typeof import("./DeckGrid")["default"];

let testingLibrary: TestingLibrary | undefined;
let walletContextModule: WalletContextModule | undefined;
let DeckGrid: DeckGridComponent | undefined;
const originalFetch = globalThis.fetch;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  walletContextModule ||= await import("@/context/WalletContext");
  DeckGrid ||= (await import("./DeckGrid")).default;
  return { ...testingLibrary, WalletContext: walletContextModule.WalletContext, DeckGrid };
}

function mockWalletValue() {
  return {
    address: "tz1DeckGridWallet0000000000000000000",
    connect: async () => undefined,
    disconnect: async () => undefined,
    tezos: null,
    signChallenge: async () => ({
      envelope: { timestamp: Date.now(), random: "r", mac: "m" },
      publicKey: "edpkTestPublicKey",
      signature: "edsigTestSignature",
      address: "tz1DeckGridWallet0000000000000000000",
    }),
  };
}

afterEach(() => {
  testingLibrary?.cleanup();
  globalThis.fetch = originalFetch;
});

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

function createCard(overrides: Partial<NFTCardType>): NFTCardType {
  return {
    token_id: "1",
    contract_address: "KT1Deck",
    name: "Deck Card",
    objkt_url: "https://objkt.com/asset/KT1Deck/1",
    rarity: "common",
    ...overrides,
  };
}

test("DeckGrid fetches each card's battle status and threads it into that card's details modal", async () => {
  const { fireEvent, render, screen, within, WalletContext, DeckGrid } = await loadTestHarness();
  const token = createCard({
    token_id: "7",
    contract_address: "KT1DeckCard",
    name: "Deck Fighter",
    display_uri: "https://example.com/deck-fighter.jpg",
    editions: 4,
  });
  const cardKey = getCardKey(token);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/deck")) {
      return new Response(JSON.stringify({ tokens: [token] }), { status: 200 });
    }
    if (url.includes("/api/battle/status")) {
      return new Response(
        JSON.stringify({
          optedIn: true,
          effectiveAttackCount: 0,
          attackResetAt: null,
          effectiveDefenseCount: 0,
          defenseResetAt: null,
          holdingsRefreshedAt: null,
          cards: [{ cardKey, xp: 250, level: 3, power: 45, hp: 120, recoveryUntil: null, recoveryReason: null }],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in DeckGrid test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <DeckGrid onBrowsePacks={() => {}} />
    </WalletContext.Provider>,
  );

  const openButton = await screen.findByRole("button", { name: `View details for ${token.name}` });
  fireEvent.load(screen.getByRole("img", { name: token.name }));
  fireEvent.click(openButton);

  const modal = within(screen.getByRole("dialog", { name: token.name }));
  assert.ok(await modal.findByText("Level 3"), "the real battle stats fetched for this wallet reach the card's details modal");
});

test("a deck card with no battle progress row shows the estimated Level 1 preview, not real stats", async () => {
  const { fireEvent, render, screen, within, WalletContext, DeckGrid } = await loadTestHarness();
  const token = createCard({
    token_id: "8",
    contract_address: "KT1DeckCardUnbattled",
    name: "Unbattled Card",
    display_uri: "https://example.com/unbattled.jpg",
    editions: 4,
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/deck")) {
      return new Response(JSON.stringify({ tokens: [token] }), { status: 200 });
    }
    if (url.includes("/api/battle/status")) {
      return new Response(
        JSON.stringify({
          optedIn: false,
          effectiveAttackCount: 0,
          attackResetAt: null,
          effectiveDefenseCount: 0,
          defenseResetAt: null,
          holdingsRefreshedAt: null,
          cards: [],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in DeckGrid test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <DeckGrid onBrowsePacks={() => {}} />
    </WalletContext.Provider>,
  );

  const openButton = await screen.findByRole("button", { name: `View details for ${token.name}` });
  fireEvent.load(screen.getByRole("img", { name: token.name }));
  fireEvent.click(openButton);

  const modal = within(screen.getByRole("dialog", { name: token.name }));
  assert.ok(await modal.findByText("Estimated Level 1"));
});

test("a battle fought from the deck updates the card's details, and opening the panel costs no status request", async () => {
  const { fireEvent, render, screen, within, WalletContext, DeckGrid } = await loadTestHarness();
  const token = createCard({
    token_id: "9",
    contract_address: "KT1DeckCardFresh",
    name: "Fresh Fighter",
    display_uri: "https://example.com/fresh-fighter.jpg",
    editions: 4,
  });
  const cardKey = getCardKey(token);
  let serverCards: Array<Record<string, unknown>> = [];
  let statusRequests = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/deck")) {
      return new Response(JSON.stringify({ tokens: [token] }), { status: 200 });
    }
    if (url.includes("/api/battle/trainer")) {
      serverCards = [{ cardKey, xp: 40, level: 2, power: 30, hp: 100, recoveryUntil: null, recoveryReason: null }];
      return new Response(
        JSON.stringify({
          outcome: "win",
          winner: "attacker",
          xpAwarded: 40,
          trainerTier: "common",
          attackerStats: { power: 30, hp: 100 },
          defenderStats: { power: 20, hp: 80 },
          combat: { rounds: 0, finalHpA: 100, finalHpB: 0, history: [] },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/battle/status")) {
      statusRequests += 1;
      return new Response(
        JSON.stringify({
          optedIn: true,
          effectiveAttackCount: 0,
          attackResetAt: null,
          effectiveDefenseCount: 0,
          defenseResetAt: null,
          holdingsRefreshedAt: null,
          cards: serverCards,
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in DeckGrid test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <DeckGrid onBrowsePacks={() => {}} />
    </WalletContext.Provider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: `Battle with ${token.name}` }));
  fireEvent.click(await screen.findByRole("button", { name: "Train" }));
  assert.equal(statusRequests, 1, "the panel reuses the status My Deck already loaded");

  fireEvent.click(screen.getByRole("button", { name: "Battle!" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close battle panel" }));
  assert.equal(statusRequests, 2, "the settled battle refreshed status once");

  const openButton = screen.getByRole("button", { name: `View details for ${token.name}` });
  fireEvent.load(screen.getByRole("img", { name: token.name }));
  fireEvent.click(openButton);

  const modal = within(screen.getByRole("dialog", { name: token.name }));
  assert.ok(await modal.findByText("Level 2"), "the stats written by the battle reach the modal once the panel closes");
});

test("a battle status that failed with the deck is retried when the battle panel opens", async () => {
  const { fireEvent, render, screen, WalletContext, DeckGrid } = await loadTestHarness();
  const token = createCard({
    token_id: "10",
    contract_address: "KT1DeckCardRetry",
    name: "Second Wind",
    display_uri: "https://example.com/second-wind.jpg",
    editions: 4,
  });
  let statusRequests = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/deck")) {
      return new Response(JSON.stringify({ tokens: [token] }), { status: 200 });
    }
    if (url.includes("/api/battle/status")) {
      statusRequests += 1;
      if (statusRequests === 1) return new Response(JSON.stringify({ error: "status_unavailable" }), { status: 500 });
      return new Response(
        JSON.stringify({
          optedIn: false,
          effectiveAttackCount: 0,
          attackResetAt: null,
          effectiveDefenseCount: 0,
          defenseResetAt: null,
          holdingsRefreshedAt: null,
          cards: [],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in DeckGrid test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <DeckGrid onBrowsePacks={() => {}} />
    </WalletContext.Provider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: `Battle with ${token.name}` }));

  assert.ok(await screen.findByRole("button", { name: "Train" }), "the retried status opens the battle controls");
  assert.equal(screen.queryByText("Battles are temporarily unavailable."), null);
  assert.equal(statusRequests, 2);
});
