import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { packDataBytes } from "@taquito/michel-codec";
import type { StringLiteral } from "@taquito/michel-codec";
import { getPkhfromPk, verifySignature } from "@taquito/utils";
import { canonicalEncode } from "./canonicalEncode";
import { isImplicitAccountPublicKey } from "./signPayload";

export { canonicalEncode, isImplicitAccountPublicKey };

// ---------------------------------------------------------------------------
// U2: stateless nonce envelope + action-bound signature verification.
//
// The envelope is self-contained -- {timestamp, random, mac} -- because HMAC
// is one-way: a server that only returned the MAC output could never
// recompute it to verify a later request (an earlier version of this design
// got exactly this wrong). The client resubmits all three fields verbatim;
// the server recomputes `mac` from them and compares, never inverting
// anything. No DB write happens at issuance -- only after a signature
// verifies (see store.ts's battle_attempts claim, U1b).
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = 1;
const NONCE_FRESHNESS_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

function requireSecret(): string {
  const secret = process.env.BATTLE_AUTH_SECRET;
  if (!secret) throw new Error("BATTLE_AUTH_SECRET is not set");
  return secret;
}

function requireAppId(): string {
  const appId = process.env.BATTLE_APP_ID;
  if (!appId) throw new Error("BATTLE_APP_ID is not set");
  return appId;
}

export interface NonceEnvelope {
  timestamp: number;
  random: string;
  mac: string;
}

function computeEnvelopeMac(timestamp: number, random: string): string {
  const encoded = canonicalEncode([PROTOCOL_VERSION, requireAppId(), timestamp, random]);
  return createHmac("sha256", requireSecret()).update(encoded).digest("hex");
}

/** Issues a nonce envelope with no database write -- issuance is necessarily unauthenticated. */
export function issueNonce(): NonceEnvelope {
  const timestamp = Date.now();
  const random = randomBytes(16).toString("hex");
  const mac = computeEnvelopeMac(timestamp, random);
  return { timestamp, random, mac };
}

/**
 * appId and protocolVersion aren't secrets -- they're labels baked into the
 * signed message for cross-environment binding -- so the client needs them
 * from somewhere. Bundling them into the session response (rather than a
 * separate NEXT_PUBLIC_ env var the client would have to keep in sync with
 * the server's own value) means there's exactly one source of truth.
 */
export function getPublicProtocolInfo(): { appId: string; protocolVersion: number } {
  return { appId: requireAppId(), protocolVersion: PROTOCOL_VERSION };
}

function macBytesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type EnvelopeCheck =
  | { ok: true }
  | { ok: false; reason: "mac_mismatch" | "expired" | "future_dated" };

export function verifyEnvelope(envelope: NonceEnvelope, now: number = Date.now()): EnvelopeCheck {
  const expected = computeEnvelopeMac(envelope.timestamp, envelope.random);
  if (!macBytesEqual(expected, envelope.mac)) return { ok: false, reason: "mac_mismatch" };
  if (envelope.timestamp > now + MAX_CLOCK_SKEW_MS) return { ok: false, reason: "future_dated" };
  if (now - envelope.timestamp > NONCE_FRESHNESS_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** The nonce is the envelope's own MAC -- unique, unforgeable without the secret, and self-contained. */
export function nonceFromEnvelope(envelope: NonceEnvelope): string {
  return envelope.mac;
}

/** Hash over the canonically-encoded, positionally-fixed action parameters. */
export function computeParamHash(params: ReadonlyArray<string | number | boolean>): string {
  return createHash("sha256").update(canonicalEncode(params)).digest("hex");
}

function buildSignedMessage(envelope: NonceEnvelope, action: string, paramHash: string): string {
  return canonicalEncode([PROTOCOL_VERSION, requireAppId(), envelope.mac, action, paramHash]);
}

/** The exact bytes a client must sign for a given envelope/action/params triple. */
export function bytesToSign(envelope: NonceEnvelope, action: string, params: ReadonlyArray<string | number | boolean>): string {
  const message = buildSignedMessage(envelope, action, computeParamHash(params));
  const literal: StringLiteral = { string: message };
  return packDataBytes(literal).bytes;
}

export type VerifyResult =
  | { ok: true; wallet: string; nonce: string }
  // The envelope was authentic and the signature checked out, but its
  // freshness window has passed -- never valid for claiming a NEW attempt,
  // but the wallet/nonce it carries are trustworthy enough to look up
  // whatever a prior request already recorded under that same nonce.
  | { ok: false; reason: "expired"; wallet: string; nonce: string }
  | {
      ok: false;
      reason:
        | "envelope_invalid"
        | "unsupported_wallet_type"
        | "address_mismatch"
        | "signature_invalid"
        | "malformed";
    };

/**
 * Verifies a signed, action-bound request. Never accepts a client-supplied
 * payload as authoritative -- the server reconstructs the exact bytes it
 * expects to have been signed from the envelope plus the actual request's
 * own route and parameters, and only then checks the signature against them.
 */
export function verifySignedAction(params: {
  envelope: NonceEnvelope;
  publicKey: string;
  signature: string;
  claimedAddress: string;
  action: string;
  actionParams: ReadonlyArray<string | number | boolean>;
  /** Test seam only -- production callers rely on the default (Date.now()). */
  now?: number;
}): VerifyResult {
  const envelopeCheck = verifyEnvelope(params.envelope, params.now);
  // A forged or not-yet-valid envelope is rejected outright -- nothing after
  // this point can be trusted. An EXPIRED envelope (freshness only) still
  // has a genuine MAC, so it's allowed to fall through to the normal
  // signature/address checks below; only the final verdict is downgraded.
  if (!envelopeCheck.ok && envelopeCheck.reason !== "expired") {
    return { ok: false, reason: "envelope_invalid" };
  }
  const expired = !envelopeCheck.ok;

  if (!isImplicitAccountPublicKey(params.publicKey)) {
    return { ok: false, reason: "unsupported_wallet_type" };
  }

  let derived: string;
  try {
    derived = getPkhfromPk(params.publicKey);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (derived !== params.claimedAddress) return { ok: false, reason: "address_mismatch" };

  let expectedBytes: string;
  try {
    expectedBytes = bytesToSign(params.envelope, params.action, params.actionParams);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifySignature(expectedBytes, params.publicKey, params.signature);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!signatureValid) return { ok: false, reason: "signature_invalid" };

  const nonce = nonceFromEnvelope(params.envelope);
  if (expired) return { ok: false, reason: "expired", wallet: derived, nonce };
  return { ok: true, wallet: derived, nonce };
}
