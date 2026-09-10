import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";

import BattlePanel, {
  applyBattleOutcome,
  HOLDINGS_STALE_MS,
  isHoldingsStale,
  previewStatsForCard,
  recoveryCopy,
  resubmitBattleAttempt,
  resubmitWhilePending,
} from "./BattlePanel";
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

test("isHoldingsStale: never synced (null) is always stale, regardless of the interval", () => {
  assert.equal(isHoldingsStale(null, new Date(), HOLDINGS_STALE_MS), true);
});

test("isHoldingsStale: synced well within the interval is not stale", () => {
  const now = new Date("2026-01-02T00:00:00.000Z");
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  assert.equal(isHoldingsStale(oneHourAgo, now, HOLDINGS_STALE_MS), false);
});

test("isHoldingsStale: exactly at the interval boundary is not yet stale, just past it is", () => {
  const now = new Date("2026-01-02T00:00:00.000Z");
  const staleMs = 60_000;
  const exactlyAtBoundary = new Date(now.getTime() - staleMs).toISOString();
  const justPastBoundary = new Date(now.getTime() - staleMs - 1).toISOString();
  assert.equal(isHoldingsStale(exactlyAtBoundary, now, staleMs), false);
  assert.equal(isHoldingsStale(justPastBoundary, now, staleMs), true);
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

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

test("resubmitBattleAttempt resolves success immediately, no retry", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return jsonResponse(200, { outcome: "win" });
  };

  const outcome = await resubmitBattleAttempt(post, 5, 2000, async () => {
    throw new Error("must not wait when the first response already succeeds");
  });

  assert.deepEqual(outcome, { kind: "success", json: { outcome: "win" } });
  assert.equal(postCalls, 1);
});

test("resubmitBattleAttempt retries a 409 attempt_in_progress, honoring Retry-After, then succeeds", async () => {
  const statuses = [409, 409, 200];
  let postCalls = 0;
  const post = async () => {
    const status = statuses[postCalls];
    postCalls += 1;
    if (status === 409) return jsonResponse(409, { error: "attempt_in_progress" }, { "Retry-After": "2" });
    return jsonResponse(200, { outcome: "win" });
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const outcome = await resubmitBattleAttempt(post, 5, 2000, wait);

  assert.deepEqual(outcome, { kind: "success", json: { outcome: "win" } });
  assert.equal(postCalls, 3, "the identical signed body is resubmitted, no re-signing");
  assert.deepEqual(delays, [2000, 2000], "honors the route's Retry-After: 2 header (in ms)");
});

test("resubmitBattleAttempt retries a 429 rate_limited using the default delay when no Retry-After is given", async () => {
  const statuses = [429, 200];
  let postCalls = 0;
  const post = async () => {
    const status = statuses[postCalls];
    postCalls += 1;
    if (status === 429) return jsonResponse(429, { error: "rate_limited" });
    return jsonResponse(200, { outcome: "win" });
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const outcome = await resubmitBattleAttempt(post, 5, 750, wait);

  assert.deepEqual(outcome, { kind: "success", json: { outcome: "win" } });
  assert.deepEqual(delays, [750], "falls back to the default delay when the response carries no Retry-After");
});

test("resubmitBattleAttempt retries a network failure (fetch throws), then succeeds", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    if (postCalls < 3) throw new TypeError("network error");
    return jsonResponse(200, { outcome: "win" });
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const outcome = await resubmitBattleAttempt(post, 5, 1000, wait);

  assert.deepEqual(outcome, { kind: "success", json: { outcome: "win" } });
  assert.equal(postCalls, 3);
  assert.deepEqual(delays, [1000, 1000]);
});

test("resubmitBattleAttempt does not retry a terminal business rejection, even though it's a 409", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return jsonResponse(409, { error: "attacker_card_not_held" });
  };

  const outcome = await resubmitBattleAttempt(post, 5, 2000, async () => {
    throw new Error("must not wait -- a terminal rejection is not retryable");
  });

  assert.deepEqual(outcome, { kind: "terminal", status: 409, error: "attacker_card_not_held" });
  assert.equal(postCalls, 1, "not every 409 is retryable -- a business rejection must not loop");
});

test("resubmitBattleAttempt surfaces nonce_expired as 'expired', not a generic terminal error", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return jsonResponse(401, { error: "nonce_expired" });
  };

  const outcome = await resubmitBattleAttempt(post, 5, 2000, async () => {
    throw new Error("must not wait -- expiry requires a fresh signature, not a retry");
  });

  assert.deepEqual(outcome, { kind: "expired" });
  assert.equal(postCalls, 1);
});

test("resubmitBattleAttempt gives up after maxAttempts of a persistently retryable failure and reports 'uncertain'", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return jsonResponse(503, { error: "ownership_unverifiable" });
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const outcome = await resubmitBattleAttempt(post, 3, 500, wait);

  assert.deepEqual(outcome, { kind: "uncertain" }, "exhausted retries must never claim success or a definite terminal failure");
  assert.equal(postCalls, 4, "the initial post plus exactly maxAttempts resubmissions, never more");
  assert.deepEqual(delays, [500, 500, 500]);
});

test("applyBattleOutcome: a win commits the result state and clears the pending attempt", () => {
  const json = { outcome: "win", winner: "attacker" };
  const { panelState, clearPendingAttempt } = applyBattleOutcome({ kind: "success", json });
  assert.deepEqual(panelState, { kind: "result", result: json, wasOverkillTiebreak: false });
  assert.equal(clearPendingAttempt, true);
});

test("applyBattleOutcome: a no_match outcome is not an error and clears the pending attempt", () => {
  const { panelState, clearPendingAttempt } = applyBattleOutcome({ kind: "success", json: { outcome: "no_match" } });
  assert.deepEqual(panelState, { kind: "no_match" });
  assert.equal(clearPendingAttempt, true);
});

test("applyBattleOutcome: attack_cap_reached and defense_cap_reached map to the friendly cap_reached state", () => {
  const attack = applyBattleOutcome({ kind: "terminal", status: 409, error: "attack_cap_reached" });
  assert.deepEqual(attack.panelState, { kind: "cap_reached" });
  assert.equal(attack.clearPendingAttempt, true);

  const defense = applyBattleOutcome({ kind: "terminal", status: 409, error: "defense_cap_reached" });
  assert.deepEqual(defense.panelState, { kind: "cap_reached" });
});

test("applyBattleOutcome: any other terminal rejection surfaces its own message and clears the pending attempt", () => {
  const { panelState, clearPendingAttempt } = applyBattleOutcome({
    kind: "terminal",
    status: 409,
    error: "attacker_card_not_held",
  });
  assert.deepEqual(panelState, { kind: "error", message: "attacker_card_not_held" });
  assert.equal(clearPendingAttempt, true);
});

test("applyBattleOutcome: expiry clears the pending attempt -- a fresh signature is required, retrying it is pointless", () => {
  const { panelState, clearPendingAttempt } = applyBattleOutcome({ kind: "expired" });
  assert.deepEqual(panelState, { kind: "expired" });
  assert.equal(clearPendingAttempt, true);
});

test("applyBattleOutcome: an uncertain outcome retains the pending attempt so Retry can resubmit it", () => {
  const { panelState, clearPendingAttempt } = applyBattleOutcome({ kind: "uncertain" });
  assert.deepEqual(panelState, { kind: "uncertain" });
  assert.equal(clearPendingAttempt, false, "the signed body must survive so Retry never re-signs");
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

function statusJson(overrides: Partial<ReturnType<typeof baseStatusJson>> = {}) {
  return { ...baseStatusJson(), ...overrides };
}

function baseStatusJson() {
  return {
    optedIn: false,
    effectiveAttackCount: 0,
    attackResetAt: null,
    effectiveDefenseCount: 0,
    defenseResetAt: null,
    holdingsRefreshedAt: null as string | null,
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
  assert.ok(
    await screen.findByText(/Panel Fighter hit for 30/),
    "the round-by-round combat log from the server response must reach the screen",
  );
  assert.ok(
    await screen.findByText(/Victory/, undefined, { timeout: 5000 }),
    "a win must render through BattleResultScreen, not the panel's old inline result line, once its beat-by-beat playback finishes",
  );
});

test("a rejected signature sends no POST and shows the cancellation message", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let randomCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/random")) {
      randomCalls += 1;
      return new Response(JSON.stringify(battleWinJson()), { status: 200 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  const wallet = {
    ...mockWalletValue(),
    signChallenge: async () => {
      throw new Error("Signature request rejected");
    },
  };

  render(
    <WalletContext.Provider value={wallet}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const battleButton = await screen.findByRole("button", { name: "Battle!" });
  fireEvent.click(battleButton);

  assert.ok(await screen.findByText(/Signature declined or cancelled/));
  assert.equal(randomCalls, 0, "a rejected signature must never reach the battle route");
});

test("a terminal POST-phase business rejection shows its own error, never the signature-declined message", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/random")) {
      return new Response(JSON.stringify({ error: "attacker_card_not_held" }), { status: 409 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const battleButton = await screen.findByRole("button", { name: "Battle!" });
  fireEvent.click(battleButton);

  assert.ok(await screen.findByText(/attacker_card_not_held/));
  assert.equal(
    screen.queryByText(/Signature declined or cancelled/),
    null,
    "a POST-phase failure must never be mislabeled as a declined signature",
  );
});

test("Battle and opt-in controls stay disabled while a battle submission is in flight", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let resolveRandom: (response: Response) => void;
  const randomPromise = new Promise<Response>((resolve) => {
    resolveRandom = resolve;
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/random")) return randomPromise;
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const battleButton = await screen.findByRole("button", { name: "Battle!" });
  const optInButton = screen.getByRole("button", { name: "Opt in" });
  fireEvent.click(battleButton);

  const submittingButton = await screen.findByRole("button", { name: "Battling…" });
  assert.equal(submittingButton.hasAttribute("disabled"), true);
  assert.equal(
    optInButton.hasAttribute("disabled"),
    true,
    "opt-in must be blocked while a battle submission is pending, per item 2",
  );

  resolveRandom!(new Response(JSON.stringify({ error: "attacker_card_not_held" }), { status: 409 }));

  await screen.findByText(/attacker_card_not_held/);
  assert.equal(
    screen.getByRole("button", { name: "Battle!" }).hasAttribute("disabled"),
    false,
    "controls re-enable once the attempt reaches a terminal state",
  );
});

test("automatic retries and a manual Retry after exhaustion both reuse the original signature, never re-signing", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let signChallengeCalls = 0;
  let randomCalls = 0;
  // Must match BattlePanel's own BATTLE_RETRY_MAX_ATTEMPTS (5) + 1 initial post.
  const autoAttemptsBeforeUncertain = 6;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/random")) {
      randomCalls += 1;
      if (randomCalls <= autoAttemptsBeforeUncertain) {
        return new Response(JSON.stringify({ error: "attempt_in_progress" }), {
          status: 409,
          headers: { "Retry-After": "0" },
        });
      }
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

  const baseWallet = mockWalletValue();
  const wallet = {
    ...baseWallet,
    signChallenge: async (...args: Parameters<typeof baseWallet.signChallenge>) => {
      signChallengeCalls += 1;
      return baseWallet.signChallenge(...args);
    },
  };

  render(
    <WalletContext.Provider value={wallet}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const battleButton = await screen.findByRole("button", { name: "Battle!" });
  fireEvent.click(battleButton);

  const retryButton = await screen.findByRole("button", { name: "Retry" }, { timeout: 5000 });
  assert.equal(
    randomCalls,
    autoAttemptsBeforeUncertain,
    "exhausted the automatic retry budget, every attempt using the same signed body",
  );
  assert.equal(signChallengeCalls, 1, "automatic retries never re-sign");

  fireEvent.click(retryButton);

  assert.ok(await screen.findByText(/Victory/, undefined, { timeout: 5000 }));
  assert.equal(signChallengeCalls, 1, "the manual Retry resubmits the exact same signed body -- it never re-signs either");
  assert.equal(randomCalls, autoAttemptsBeforeUncertain + 1);
});

test("holdings that have never synced show 'Never synced' and offer a Refresh Holdings action, with no unsigned write", async () => {
  const { render, screen, WalletContext } = await loadTestHarness();
  let refreshCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) {
      return new Response(JSON.stringify(statusJson({ holdingsRefreshedAt: null })), { status: 200 });
    }
    if (url.includes("/api/battle/refresh")) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ refreshed: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  assert.ok(await screen.findByText(/Never synced/i));
  assert.ok(await screen.findByRole("button", { name: "Refresh Holdings" }));
  assert.equal(refreshCalls, 0, "merely opening a stale panel must never perform an unsigned write");
});

test("Refresh Holdings signs the refresh action, POSTs the signed body, and updates the last-synced status without touching opt-in", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let statusCalls = 0;
  let refreshCalls = 0;
  let refreshRequestBody: Record<string, unknown> | undefined;
  const refreshedAt = "2026-01-05T12:00:00.000Z";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) {
      statusCalls += 1;
      const holdingsRefreshedAt = statusCalls === 1 ? null : refreshedAt;
      return new Response(JSON.stringify(statusJson({ optedIn: true, holdingsRefreshedAt })), { status: 200 });
    }
    if (url.includes("/api/battle/refresh")) {
      refreshCalls += 1;
      refreshRequestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ refreshed: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  await screen.findByText(/Never synced/i);
  const refreshButton = await screen.findByRole("button", { name: "Refresh Holdings" });
  fireEvent.click(refreshButton);

  await screen.findByText(new RegExp(new Date(refreshedAt).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(refreshCalls, 1);
  assert.equal(refreshRequestBody?.claimedAddress, "tz1PanelWallet00000000000000000000");
  assert.equal(statusCalls, 2, "status is re-fetched after a successful refresh, reflecting the new timestamp");
  assert.ok(screen.getByText(/Opted in/), "opt-in state must survive a holdings refresh untouched");
});

test("opt-in and Battle stay disabled while holdings are refreshing", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let resolveRefresh: (response: Response) => void;
  const refreshPromise = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/refresh")) return refreshPromise;
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  render(
    <WalletContext.Provider value={mockWalletValue()}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const refreshButton = await screen.findByRole("button", { name: "Refresh Holdings" });
  const optInButton = screen.getByRole("button", { name: "Opt in" });
  const battleButton = screen.getByRole("button", { name: "Battle!" });
  fireEvent.click(refreshButton);

  const refreshingButton = await screen.findByRole("button", { name: "Refreshing…" });
  assert.equal(refreshingButton.hasAttribute("disabled"), true);
  assert.equal(optInButton.hasAttribute("disabled"), true, "opt-in must be blocked while a holdings refresh is pending");
  assert.equal(battleButton.hasAttribute("disabled"), true, "battling must be blocked while a holdings refresh is pending");

  resolveRefresh!(new Response(JSON.stringify({ refreshed: true }), { status: 200 }));

  await screen.findByRole("button", { name: "Refresh Holdings" });
  assert.equal(screen.getByRole("button", { name: "Opt in" }).hasAttribute("disabled"), false);
});

test("a 202 continuation from Refresh Holdings is resubmitted with the identical signed body until it completes", async () => {
  const { fireEvent, render, screen, WalletContext } = await loadTestHarness();
  let refreshCalls = 0;
  let signChallengeCalls = 0;
  const bodiesSeen: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/battle/status")) return new Response(JSON.stringify(statusJson()), { status: 200 });
    if (url.includes("/api/battle/refresh")) {
      refreshCalls += 1;
      bodiesSeen.push(String(init?.body));
      if (refreshCalls < 3) return new Response(JSON.stringify({ status: "in_progress" }), { status: 202 });
      return new Response(JSON.stringify({ refreshed: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in BattlePanel render test: ${url}`);
  }) as typeof fetch;

  const baseWallet = mockWalletValue();
  const wallet = {
    ...baseWallet,
    signChallenge: async (...args: Parameters<typeof baseWallet.signChallenge>) => {
      signChallengeCalls += 1;
      return baseWallet.signChallenge(...args);
    },
  };

  render(
    <WalletContext.Provider value={wallet}>
      <BattlePanel card={attackerCard} onClose={() => {}} />
    </WalletContext.Provider>,
  );

  const refreshButton = await screen.findByRole("button", { name: "Refresh Holdings" });
  fireEvent.click(refreshButton);

  await screen.findByRole("button", { name: "Refreshing…" }, { timeout: 5000 });
  await screen.findByRole("button", { name: "Refresh Holdings" }, { timeout: 5000 });
  assert.equal(refreshCalls, 3, "two 202 continuations plus the settling call");
  assert.equal(signChallengeCalls, 1, "bounded continuation resubmits the same signed body -- it never re-signs");
  assert.equal(new Set(bodiesSeen).size, 1, "every resubmission sends byte-identical signed bytes");
});
