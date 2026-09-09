import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import BattlePanel, { previewStatsForCard, recoveryCopy, resubmitWhilePending } from "./BattlePanel";
import { baseStatsFromSeed, deriveBaseSeed } from "@/lib/battle/rules";
import { objktClient, type NFTCard } from "@/lib/objkt";

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
type WalletContextModule = typeof import("@/context/WalletContext");

let testingLibrary: TestingLibrary | undefined;
let walletContextModule: WalletContextModule | undefined;
const originalFetch = globalThis.fetch;
const originalObjktRequest = objktClient.request;

async function loadTestHarness() {
  testingLibrary ||= await import("@testing-library/react");
  walletContextModule ||= await import("@/context/WalletContext");
  return { ...testingLibrary, WalletContext: walletContextModule.WalletContext };
}

afterEach(() => {
  testingLibrary?.cleanup();
  globalThis.fetch = originalFetch;
  objktClient.request = originalObjktRequest;
});

test("recoveryCopy explains the offensive-vs-defensive recovery distinction rather than showing a raw enum", () => {
  assert.match(recoveryCopy("defensive"), /defensive loss/i);
  assert.match(recoveryCopy("defensive"), /shorter/i);
  assert.match(recoveryCopy("offensive"), /offensive loss/i);
  assert.equal(recoveryCopy(null), "");
});

test("previewStatsForCard matches the server's own seed derivation for the same inputs", () => {
  const editions = 12;
  const description = "A hand-painted study of light on water.";
  const expected = baseStatsFromSeed(deriveBaseSeed(editions, description));
  assert.deepEqual(previewStatsForCard({ editions, description }), { power: expected.power, hp: expected.hp });
});

test("previewStatsForCard returns null rather than a fabricated number when editions isn't loaded", () => {
  assert.equal(previewStatsForCard({ editions: undefined, description: "irrelevant" }), null);
});

function statusResponse(status: number): Response {
  return new Response(null, { status });
}

test("resubmitWhilePending resolves immediately when the first response isn't 202, without ever waiting", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return statusResponse(200);
  };
  let waitCalls = 0;
  const wait = async () => {
    waitCalls += 1;
  };

  const result = await resubmitWhilePending(post, 50, 300, wait);
  assert.equal(result.timedOut, false);
  assert.equal(result.response.status, 200);
  assert.equal(postCalls, 1, "a settled first response must not trigger a resubmission");
  assert.equal(waitCalls, 0);
});

test("resubmitWhilePending resubmits the identical body while pending, until a non-202 response arrives", async () => {
  const statuses = [202, 202, 200];
  let postCalls = 0;
  const post = async () => {
    const status = statuses[postCalls];
    postCalls += 1;
    return statusResponse(status);
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const result = await resubmitWhilePending(post, 50, 300, wait);
  assert.equal(result.timedOut, false);
  assert.equal(result.response.status, 200);
  assert.equal(postCalls, 3, "must post once per 202 plus the settling call");
  assert.deepEqual(delays, [300, 300], "must wait pollDelayMs before each resubmission, no backoff");
});

test("resubmitWhilePending gives up after maxAttempts resubmissions rather than resubmitting forever", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return statusResponse(202); // never settles
  };
  let waitCalls = 0;
  const wait = async () => {
    waitCalls += 1;
  };

  const result = await resubmitWhilePending(post, 2, 300, wait);
  assert.equal(result.timedOut, true);
  assert.equal(result.response.status, 202, "the last-seen response is still returned so the caller can inspect it");
  assert.equal(postCalls, 3, "the initial post plus exactly maxAttempts resubmissions, never more");
  assert.equal(waitCalls, 2);
});

test("resubmitWhilePending resubmits the identical body across a rate-limit episode, not just bounded continuation", async () => {
  const statuses = [202, 429, 202, 200];
  let postCalls = 0;
  const post = async () => {
    const status = statuses[postCalls];
    postCalls += 1;
    return statusResponse(status);
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const result = await resubmitWhilePending(post, 50, 300, wait, 15, 5000);
  assert.equal(result.timedOut, false);
  assert.equal(result.response.status, 200);
  assert.equal(postCalls, 4, "the signed request must be resubmitted through 202 and 429 alike, never abandoned");
  assert.deepEqual(delays, [300, 5000, 300], "429 must back off on its own (longer) delay, distinct from the 202 poll delay");
});

test("resubmitWhilePending gives up after maxRateLimitAttempts, independent of the 202 continuation budget", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return statusResponse(429); // rate limit never clears
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const result = await resubmitWhilePending(post, 50, 300, wait, 2, 5000);
  assert.equal(result.timedOut, true);
  assert.equal(result.response.status, 429, "the last-seen response is still returned so the caller can inspect it");
  assert.equal(postCalls, 3, "the initial post plus exactly maxRateLimitAttempts resubmissions, never more");
  assert.deepEqual(delays, [5000, 5000], "every wait must use the rate-limit delay, not the 202 poll delay");
});

const attackerCard: NFTCard = {
  token_id: "1",
  contract_address: "KT1PanelAttacker0000000000000000",
  name: "Panel Fighter",
  display_uri: "https://example.com/attacker.jpg",
  editions: 5,
  objkt_url: "https://objkt.com/asset/KT1PanelAttacker0000000000000000/1",
  rarity: "rare",
};

function mockWalletValue() {
  return {
    address: "tz1PanelWallet00000000000000000000",
    connect: async () => undefined,
    disconnect: async () => undefined,
    tezos: null,
    signChallenge: async () => ({
      envelope: { timestamp: Date.now(), random: "r", mac: "m" },
      publicKey: "edpkTestPublicKey",
      signature: "edsigTestSignature",
      address: "tz1PanelWallet00000000000000000000",
    }),
  };
}

function statusJson() {
  return {
    optedIn: false,
    effectiveAttackCount: 0,
    attackResetAt: null,
    effectiveDefenseCount: 0,
    defenseResetAt: null,
    holdingsRefreshedAt: null,
    cards: [],
  };
}

function battleWinJson() {
  return {
    outcome: "win",
    winner: "attacker",
    xpAwarded: 42,
    winnerNewXp: 142,
    loserRecoveryUntil: null,
    defenderWallet: "tz1PanelDefender0000000000000000000",
    defenderCardKey: "KT1PanelDefender0000000000000000:9",
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
  };
}

test("BattlePanel: a won battle mounts BattleResultScreen with the attacker card and combat detail, not the panel's own old inline result", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) {
      return new Response(JSON.stringify(statusJson()), { status: 200 });
    }
    if (url.includes("/api/battle/random")) {
      return new Response(JSON.stringify(battleWinJson()), { status: 200 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  objktClient.request = (async () => ({
    token: [
      {
        name: "Panel Rival",
        token_id: "9",
        fa_contract: "KT1PanelDefender0000000000000000",
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

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const battleButton = await screen.findByRole("button", { name: "Battle!" });
  fireEvent.click(battleButton);

  assert.ok(
    await screen.findByText("Panel Fighter"),
    "BattleResultScreen must actually mount with the same attacker card BattlePanel was given, not just compute a result",
  );
  assert.ok(await screen.findByText(/Round 1/), "the round-by-round combat log from the server response must reach the screen");
  assert.ok(screen.getByText(/Victory/), "a win must render through BattleResultScreen, not the panel's old inline result line");
});
