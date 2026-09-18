import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import { getCardKey, type NFTCard as NFTCardType } from "@/lib/objkt";
import { baseStatsFromSeed, deriveBaseSeed, xpThresholdForLevel } from "@/lib/battle/rules";
import type { BattleCardStats } from "./NFTDetailsModal";

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
  thumbnail_uri: "https://example.com/hourglass-thumbnail.jpg",
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

const secondCard: NFTCardType = {
  ...card,
  token_id: "43",
  name: "Neon Horizon",
  display_uri: "https://example.com/neon-horizon.jpg",
  rarity: "rare",
};

const thirdCard: NFTCardType = {
  ...card,
  token_id: "44",
  name: "Last Light",
  display_uri: "https://example.com/last-light.jpg",
  rarity: "legendary",
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
  assert.equal(thumbnail.getAttribute("src"), card.thumbnail_uri);
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

test("a token thumbnail uses the deck spinner until its artwork loads", async () => {
  const { fireEvent, render, screen, NFTCard } = await loadTestHarness();
  const { container } = render(<NFTCard card={card} />);

  assert.ok(container.querySelector(".animate-spin"));

  fireEvent.load(screen.getByRole("img", { name: card.name }));

  assert.equal(container.querySelector(".animate-spin"), null);
});

test("the detail modal retries gateways and then falls back to the thumbnail", async () => {
  const { fireEvent, render, screen, NFTCard, within } = await loadTestHarness();
  const displayCid = "bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy";
  const thumbnailCid = "bafkreia2w3ie24d3twcuwa3isp2d627b7gb6eg6o7apsh5lt7bsdkzyzxe";
  const ipfsCard = {
    ...card,
    display_uri: `ipfs://${displayCid}`,
    thumbnail_uri: `ipfs://${thumbnailCid}`,
    artifact_uri: undefined,
  };

  render(<NFTCard card={ipfsCard} />);
  const cardArtwork = screen.getByRole("img", { name: ipfsCard.name });
  fireEvent.load(cardArtwork);
  fireEvent.click(
    screen.getByRole("button", { name: `View details for ${ipfsCard.name}` }),
  );

  const modal = within(screen.getByRole("dialog", { name: ipfsCard.name }));
  let modalArtwork = modal.getByRole("img", { name: ipfsCard.name });
  assert.equal(
    modalArtwork.getAttribute("src"),
    `https://ipfs.filebase.io/ipfs/${displayCid}`,
  );
  assert.ok(modal.getByRole("status", { name: "Loading token artwork" }));

  fireEvent.error(modalArtwork);
  modalArtwork = modal.getByRole("img", { name: ipfsCard.name });
  assert.equal(
    modalArtwork.getAttribute("src"),
    `https://${displayCid}.ipfs.dweb.link/`,
  );

  fireEvent.error(modalArtwork);
  modalArtwork = modal.getByRole("img", { name: ipfsCard.name });
  assert.equal(
    modalArtwork.getAttribute("src"),
    `https://ipfs.filebase.io/ipfs/${thumbnailCid}`,
  );

  fireEvent.load(modalArtwork);
  assert.equal(
    modal.queryByRole("status", { name: "Loading token artwork" }),
    null,
  );
});

test("card details navigate within the supplied card order", async () => {
  const { fireEvent, render, screen, NFTCard, within } = await loadTestHarness();
  render(
    <NFTCard
      card={card}
      detailCards={[card, secondCard, thirdCard]}
      detailWishlistIds={new Set([`${secondCard.contract_address}:${secondCard.token_id}`])}
      onToggleWishlist={() => undefined}
    />,
  );

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(
    screen.getByRole("button", { name: `View details for ${card.name}` }),
  );

  let modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.equal(modal.queryByRole("button", { name: "View previous card" }), null);
  fireEvent.click(modal.getByRole("button", { name: "View next card" }));

  modal = within(screen.getByRole("dialog", { name: secondCard.name }));
  assert.ok(modal.getByRole("button", { name: "View previous card" }));
  assert.ok(modal.getByRole("button", { name: "View next card" }));
  assert.ok(modal.getByRole("button", { name: "Remove from Wishlist" }));
  fireEvent.click(modal.getByRole("button", { name: "View next card" }));

  modal = within(screen.getByRole("dialog", { name: thirdCard.name }));
  assert.ok(modal.getByRole("button", { name: "View previous card" }));
  assert.equal(modal.queryByRole("button", { name: "View next card" }), null);
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

  assert.ok(screen.getByRole("img", { name: "TzDeck shield" }));
  assert.equal(screen.queryByText("TZDECK"), null);
  assert.equal(
    screen.getByText("Click to Reveal").classList.contains("animate-pulse"),
    false,
  );
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
  const titleLink = modal.getByRole("link", { name: card.name });
  const artistLink = modal.getByRole("link", { name: card.artist_alias! });
  const collectionLink = modal.getByRole("link", { name: card.collection_name! });
  const wishlistButton = modal.getByRole("button", { name: "Add to Wishlist" });
  const objktLink = modal.getByRole("link", { name: "Collect on OBJKT" });

  assert.equal(document.activeElement, closeButton);
  assert.notEqual((container as HTMLElement & { inert?: boolean }).inert, true);
  assert.equal(container.hasAttribute("aria-hidden"), false);

  await user.tab();
  assert.equal(document.activeElement, titleLink);
  await user.tab();
  assert.equal(document.activeElement, artistLink);
  await user.tab();
  assert.equal(document.activeElement, collectionLink);
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
  assert.notEqual((container as HTMLElement & { inert?: boolean }).inert, true);
  assert.equal(container.hasAttribute("aria-hidden"), false);
});

test("a card whose preview never loads can still be opened", async () => {
  // The preview and the token are different things. A video token's poster is
  // often the heaviest thing on the card, and losing it used to make the token
  // unreachable -- you could never open the modal that plays it.
  const { fireEvent, render, screen, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} />);

  fireEvent.error(screen.getByRole("img", { name: card.name }));
  fireEvent.error(screen.getByRole("img", { name: card.name }));
  fireEvent.error(screen.getByRole("img", { name: card.name }));

  assert.ok(screen.getByText("Media unavailable"), "the placeholder still shows");

  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  assert.ok(screen.getByRole("dialog"));
});

test("a card can be opened while its preview is still loading", async () => {
  const { fireEvent, render, screen, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} />);

  // No load event fired: the spinner is still up.
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  assert.ok(screen.getByRole("dialog"));
});

test("card pointer movement updates foil position through CSS variables", async () => {
  const { fireEvent, render, NFTCard } = await loadTestHarness();
  const { container } = render(<NFTCard card={card} />);
  const cardElement = container.firstElementChild as HTMLDivElement;
  cardElement.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 110,
    bottom: 220,
    width: 100,
    height: 200,
    toJSON: () => ({}),
  });

  fireEvent.mouseMove(cardElement, { clientX: 35, clientY: 120 });

  assert.equal(cardElement.style.getPropertyValue("--foil-x"), "25%");
  assert.equal(cardElement.style.getPropertyValue("--foil-y"), "50%");
});

test("a battle control sits with the wishlist button and calls onBattle", async () => {
  const { render, screen, userEvent, NFTCard } = await loadTestHarness();
  const user = userEvent.setup({ document });
  let battled: NFTCardType | undefined;
  render(
    <NFTCard
      card={card}
      onToggleWishlist={() => undefined}
      onBattle={(selectedCard) => {
        battled = selectedCard;
      }}
    />,
  );

  const battleButton = screen.getByRole("button", { name: `Battle with ${card.name}` });
  const wishlistButton = screen.getByRole("button", { name: "Add to wishlist" });
  assert.equal(battleButton.nextElementSibling, wishlistButton);
  await user.click(battleButton);
  assert.equal(battled, card);
  assert.equal(screen.queryByRole("dialog"), null);
});

test("cards omit the battle control when onBattle is not passed", async () => {
  const { render, screen, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} onToggleWishlist={() => undefined} />);

  assert.equal(screen.queryByRole("button", { name: `Battle with ${card.name}` }), null);
  assert.ok(screen.getByRole("button", { name: "Add to wishlist" }));
});

test("the details modal shows real battle stats when the card has already battled", async () => {
  const { fireEvent, render, screen, within, NFTCard } = await loadTestHarness();
  const battleStatsByCardKey = new Map<string, BattleCardStats>([
    [getCardKey(card), { xp: 1300, level: 5, power: 84, hp: 165 }],
  ]);

  render(<NFTCard card={card} battleStatsByCardKey={battleStatsByCardKey} />);

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  const modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.ok(modal.getByText("Level 5"));
  assert.ok(modal.getByText("Power"));
  assert.ok(modal.getByText("84"));
  assert.ok(modal.getByText("HP"));
  assert.ok(modal.getByText("165"));
  assert.ok(modal.getByText(`1300 / ${xpThresholdForLevel(6)} XP`));
  assert.equal(modal.queryByText(/Estimated/), null, "a card with real progress must not show the never-battled estimate");
});

test("the details modal shows an estimated Level 1 preview for a card that has never battled", async () => {
  const { fireEvent, render, screen, within, NFTCard } = await loadTestHarness();

  render(<NFTCard card={card} battleStatsByCardKey={new Map()} />);

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  const modal = within(screen.getByRole("dialog", { name: card.name }));
  const expected = baseStatsFromSeed(deriveBaseSeed(card.editions!, card.description));
  assert.ok(modal.getByText("Estimated Level 1"));
  assert.ok(modal.getByText(String(expected.power)));
  assert.ok(modal.getByText(String(expected.hp)));
  assert.ok(modal.getByText(`0 / ${xpThresholdForLevel(2)} XP`));
  assert.ok(modal.getByText(/never battled/i));
});

test("battle stats follow modal navigation between cards instead of staying pinned to the card that opened it", async () => {
  const { fireEvent, render, screen, within, NFTCard } = await loadTestHarness();
  const battleStatsByCardKey = new Map<string, BattleCardStats>([
    [getCardKey(card), { xp: 1300, level: 5, power: 84, hp: 165 }],
    [getCardKey(thirdCard), { xp: 4200, level: 8, power: 96, hp: 210 }],
    // secondCard intentionally has no entry: never battled.
  ]);

  render(
    <NFTCard
      card={card}
      detailCards={[card, secondCard, thirdCard]}
      battleStatsByCardKey={battleStatsByCardKey}
    />,
  );

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  let modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.ok(modal.getByText("Level 5"), "the opening card's own real stats show first");

  fireEvent.click(modal.getByRole("button", { name: "View next card" }));
  modal = within(screen.getByRole("dialog", { name: secondCard.name }));
  assert.ok(
    modal.getByText("Estimated Level 1"),
    "a card with no progress row shows its own estimate, not the previous card's stats",
  );
  assert.equal(modal.queryByText("Level 5"), null, "the previous card's real stats must not leak into this card");

  fireEvent.click(modal.getByRole("button", { name: "View next card" }));
  modal = within(screen.getByRole("dialog", { name: thirdCard.name }));
  assert.ok(modal.getByText("Level 8"), "the third card's own real stats show once navigated to");

  fireEvent.click(modal.getByRole("button", { name: "View previous card" }));
  modal = within(screen.getByRole("dialog", { name: secondCard.name }));
  assert.ok(modal.getByText("Estimated Level 1"), "navigating back still resolves the correct card's own preview");

  fireEvent.click(modal.getByRole("button", { name: "View previous card" }));
  modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.ok(modal.getByText("Level 5"), "navigating all the way back restores the first card's real stats");
});

test("the details modal omits the battle-stats section entirely outside a battle-aware context", async () => {
  const { fireEvent, render, screen, within, NFTCard } = await loadTestHarness();

  render(<NFTCard card={card} />);

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  const modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.equal(modal.queryByText("Battle Stats"), null);
  assert.equal(modal.queryByText(/Estimated Level/), null);
});

test("the details modal's Battle button calls onBattle with the active card and closes the modal", async () => {
  const { fireEvent, render, screen, userEvent, within, NFTCard } = await loadTestHarness();
  const user = userEvent.setup({ document });
  let battled: NFTCardType | undefined;

  render(
    <NFTCard
      card={card}
      onBattle={(selectedCard) => {
        battled = selectedCard;
      }}
    />,
  );

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  const dialog = screen.getByRole("dialog", { name: card.name });
  await user.click(within(dialog).getByRole("button", { name: `Battle with ${card.name}` }));

  assert.equal(battled, card);
  assert.equal(screen.queryByRole("dialog"), null, "the details modal closes once Battle is chosen");
});

test("the details modal omits its Battle button when onBattle is not passed", async () => {
  const { fireEvent, render, screen, within, NFTCard } = await loadTestHarness();
  render(<NFTCard card={card} />);

  fireEvent.load(screen.getByRole("img", { name: card.name }));
  fireEvent.click(screen.getByRole("button", { name: `View details for ${card.name}` }));

  const modal = within(screen.getByRole("dialog", { name: card.name }));
  assert.equal(modal.queryByRole("button", { name: `Battle with ${card.name}` }), null);
});
