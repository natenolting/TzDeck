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
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type SectionTabsModule = typeof import("./SectionTabs");

let testingLibrary: TestingLibrary | undefined;
let sectionTabs: SectionTabsModule | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  sectionTabs ||= await import("./SectionTabs");
  return { ...testingLibrary, ...sectionTabs };
}

afterEach(() => testingLibrary?.cleanup());

type Section = "packs" | "deck" | "about";

const TABS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "packs", label: "Booster Packs", icon: null },
  { id: "deck", label: "My Deck", icon: null },
  { id: "about", label: "About", icon: null },
];

/** Renders the tablist with real selection state, the way the page does. */
async function renderTabs(initial: Section = "packs") {
  const { render, screen, default: SectionTabs } = await loadTestHarness();
  const { useState } = await import("react");

  function Harness() {
    const [selected, setSelected] = useState<Section>(initial);
    return (
      <SectionTabs label="Sections" tabs={TABS} selected={selected} onSelect={setSelected} />
    );
  }

  render(<Harness />);
  return screen;
}

const selectedName = (screen: Awaited<ReturnType<typeof renderTabs>>) =>
  screen.getByRole("tab", { selected: true }).textContent;

test("SectionTabs: exposes a named tablist whose tabs are named by their visible labels", async () => {
  const screen = await renderTabs();

  assert.ok(screen.getByRole("tablist", { name: "Sections" }));
  assert.deepEqual(
    screen.getAllByRole("tab").map((tab) => tab.textContent),
    ["Booster Packs", "My Deck", "About"],
  );
  for (const tab of screen.getAllByRole("tab")) {
    assert.equal(tab.hasAttribute("aria-label"), false, "the visible label is the name");
  }
});

test("SectionTabs: only the selected tab is in the Tab order and points at its panel", async () => {
  const { sectionPanelId } = await loadTestHarness();
  const screen = await renderTabs("deck");

  const [packs, deck, about] = screen.getAllByRole("tab");
  assert.equal(deck.getAttribute("aria-selected"), "true");
  assert.equal(deck.tabIndex, 0);
  assert.equal(deck.getAttribute("aria-controls"), sectionPanelId("deck"));
  for (const other of [packs, about]) {
    assert.equal(other.getAttribute("aria-selected"), "false");
    assert.equal(other.tabIndex, -1);
    assert.equal(other.hasAttribute("aria-controls"), false);
  }
});

test("SectionTabs: arrow keys select and focus the next tab, wrapping at both ends", async () => {
  const { fireEvent } = await loadTestHarness();
  const screen = await renderTabs("packs");

  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
  assert.equal(selectedName(screen), "My Deck");
  assert.equal(document.activeElement, screen.getByRole("tab", { selected: true }));

  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
  assert.equal(selectedName(screen), "Booster Packs", "Right from the last tab wraps to the first");

  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowLeft" });
  assert.equal(selectedName(screen), "About", "Left from the first tab wraps to the last");
  assert.equal(document.activeElement, screen.getByRole("tab", { selected: true }));
});

test("SectionTabs: Home and End jump to the first and last tab", async () => {
  const { fireEvent } = await loadTestHarness();
  const screen = await renderTabs("deck");

  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "End" });
  assert.equal(selectedName(screen), "About");

  fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "Home" });
  assert.equal(selectedName(screen), "Booster Packs");
});

test("SectionTabs: other keys are left alone", async () => {
  const { fireEvent } = await loadTestHarness();
  const screen = await renderTabs("deck");

  const handled = fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowDown" });
  assert.equal(handled, true, "the event was not prevented");
  assert.equal(selectedName(screen), "My Deck");
});

test("SectionTabs: clicking a tab selects it", async () => {
  const { fireEvent } = await loadTestHarness();
  const screen = await renderTabs("packs");

  fireEvent.click(screen.getByRole("tab", { name: "About" }));
  assert.equal(selectedName(screen), "About");
});
