import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import type { NFTCard as NFTCardType } from "@/lib/objkt";

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
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type UserEvent = typeof import("@testing-library/user-event")["default"];
type NFTCardComponent = typeof import("./NFTCard")["default"];

let testingLibrary: TestingLibrary | undefined;
let userEvent: UserEvent | undefined;
let NFTCard: NFTCardComponent | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  userEvent ||= (await import("@testing-library/user-event")).default;
  NFTCard ||= (await import("./NFTCard")).default;

  return {
    ...testingLibrary,
    userEvent,
    NFTCard,
  };
}

const card: NFTCardType = {
  token_id: "42",
  contract_address: "KT1ExampleContract",
  name: "The Cosmic Hourglass",
  description: "An ancient hourglass containing an entire universe.",
  display_uri: "https://example.com/hourglass.jpg",
  artifact_uri: "https://example.com/hourglass-full.jpg",
  artist_alias: "Zyren",
  artist_address: "tz1ExampleArtist",
  collection_name: "Open OBJKT",
  editions: 3,
  price_xtz: 25,
  objkt_url: "https://objkt.com/asset/KT1ExampleContract/42",
  rarity: "epic",
  quantity_owned: 2,
};

afterEach(() => {
  testingLibrary?.cleanup();
  document.body.style.overflow = "";
});

test("clicking visible card artwork opens a modal with token information", async () => {
  const { fireEvent, render, screen, userEvent, NFTCard, within } = await loadTestHarness();
  const user = userEvent.setup({ document });
  let toggledCard: NFTCardType | undefined;
  render(
    <NFTCard
      card={card}
      isWishlisted
      onToggleWishlist={(selectedCard) => {
        toggledCard = selectedCard;
      }}
    />,
  );

  const thumbnail = screen.getByRole("img", { name: card.name });
  fireEvent.load(thumbnail);
  await user.click(
    screen.getByRole("button", { name: `View details for ${card.name}` }),
  );

  const dialog = screen.getByRole("dialog", { name: card.name });
  const modal = within(dialog);
  assert.ok(dialog);
  assert.ok(modal.getByText(card.description!));
  assert.ok(modal.getByText("Zyren"));
  assert.ok(modal.getByText("Open OBJKT"));
  assert.ok(modal.getByText("Epic"));
  assert.ok(modal.getByText("Editions"));
  assert.ok(modal.getByText("3"));
  assert.ok(modal.getByText("Listed Price"));
  assert.ok(modal.getByText("ꜩ 25"));
  assert.ok(modal.getByText("Owned"));
  assert.ok(modal.getByText("2"));
  assert.ok(modal.getByText("KT1ExampleContract"));
  assert.ok(modal.getByText("42"));
  const enlargedArtwork = modal.getByRole("img", { name: card.name });
  assert.equal(enlargedArtwork.getAttribute("src"), card.display_uri);
  const objktLink = modal.getByRole("link", { name: "Collect on OBJKT" });
  assert.equal(objktLink.getAttribute("href"), card.objkt_url);
  assert.equal(objktLink.getAttribute("target"), "_blank");
  assert.equal(objktLink.getAttribute("rel"), "noopener noreferrer");
  await user.click(modal.getByRole("button", { name: "Remove from Wishlist" }));
  assert.equal(toggledCard, card);
  assert.equal(screen.getByTestId("nft-details-backdrop").parentElement, document.body);
  assert.equal(document.body.style.overflow, "hidden");
});

test("Escape and backdrop clicks close the token modal", async () => {
  const { fireEvent, render, screen, userEvent, NFTCard } = await loadTestHarness();
  const user = userEvent.setup({ document });
  render(<NFTCard card={card} />);

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  const openButton = screen.getByRole("button", {
    name: `View details for ${card.name}`,
  });

  await user.click(openButton);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog"), null);

  await user.click(openButton);
  await user.click(screen.getByTestId("nft-details-backdrop"));
  assert.equal(screen.queryByRole("dialog"), null);

  await user.click(openButton);
  await user.click(screen.getByRole("button", { name: "Close token details" }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.body.style.overflow, "");
});

test("facedown cards do not expose the token-details interaction", async () => {
  const { render, screen, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} isFacedown />);

  assert.equal(
    screen.queryByRole("button", { name: `View details for ${card.name}` }),
    null,
  );
  assert.equal(screen.queryByRole("dialog"), null);
});

test("the modal traps keyboard focus and restores the page after closing", async () => {
  const { fireEvent, render, screen, userEvent, NFTCard, within } = await loadTestHarness();
  const user = userEvent.setup({ document });
  const { container } = render(
    <NFTCard card={card} onToggleWishlist={() => undefined} />,
  );

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  const openButton = screen.getByRole("button", {
    name: `View details for ${card.name}`,
  });
  await user.click(openButton);

  const dialog = screen.getByRole("dialog", { name: card.name });
  const modal = within(dialog);
  const closeButton = modal.getByRole("button", { name: "Close token details" });
  const wishlistButton = modal.getByRole("button", { name: "Add to Wishlist" });
  const objktLink = modal.getByRole("link", { name: "Collect on OBJKT" });

  assert.equal(document.activeElement, closeButton);
  assert.equal((container as HTMLElement & { inert?: boolean }).inert, true);
  assert.equal(container.getAttribute("aria-hidden"), "true");

  await user.tab();
  assert.equal(document.activeElement, wishlistButton);
  await user.tab();
  assert.equal(document.activeElement, objktLink);
  await user.tab();
  assert.equal(document.activeElement, closeButton);
  await user.tab({ shift: true });
  assert.equal(document.activeElement, objktLink);

  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(document.activeElement, openButton);
  assert.equal(document.body.style.overflow, "");
  assert.equal((container as HTMLElement & { inert?: boolean }).inert, false);
  assert.equal(container.hasAttribute("aria-hidden"), false);
});

test("an unavailable card image cannot open token details", async () => {
  const { fireEvent, render, screen, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} />);

  fireEvent.error(screen.getByRole("img", { name: card.name }));
  fireEvent.error(screen.getByRole("img", { name: card.name }));

  assert.equal(
    screen.queryByRole("button", { name: `View details for ${card.name}` }),
    null,
  );
  assert.ok(screen.getByText("Media unavailable"));
  assert.equal(screen.queryByRole("dialog"), null);
});
