import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { parseCardRef } from "@/lib/share";
import {
  shareTokenForResponse,
  signBattleShare,
  verifyBattleShare,
  withShareToken,
  type BattleShare,
} from "./shareToken";

const WINNER = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton:42";
const LOSER = "KT1LjmAdYQCLBjwv4S2oFkEzyHVkomAf5MrW:7";

const originalSecret = process.env.BATTLE_AUTH_SECRET;
const originalPrevious = process.env.BATTLE_SHARE_PREVIOUS_SECRETS;

beforeEach(() => {
  process.env.BATTLE_AUTH_SECRET = "current-secret";
  delete process.env.BATTLE_SHARE_PREVIOUS_SECRETS;
});

afterEach(() => {
  process.env.BATTLE_AUTH_SECRET = originalSecret;
  if (originalPrevious === undefined) delete process.env.BATTLE_SHARE_PREVIOUS_SECRETS;
  else process.env.BATTLE_SHARE_PREVIOUS_SECRETS = originalPrevious;
});

function share(overrides: Partial<BattleShare> = {}): BattleShare {
  return {
    winner: parseCardRef("KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton", "42")!,
    opponent: { kind: "card", card: parseCardRef("KT1LjmAdYQCLBjwv4S2oFkEzyHVkomAf5MrW", "7")! },
    rounds: 5,
    winnerSide: { power: 43, maxHp: 224, finalHp: 15 },
    opponentSide: { power: 40, maxHp: 210, finalHp: 0 },
    wonAt: 1_790_000_000,
    ...overrides,
  };
}

function winResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: "win",
    winner: "attacker",
    xpAwarded: 50,
    defenderWallet: "tz1SomeoneWhoDidNotPressShare",
    defenderCardKey: LOSER,
    attackerStats: { power: 43, hp: 224 },
    defenderStats: { power: 40, hp: 210 },
    combat: { rounds: 5, finalHpA: 15, finalHpB: 0, history: [] },
    ...overrides,
  };
}

test("a signed share verifies back to the same battle", () => {
  const token = signBattleShare(share());
  assert.ok(token);
  assert.deepEqual(verifyBattleShare(token), share());
});

test("a trainer win round-trips its tier", () => {
  const trainerWin = share({ opponent: { kind: "trainer", tier: "rare" } });
  assert.deepEqual(verifyBattleShare(signBattleShare(trainerWin)!), trainerWin);
});

test("the token fits comfortably in a link", () => {
  const token = signBattleShare(share())!;
  assert.ok(token.length < 260, `token is ${token.length} characters`);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe with no escaping");
});

test("a tampered payload or signature does not verify", () => {
  const token = signBattleShare(share())!;
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(
    Buffer.from(payload, "base64url").toString("utf8").replace('"c"', '"t"'),
  ).toString("base64url");

  assert.equal(verifyBattleShare(`${forged}.${signature}`), null, "a rewritten payload");
  assert.equal(verifyBattleShare(`${payload}.${signature.slice(0, -2)}AA`), null, "a rewritten signature");
  assert.equal(verifyBattleShare(`${payload}.`), null, "no signature");
  assert.equal(verifyBattleShare(`${payload}.${signature}.extra`), null, "a third part");
  assert.equal(verifyBattleShare("not-a-token"), null);
});

test("a token signed with another key does not verify", () => {
  const token = signBattleShare(share())!;
  process.env.BATTLE_AUTH_SECRET = "a-different-secret";
  assert.equal(verifyBattleShare(token), null);
});

test("after a secret rotation, listing the old secret keeps old links working", () => {
  const token = signBattleShare(share())!;
  process.env.BATTLE_AUTH_SECRET = "rotated-secret";
  process.env.BATTLE_SHARE_PREVIOUS_SECRETS = "something-older, current-secret";

  assert.deepEqual(verifyBattleShare(token), share());
});

test("with no secret configured nothing is signed and nothing verifies", () => {
  const token = signBattleShare(share())!;
  delete process.env.BATTLE_AUTH_SECRET;

  assert.equal(signBattleShare(share()), null);
  assert.equal(verifyBattleShare(token), null);
});

test("a PvP win from a battle route becomes a token, and the token carries no wallet", () => {
  const token = shareTokenForResponse(winResponse(), WINNER, new Date(1_790_000_000_000))!;
  const decoded = verifyBattleShare(token)!;

  assert.deepEqual(decoded, share());
  assert.equal(Buffer.from(token.split(".")[0], "base64url").toString().includes("tz1"), false);
});

test("a trainer win uses the tier rather than the trainer's placeholder card key", () => {
  const token = shareTokenForResponse(
    winResponse({ defenderCardKey: undefined, defenderWallet: undefined, trainerTier: "epic", trainerId: "trainer:epic" }),
    WINNER,
  )!;
  assert.deepEqual(verifyBattleShare(token)?.opponent, { kind: "trainer", tier: "epic" });
});

test("losses, draws, no-matches and incomplete responses get no token", () => {
  assert.equal(shareTokenForResponse(winResponse({ winner: "defender" }), WINNER), null, "a loss");
  assert.equal(shareTokenForResponse(winResponse({ outcome: "draw", winner: null }), WINNER), null, "a draw");
  assert.equal(shareTokenForResponse({ outcome: "no_match" }, WINNER), null, "no match");
  assert.equal(shareTokenForResponse(winResponse({ attackerStats: undefined }), WINNER), null, "no stats");
  assert.equal(shareTokenForResponse(winResponse(), "not-a-card-key"), null, "a malformed card key");
});

test("withShareToken adds the token to a win and leaves everything else as it was", () => {
  const win = withShareToken(winResponse(), WINNER) as Record<string, unknown>;
  assert.equal(typeof win.shareToken, "string");
  assert.equal(win.defenderWallet, "tz1SomeoneWhoDidNotPressShare", "the response itself is untouched");

  const loss = winResponse({ winner: "defender" });
  assert.equal(withShareToken(loss, WINNER), loss);
  assert.deepEqual(withShareToken({ error: "attack_cap_reached" }, WINNER), { error: "attack_cap_reached" });
});
