import { packDataBytes } from "@taquito/michel-codec";
import type { StringLiteral } from "@taquito/michel-codec";
import { canonicalEncode } from "./canonicalEncode";

/**
 * Browser-safe mirror of auth.ts's byte-construction logic, deliberately
 * kept dependency-free of `node:crypto` (WebCrypto instead) so it can run in
 * WalletContext (a client component). The client never recomputes or
 * verifies the envelope's own `mac` -- it only resubmits what the server
 * issued verbatim -- so no HMAC/secret material is needed here at all.
 */

export interface NonceEnvelope {
  timestamp: number;
  random: string;
  mac: string;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const IMPLICIT_PUBLIC_KEY_PREFIX = /^(edpk|sppk|p2pk)/;

/** Shared with the server (auth.ts re-exports this) so both sides agree on scope. */
export function isImplicitAccountPublicKey(publicKey: string): boolean {
  return IMPLICIT_PUBLIC_KEY_PREFIX.test(publicKey);
}

export async function bytesToSignInBrowser(
  envelope: NonceEnvelope,
  protocolVersion: number,
  appId: string,
  action: string,
  params: ReadonlyArray<string | number | boolean>,
): Promise<string> {
  const paramHash = await sha256Hex(canonicalEncode(params));
  const message = canonicalEncode([protocolVersion, appId, envelope.mac, action, paramHash]);
  const literal: StringLiteral = { string: message };
  return packDataBytes(literal).bytes;
}
