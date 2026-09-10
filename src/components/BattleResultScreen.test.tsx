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

function stubDelayedDefenderTokenFetch(name: string, delayMs: number) {
  objktClient.request = (async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
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
    };
  }) as typeof objktClient.request;
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

test("shows the attacker card immediately, fetches and shows the defender card, and plays out the full hit-by-hit log", async () => {
  const { render, screen, waitFor, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(screen.getByText("My Fighter"), "attacker card renders synchronously from the prop, no fetch needed");
  const rival = await screen.findByText("Rival Card");
  assert.ok(rival, "defender card name is fetched and rendered once resolved");

  assert.ok(await screen.findByText(/My Fighter hit for 30/), "round 1's attacker hit eventually appears, labeled with the attacker's own card name");
  assert.ok(await screen.findByText(/My Fighter hit for 42/), "round 2's attacker hit eventually appears");
  // Both rounds' "Rival Card hit back for 28" lines are identical text -- poll
  // until both have actually landed rather than accepting the first match found.
  await waitFor(() => {
    assert.equal(
      screen.getAllByText(/Rival Card hit back for 28/).length,
      2,
      "both rounds' defender counter-hits appear, each labeled with the defender's real card name",
    );
  });
});

test("combat beats reveal one hit at a time, not the whole round instantly", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.equal(screen.queryByText(/My Fighter hit for 30/), null, "the first beat must not appear synchronously on render");

  assert.ok(await screen.findByText(/My Fighter hit for 30/), "the attacker's first hit appears after the beat delay");
  assert.equal(
    screen.queryByText(/Rival Card hit back for 28/),
    null,
    "the defender's reply must not appear in the same beat as the attacker's hit",
  );

  assert.ok(await screen.findByText(/Rival Card hit back for 28/), "the defender's hit appears as its own, later beat");
});

test("attacker hits use the attacker card's own name in the log, not a generic pronoun", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/My Fighter hit for 30/), "the attacker card's own name labels their hit");
  assert.equal(screen.queryByText(/You hit for/), null, "the old generic 'You' phrasing must be gone");
});

test("defender hits fall back to 'Opponent' while the card name is still loading, then switch to the real name", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  // Resolves well after the first two beats (2 * 5ms), so the fallback is
  // genuinely exercised before the real name arrives.
  stubDelayedDefenderTokenFetch("Rival Card", 200);

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(
    await screen.findByText(/Opponent hit back for 28/),
    "falls back to 'Opponent' for the defender's hit before the real card name has loaded",
  );

  // Once the real name resolves it applies retroactively to every rendered
  // defender line (both rounds dealt the same 28 damage, so there are two).
  const { waitFor } = await loadTestHarness();
  await waitFor(() => {
    assert.ok(screen.getAllByText(/Rival Card hit back for 28/).length >= 1, "switches to the real card name once it resolves");
  });
  assert.equal(screen.queryByText(/They hit back for/), null, "the old generic 'They' phrasing must be gone");
  assert.equal(screen.queryByText(/Opponent hit back for/), null, "the fallback text is fully replaced once the name resolves");
});

test("HP bars drain hit-by-hit in step with the revealed beats, not jump straight to final HP", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  // A longer beat delay here, comfortably larger than testing-library's 50ms
  // poll interval, so there's a real window to observe each intermediate HP
  // value before the next beat overwrites it.
  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={150}
    />,
  );

  assert.ok(screen.getByText(/You — 80 \/ 80 HP/), "attacker bar starts at full HP, not the final HP, before any beat plays");
  assert.ok(screen.getByText(/85 \/ 85 HP/), "defender bar starts at its full max HP too");

  await screen.findByText(/My Fighter hit for 30/);
  assert.ok(
    screen.getByText(/— 55 \/ 85 HP/),
    "defender's bar reflects round 1's real post-hit HP the moment that beat is revealed",
  );
  assert.ok(screen.getByText(/You — 80 \/ 80 HP/), "attacker's own bar hasn't moved yet -- only the defender took a hit so far");

  await screen.findByText(/Rival Card hit back for 28/);
  assert.ok(screen.getByText(/You — 52 \/ 80 HP/), "attacker's bar drops to round 1's real hpA once the defender's hit beat plays");
});

test("the outcome banner and Close button stay hidden until the whole battle has played out", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.equal(screen.queryByText(/Victory/), null, "the banner must not spoil the outcome before the fight has played out");
  assert.equal(
    screen.queryByRole("button", { name: /close/i }),
    null,
    "no way to dismiss the screen before the sequence finishes",
  );

  assert.ok(await screen.findByText(/Victory/), "the banner appears once every beat has been revealed");
  assert.ok(await screen.findByRole("button", { name: /close/i }), "Close becomes available once the sequence completes");
});

test("a win shows Victory and the XP awarded once the battle has played out", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult()}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/Victory/));
  assert.ok(screen.getByText(/\+42 XP/));
});

test("a loss shows Defeated once played out, and closing calls onClose", async () => {
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
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/Defeated/));
  const closeButton = await screen.findByRole("button", { name: /close/i });
  fireEvent.click(closeButton);
  assert.equal(closed, true);
});

test("a draw shows Draw with no XP line once played out", async () => {
  const { render, screen, BattleResultScreen } = await loadTestHarness();
  stubDefenderTokenFetch("Rival Card");

  render(
    <BattleResultScreen
      attackerCard={attackerCard}
      result={baseResult({ outcome: "draw", winner: null, xpAwarded: 0 })}
      wasOverkillTiebreak={false}
      onClose={() => {}}
      beatDelayMs={5}
    />,
  );

  assert.ok(await screen.findByText(/Draw/));
  assert.equal(screen.queryByText(/\+\d+ XP/), null, "no XP-awarded line renders for a draw");
});
