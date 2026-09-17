import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import { type NFTCard } from "@/lib/objkt";

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

let testingLibrary: TestingLibrary | undefined;
let NFTDetailsModal: NFTDetailsModalComponent | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  NFTDetailsModal ||= (await import("./NFTDetailsModal")).default;
  return { ...testingLibrary, NFTDetailsModal };
}

afterEach(() => {
  testingLibrary?.cleanup();
});

function createCard(overrides: Partial<NFTCard> = {}): NFTCard {
  return {
    token_id: "1",
    contract_address: "KT1DetailsModalCollection",
    name: "Modal Fighter",
    artist_alias: "Modal Artist",
    artist_address: "tz1ModalArtist0000000000000000000000",
    collection_name: "Modal Collection",
    objkt_url: "https://objkt.com/asset/KT1DetailsModalCollection/1",
    rarity: "common",
    ...overrides,
  };
}

test("the modal links the title, artist, and collection to their OBJKT pages, each opening in a new tab", async () => {
  const { render, screen, NFTDetailsModal } = await loadTestHarness();
  const card = createCard();

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  const titleLink = screen.getByRole("link", { name: card.name });
  assert.equal(titleLink.getAttribute("href"), card.objkt_url);
  assert.equal(titleLink.getAttribute("target"), "_blank");
  assert.equal(titleLink.getAttribute("rel"), "noopener noreferrer");

  const artistLink = screen.getByRole("link", { name: card.artist_alias });
  assert.equal(artistLink.getAttribute("href"), `https://objkt.com/users/${card.artist_address}`);
  assert.equal(artistLink.getAttribute("target"), "_blank");
  assert.equal(artistLink.getAttribute("rel"), "noopener noreferrer");

  const collectionLink = screen.getByRole("link", { name: card.collection_name });
  assert.equal(collectionLink.getAttribute("href"), `https://objkt.com/collection/${card.contract_address}`);
  assert.equal(collectionLink.getAttribute("target"), "_blank");
  assert.equal(collectionLink.getAttribute("rel"), "noopener noreferrer");
});

test("the artist name renders as plain text, not a link, when the card has no artist address", async () => {
  const { render, screen, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({ artist_address: undefined });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  assert.equal(screen.queryByRole("link", { name: card.artist_alias }), null);
  assert.ok(screen.getByText(card.artist_alias!));
});
