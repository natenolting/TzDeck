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
  MouseEvent: dom.window.MouseEvent,
  getComputedStyle: dom.window.getComputedStyle,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

type TestingLibrary = typeof import("@testing-library/react");
type ConnectButtonComponent = typeof import("./ConnectButton")["default"];
type WalletContextModule = typeof import("@/context/WalletContext");

let testingLibrary: TestingLibrary | undefined;
let ConnectButton: ConnectButtonComponent | undefined;
let walletContext: WalletContextModule | undefined;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  ConnectButton ||= (await import("./ConnectButton")).default;
  walletContext ||= await import("@/context/WalletContext");
  return { ...testingLibrary, ConnectButton, WalletContext: walletContext.WalletContext };
}

afterEach(() => testingLibrary?.cleanup());

const ADDRESS = "tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb";

test("the compact header button keeps its name while it shows only the ꜩ on phones", async () => {
  const { render, screen, ConnectButton } = await loadTestHarness();
  render(<ConnectButton variant="quiet" compact />);

  const button = screen.getByRole("button", { name: "Connect Tezos Wallet" });
  assert.equal(button.textContent, "ꜩConnect Tezos Wallet");
  assert.equal(screen.getByText("Connect Tezos Wallet").className, "max-sm:sr-only");
});

test("compact connected buttons keep the address and Disconnect as their names", async () => {
  const { render, screen, ConnectButton, WalletContext } = await loadTestHarness();
  const disconnect = async () => {};
  render(
    <WalletContext.Provider
      value={{
        address: ADDRESS,
        connect: async () => {},
        disconnect,
        tezos: null,
        signChallenge: async () => {
          throw new Error("unused");
        },
      }}
    >
      <ConnectButton variant="quiet" compact />
    </WalletContext.Provider>,
  );

  assert.ok(screen.getByRole("button", { name: "tz1VSU...jcjb" }), "the shortened address, though phones show only the dot");
  assert.ok(screen.getByRole("button", { name: "Disconnect" }));
  assert.equal(screen.getByText("Disconnect").className, "max-sm:sr-only");
});

test("without compact, every label stays visible at every width", async () => {
  const { render, screen, ConnectButton } = await loadTestHarness();
  render(<ConnectButton />);

  assert.equal(screen.getByText("Connect Tezos Wallet").className, "");
});
