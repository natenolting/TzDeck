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
type ConfirmDialogComponent = typeof import("./ConfirmDialog")["default"];

let testingLibrary: TestingLibrary | undefined;
let ConfirmDialog: ConfirmDialogComponent | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  ConfirmDialog ||= (await import("./ConfirmDialog")).default;
  return { ...testingLibrary, ConfirmDialog };
}

afterEach(() => testingLibrary?.cleanup());

interface Spies {
  confirms: number;
  cancels: number;
}

async function renderDialog(spies: Spies) {
  const harness = await loadTestHarness();
  const rendered = harness.render(
    <harness.ConfirmDialog
      title="Clear your wishlist?"
      message="This removes all 3 saved cards. Export first if you want a backup."
      confirmLabel="Clear Wishlist"
      onConfirm={() => {
        spies.confirms += 1;
      }}
      onCancel={() => {
        spies.cancels += 1;
      }}
    />,
  );
  return { ...harness, ...rendered };
}

test("confirming runs the action once", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent, screen } = await renderDialog(spies);

  fireEvent.click(screen.getByRole("button", { name: "Clear Wishlist" }));

  assert.deepEqual(spies, { confirms: 1, cancels: 0 });
});

test("cancelling leaves the action untaken", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent, screen } = await renderDialog(spies);

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  assert.deepEqual(spies, { confirms: 0, cancels: 1 });
});

test("Escape cancels rather than confirming", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent } = await renderDialog(spies);

  fireEvent.keyDown(dom.window.document, { key: "Escape" });

  assert.deepEqual(spies, { confirms: 0, cancels: 1 });
});

test("clicking the backdrop cancels", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent, screen } = await renderDialog(spies);

  fireEvent.click(screen.getByTestId("confirm-dialog-backdrop"));

  assert.deepEqual(spies, { confirms: 0, cancels: 1 });
});

test("clicking inside the dialog does not cancel it", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent, screen } = await renderDialog(spies);

  fireEvent.click(screen.getByRole("dialog"));

  assert.deepEqual(spies, { confirms: 0, cancels: 0 });
});

test("focus starts on Cancel, so a stray Enter doesn't destroy anything", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { screen } = await renderDialog(spies);

  assert.equal(dom.window.document.activeElement, screen.getByRole("button", { name: "Cancel" }));
});

test("the dialog names itself to assistive technology", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { screen } = await renderDialog(spies);
  const dialog = screen.getByRole("dialog");

  assert.equal(dialog.getAttribute("aria-modal"), "true");
  const labelId = dialog.getAttribute("aria-labelledby");
  assert.ok(labelId);
  assert.equal(dom.window.document.getElementById(labelId)?.textContent, "Clear your wishlist?");
});

test("Tab cycles within the dialog instead of escaping to the page behind it", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { fireEvent, screen } = await renderDialog(spies);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const confirm = screen.getByRole("button", { name: "Clear Wishlist" });

  confirm.focus();
  fireEvent.keyDown(dom.window.document, { key: "Tab" });
  assert.equal(dom.window.document.activeElement, cancel);

  cancel.focus();
  fireEvent.keyDown(dom.window.document, { key: "Tab", shiftKey: true });
  assert.equal(dom.window.document.activeElement, confirm);
});

test("the page behind is locked from scrolling, and released on close", async () => {
  const spies: Spies = { confirms: 0, cancels: 0 };
  const { unmount } = await renderDialog(spies);

  assert.equal(dom.window.document.body.style.overflow, "hidden");

  unmount();

  assert.notEqual(dom.window.document.body.style.overflow, "hidden");
});

test("closing returns focus to whatever opened the dialog", async () => {
  const opener = dom.window.document.createElement("button");
  dom.window.document.body.appendChild(opener);
  opener.focus();

  const spies: Spies = { confirms: 0, cancels: 0 };
  const { unmount } = await renderDialog(spies);
  unmount();

  assert.equal(dom.window.document.activeElement, opener);
  opener.remove();
});
