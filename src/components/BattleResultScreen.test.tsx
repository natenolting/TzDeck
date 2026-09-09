import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import type { NFTCard } from "@/lib/objkt";
import { objktClient } from "@/lib/objkt";
import type { BattleResult } from "./BattlePanel";

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
type BattleResultScreenComponent = typeof import("./BattleResultScreen")["default"];

let testingLibrary: TestingLibrary | undefined;
let BattleResultScreen: BattleResultScreenComponent | undefined;
const originalObjktRequest = objktClient.request;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  BattleResultScreen ||= (await import("./BattleResultScreen")).default;
  return { ...testingLibrary, BattleResultScreen };
}

const attackerCard: NFTCard = {
  token_id: "1",
  contract_address: "KT1Attacker",
  name: "My Fighter",
  display_uri: "https://example.com/attacker.jpg",
  editions: 5,
  objkt_url: "https://objkt.com/asset/KT1Attacker/1",
  rarity: "rare",
};

function stubDefenderTokenFetch(name: string) {
  objktClient.request = (async () => ({
    token: [
      {
        name,
        token_id: "9",
        fa_contract: "KT1Defender",
        display_uri: "https://example.com/defender.jpg",
        artifact_uri: null,
        thumbnail_uri: null,
        supply: 3,
        description: "A rival card.",
        creators: [],
        fa: { name: "Rival Collection" },
      },
    ],
  })) as typeof objktClient.request;
}

function baseResult(overrides: Partial<BattleResult> = {}): BattleResult {
  return {
    outcome: "win",
    winner: "attacker",
    xpAwarded: 42,
    winnerNewXp: 142,
    loserRecoveryUntil: null,
    defenderWallet: "tz1Rival000000000000000000000000000",
    defenderCardKey: "KT1Defender:9",
    attackerStats: { power: 30, hp: 80 },
    defenderStats: { power: 28, hp: 85 },
    combat: {
      rounds: 2,
      finalHpA: 24,
      finalHpB: 0,
      history: [
        { round: 1, damageA: 30, damageB: 28, hpA: 52, hpB: 55 },
        { round: 2, damageA: 42, damageB: 28, hpA: 24, hpB: 0 },
      ],
    },
    ...overrides,
  };
}

afterEach(() => {
  testingLibrary?.cleanup();
  objktClient.request = originalObjktRequest;
});

test("shows the attacker card immediately, fetches and shows the defender card, and lists the round-by-round log", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
    />,
  );

  assert.ok(screen.getByText("My Fighter"), "attacker card renders synchronously from the prop, no fetch needed");
  const rival = await screen.findByText("Rival Card");
  assert.ok(rival, "defender card name is fetched and rendered once resolved");
  assert.ok(screen.getByText(/Round 1/));
  assert.ok(screen.getByText(/Round 2/));
});

test("a win shows Victory and the XP awarded", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
    />,
  );

  assert.ok(screen.getByText(/Victory/));
  assert.ok(screen.getByText(/\+42 XP/));
});

test("a loss shows Defeated, and closing calls onClose", async () => {
  const { fireEvent, render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");
  let closed = false;

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({ winner: "defender" })}
      wasOverkillTiebreak={false}
      onClose={() => {
        closed = true;
      }}
    />,
  );

  assert.ok(screen.getByText(/Defeated/));
  fireEvent.click(screen.getByRole("button", { name: /close/i }));
  assert.equal(closed, true);
});

test("a draw shows Draw with no XP line", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({ outcome: "draw", winner: null, xpAwarded: 0 })}
      wasOverkillTiebreak={false}
      onClose={() => {}}
    />,
  );

  assert.ok(screen.getByText(/Draw/));
  assert.equal(screen.queryByText(/\+\d+ XP/), null, "no XP-awarded line renders for a draw");
});
