import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import type { NFTCard } from "@/lib/card";

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
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type ArtworkComponent = typeof import("./SharedCardArtwork")["default"];

let testingLibrary: TestingLibrary | undefined;
let SharedCardArtwork: ArtworkComponent | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  SharedCardArtwork ||= (await import("./SharedCardArtwork")).default;
  return { ...testingLibrary, SharedCardArtwork };
}

const card: NFTCard = {
  token_id: "17",
  contract_address: "KT1Di86S6R2zhnSPTwufkByTYkQzikfj32kL",
  name: "The City Within",
  thumbnail_uri: "ipfs://bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy",
  display_uri: "ipfs://bafkreia2w3ie24d3twcuwa3isp2d627b7gb6eg6o7apsh5lt7bsdkzyzxe",
  artifact_uri: "ipfs://bafkreiffi5d6pyklqgpcbl3ubqjzth6rijz54upjsosvccq5327xk3b5am",
  mime: "image/png",
  artist_alias: "artisticink",
  editions: 1,
  objkt_url: "https://objkt.com/asset/example/17",
  rarity: "legendary",
};

afterEach(() => {
  testingLibrary?.cleanup();
});

test("shared artwork uses browser-embeddable IPFS metadata instead of OBJKT's server-only CDN", async () => {
  const { fireEvent, render, screen, SharedCardArtwork } = await loadTestHarness();
  render(<SharedCardArtwork card={card} />);

  let image = screen.getByRole("img", { name: card.name });
  assert.equal(
    image.getAttribute("src"),
    "https://ipfs.filebase.io/ipfs/bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy",
  );
  assert.equal(image.getAttribute("src")?.includes("assets.objkt.media"), false);

  fireEvent.error(image);
  image = screen.getByRole("img", { name: card.name });
  assert.equal(
    image.getAttribute("src"),
    "https://bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy.ipfs.dweb.link/",
  );

  fireEvent.error(image);
  image = screen.getByRole("img", { name: card.name });
  assert.equal(
    image.getAttribute("src"),
    "https://ipfs.filebase.io/ipfs/bafkreia2w3ie24d3twcuwa3isp2d627b7gb6eg6o7apsh5lt7bsdkzyzxe",
  );

  fireEvent.load(image);
  assert.equal(screen.queryByRole("status", { name: "Loading token artwork" }), null);
});
