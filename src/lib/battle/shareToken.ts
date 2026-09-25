import { createHmac, timingSafeEqual } from "node:crypto";

import type { CardRarity } from "@/lib/objkt";
import { parseCardRef, type CardRef } from "@/lib/share";
import { TRAINER_TIER_ORDER } from "./rules";

// ---------------------------------------------------------------------------
// Battle share tokens (#81, #128): a won battle's shareable link carries its
// own result, signed, so nothing is stored for it and it can never age out
// of battle_log's retention sweep. The token is only a summary of what the
// page and preview show; it proves the battle happened because only the
// battle routes can sign one.
// ---------------------------------------------------------------------------

/** Bump when the encoded shape changes. An unknown version never verifies. */
export const SHARE_TOKEN_VERSION = 1;

/** 128 bits of HMAC-SHA256: forging a link needs the key, not luck. */
const MAC_BYTES = 16;

/** Separates share tokens from every other use of the battle secret. */
const KEY_LABEL = "tzdeck:battle-share";

export interface ShareSide {
  power: number;
  maxHp: number;
  finalHp: number;
}

export type ShareOpponent =
  | { kind: "card"; card: CardRef }
  | { kind: "trainer"; tier: CardRarity };

/** A won battle, as much of it as a result link shows. Never a wallet. */
export interface BattleShare {
  winner: CardRef;
  opponent: ShareOpponent;
  rounds: number;
  winnerSide: ShareSide;
  opponentSide: ShareSide;
  /** Unix seconds, when the link was issued: the battle's own settle time to within a request. */
  wonAt: number;
}

/**
 * Keys that may have signed a live token, newest first. Derived from
 * BATTLE_AUTH_SECRET so sharing needs no new secret; if that secret is ever
 * rotated, listing the old value in BATTLE_SHARE_PREVIOUS_SECRETS
 * (comma-separated) keeps links issued under it working.
 */
function shareKeys(): Buffer[] {
  const secrets = [
    process.env.BATTLE_AUTH_SECRET,
    ...(process.env.BATTLE_SHARE_PREVIOUS_SECRETS ?? "").split(","),
  ]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
  return secrets.map((secret) => createHmac("sha256", secret).update(KEY_LABEL).digest());
}

function mac(key: Buffer, payload: string): Buffer {
  return createHmac("sha256", key).update(payload).digest().subarray(0, MAC_BYTES);
}

function cardKey(card: CardRef): string {
  return `${card.contract}:${card.tokenId}`;
}

function parseCardKey(value: unknown): CardRef | null {
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(":");
  if (separator === -1) return null;
  return parseCardRef(value.slice(0, separator), value.slice(separator + 1));
}

/** Whole numbers only, bounded: HP and Power at any level stay well under this. */
function stat(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

/** Unix seconds from 2020 to 2100: a date, not a stat, so it gets its own range. */
function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1_577_836_800 && value <= 4_102_444_800
    ? value
    : null;
}

/**
 * Positional rather than keyed, because the token rides in a URL:
 * [version, winner, opponentKind, opponent, rounds, winner power/maxHp/finalHp,
 * opponent power/maxHp/finalHp, wonAt]. About 200 characters once signed.
 */
function encode(share: BattleShare): string {
  const opponent = share.opponent.kind === "card"
    ? ["c", cardKey(share.opponent.card)]
    : ["t", share.opponent.tier];
  return JSON.stringify([
    SHARE_TOKEN_VERSION,
    cardKey(share.winner),
    ...opponent,
    share.rounds,
    share.winnerSide.power,
    share.winnerSide.maxHp,
    share.winnerSide.finalHp,
    share.opponentSide.power,
    share.opponentSide.maxHp,
    share.opponentSide.finalHp,
    share.wonAt,
  ]);
}

function decode(json: string): BattleShare | null {
  let fields: unknown;
  try {
    fields = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(fields) || fields.length !== 12 || fields[0] !== SHARE_TOKEN_VERSION) return null;

  const winner = parseCardKey(fields[1]);
  let opponent: ShareOpponent | null = null;
  if (fields[2] === "c") {
    const card = parseCardKey(fields[3]);
    if (card) opponent = { kind: "card", card };
  } else if (fields[2] === "t" && TRAINER_TIER_ORDER.includes(fields[3] as CardRarity)) {
    opponent = { kind: "trainer", tier: fields[3] as CardRarity };
  }
  const numbers = fields.slice(4, 11).map(stat);
  const wonAt = timestamp(fields[11]);
  if (!winner || !opponent || wonAt === null || numbers.some((value) => value === null)) return null;

  const [rounds, winnerPower, winnerMaxHp, winnerFinalHp, opponentPower, opponentMaxHp, opponentFinalHp] =
    numbers as number[];
  return {
    winner,
    opponent,
    rounds,
    winnerSide: { power: winnerPower, maxHp: winnerMaxHp, finalHp: winnerFinalHp },
    opponentSide: { power: opponentPower, maxHp: opponentMaxHp, finalHp: opponentFinalHp },
    wonAt,
  };
}

/** A signed, URL-safe token for `share`, or null when no signing secret is configured. */
export function signBattleShare(share: BattleShare): string | null {
  const [key] = shareKeys();
  if (!key) return null;
  const payload = Buffer.from(encode(share)).toString("base64url");
  return `${payload}.${mac(key, payload).toString("base64url")}`;
}

/**
 * The battle a token describes, or null for anything that is not a token this
 * app signed: bad shape, bad signature, unknown version. Every caller answers
 * null with a 404, so there is no reason to say which.
 */
export function verifyBattleShare(token: string): BattleShare | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const given = Buffer.from(signature, "base64url");
  if (given.length !== MAC_BYTES) return null;
  const signed = shareKeys().some((key) => timingSafeEqual(mac(key, payload), given));
  if (!signed) return null;

  return decode(Buffer.from(payload, "base64url").toString("utf8"));
}

interface StatsLike {
  power?: unknown;
  hp?: unknown;
}

/**
 * The share token for a battle route's success response, or null when there is
 * nothing to share: a loss, a draw, no match, or a response missing the stats.
 * Takes the response exactly as the database stored it, so a replayed request
 * gets a link too.
 */
export function shareTokenForResponse(
  response: Record<string, unknown>,
  attackerCardKey: string,
  now: Date = new Date(),
): string | null {
  if (response.outcome !== "win" || response.winner !== "attacker") return null;

  const winner = parseCardKey(attackerCardKey);
  let opponent: ShareOpponent | null = null;
  if (typeof response.trainerTier === "string" && TRAINER_TIER_ORDER.includes(response.trainerTier as CardRarity)) {
    opponent = { kind: "trainer", tier: response.trainerTier as CardRarity };
  } else {
    const card = parseCardKey(response.defenderCardKey);
    if (card) opponent = { kind: "card", card };
  }

  const attackerStats = (response.attackerStats ?? {}) as StatsLike;
  const defenderStats = (response.defenderStats ?? {}) as StatsLike;
  const combat = (response.combat ?? {}) as { rounds?: unknown; finalHpA?: unknown; finalHpB?: unknown };
  const numbers = [
    combat.rounds,
    attackerStats.power,
    attackerStats.hp,
    combat.finalHpA,
    defenderStats.power,
    defenderStats.hp,
    combat.finalHpB,
  ].map(stat);
  if (!winner || !opponent || numbers.some((value) => value === null)) return null;

  const [rounds, winnerPower, winnerMaxHp, winnerFinalHp, opponentPower, opponentMaxHp, opponentFinalHp] =
    numbers as number[];
  return signBattleShare({
    winner,
    opponent,
    rounds,
    winnerSide: { power: winnerPower, maxHp: winnerMaxHp, finalHp: winnerFinalHp },
    opponentSide: { power: opponentPower, maxHp: opponentMaxHp, finalHp: opponentFinalHp },
    wonAt: Math.floor(now.getTime() / 1000),
  });
}

/**
 * A battle route's response with `shareToken` added when it's the attacker's
 * win. Applied to fresh and replayed responses alike.
 */
export function withShareToken(
  response: unknown,
  attackerCardKey: string,
): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const token = shareTokenForResponse(response as Record<string, unknown>, attackerCardKey);
  return token ? { ...response, shareToken: token } : response;
}
