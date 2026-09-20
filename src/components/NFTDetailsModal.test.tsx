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
  Reflect.deleteProperty(globalThis.navigator, "share");
  Reflect.deleteProperty(globalThis.navigator, "clipboard");
  Reflect.deleteProperty(globalThis, "fetch");
});

/** Records what the share button reaches for, without letting it off the machine. */
function stubShareEnvironment(options: {
  withShareSheet: boolean;
  clipboardDenied?: boolean;
  legacyCopyWorks?: boolean;
}) {
  const clipboard: string[] = [];
  const shared: Array<{ url?: string }> = [];
  const fetched: string[] = [];

  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (options.clipboardDenied) throw new DOMException("denied", "NotAllowedError");
        clipboard.push(text);
      },
    },
  });
  Object.defineProperty(globalThis.document, "execCommand", {
    configurable: true,
    value: (command: string) => {
      if (command !== "copy") return false;
      if (!options.legacyCopyWorks) return false;
      clipboard.push("legacy");
      return true;
    },
  });
  if (options.withShareSheet) {
    Object.defineProperty(globalThis.navigator, "share", {
      configurable: true,
      value: async (data: { url?: string }) => { shared.push(data); },
    });
  }
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string) => { fetched.push(String(input)); return new Response(); },
  });

  return { clipboard, shared, fetched };
}

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

test("a video token plays in the modal instead of rendering as a still image", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({
    mime: "video/mp4",
    artifact_uri: "https://ipfs.example/movie.mp4",
    display_uri: "https://ipfs.example/poster.png",
  });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  const video = document.body.querySelector("video");
  assert.ok(video, "expected a video element for a video/mp4 token");
  assert.equal(video.hasAttribute("controls"), true);
  // The artifact can be enormous -- this token is 124MB -- so nothing may be
  // fetched until the viewer actually presses play.
  assert.equal(video.getAttribute("preload"), "none");
  assert.equal(video.getAttribute("poster"), card.display_uri);
  assert.equal(video.querySelector("source")?.getAttribute("src"), card.artifact_uri);
  assert.equal(document.body.querySelector("img"), null);
});

test("an image token still renders as an image", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({
    mime: "image/png",
    display_uri: "https://ipfs.example/art.png",
  });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  assert.equal(document.body.querySelector("video"), null);
  assert.ok(document.body.querySelector("img"));
});

test("a card with no mime renders as an image, as it always did", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({ display_uri: "https://ipfs.example/art.png" });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  assert.equal(document.body.querySelector("video"), null);
  assert.ok(document.body.querySelector("img"));
});

test("a video format the browser cannot decode falls back to the poster image", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({
    mime: "video/quicktime",
    artifact_uri: "https://ipfs.example/movie.mov",
    display_uri: "https://ipfs.example/poster.png",
  });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  assert.equal(document.body.querySelector("video"), null);
  assert.ok(document.body.querySelector("img"));
});

test("the video player is reachable by keyboard from inside the modal", async () => {
  const { render, NFTDetailsModal } = await loadTestHarness();
  const card = createCard({
    mime: "video/mp4",
    artifact_uri: "https://ipfs.example/movie.mp4",
    display_uri: "https://ipfs.example/poster.png",
  });

  render(
    <NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />,
  );

  const dialog = document.body.querySelector("[role=dialog]");
  const focusable = dialog?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])',
  );
  const tags = [...(focusable ?? [])].map((el) => el.tagName.toLowerCase());
  assert.ok(tags.includes("video"), `focus trap skipped the player: ${tags.join(", ")}`);
});

test("sharing without a share sheet copies the bare card URL and says so", async () => {
  const { fireEvent, render, screen, NFTDetailsModal } = await loadTestHarness();
  const spies = stubShareEnvironment({ withShareSheet: false });
  const card = createCard();

  render(<NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: `Share ${card.name}` }));

  assert.ok(await screen.findByText("Copied"));
  assert.deepEqual(spies.clipboard, [
    "https://tzdeck.xyz/c/KT1DetailsModalCollection/1",
  ]);
});

test("sharing hands off to the OS share sheet where there is one, and copies nothing", async () => {
  const { fireEvent, render, screen, NFTDetailsModal } = await loadTestHarness();
  const spies = stubShareEnvironment({ withShareSheet: true });
  const card = createCard();

  render(<NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: `Share ${card.name}` }));
  await screen.findByText("Share");

  assert.deepEqual(spies.shared, [
    { url: "https://tzdeck.xyz/c/KT1DetailsModalCollection/1" },
  ]);
  assert.deepEqual(spies.clipboard, []);
});


test("a refused clipboard still copies through the old path", async () => {
  const { fireEvent, render, screen, NFTDetailsModal } = await loadTestHarness();
  const spies = stubShareEnvironment({
    withShareSheet: false,
    clipboardDenied: true,
    legacyCopyWorks: true,
  });
  const card = createCard();

  render(<NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: `Share ${card.name}` }));
  await screen.findByText("Copied");

  assert.deepEqual(spies.clipboard, ["legacy"]);
  assert.equal(screen.queryByLabelText("Card link, copy it manually"), null);
});

test("a browser that blocks every copy path shows the link to copy by hand", async () => {
  const { fireEvent, render, screen, NFTDetailsModal } = await loadTestHarness();
  stubShareEnvironment({
    withShareSheet: false,
    clipboardDenied: true,
    legacyCopyWorks: false,
  });
  const card = createCard();

  render(<NFTDetailsModal card={card} isWishlisted={false} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: `Share ${card.name}` }));

  const field = await screen.findByLabelText("Card link, copy it manually");
  assert.equal(
    (field as HTMLInputElement).value,
    "https://tzdeck.xyz/c/KT1DetailsModalCollection/1",
  );
});
