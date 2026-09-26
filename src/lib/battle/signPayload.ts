import { packDataBytes } from "@taquito/michel-codec";
import type { StringLiteral } from "@taquito/michel-codec";
import { canonicalEncode } from "./canonicalEncode";

/**
 * The one definition of what a wallet signs for a battle action, shared by the
 * browser that asks for the signature and the server that verifies it. Both
 * sides run it, so they cannot drift apart. It uses WebCrypto rather than
 * `node:crypto` so it runs in WalletContext (a client component); Node has the
 * same API. No secret is needed here: the client only resubmits the envelope
 * the server issued, and never recomputes its `mac`.
 */

export interface NonceEnvelope {
  timestamp: number;
  random: string;
  mac: string;
}

/** The server's labels baked into every signed message, so a signature can't be replayed against another deploy. */
export interface ProtocolInfo {
  appId: string;
  protocolVersion: number;
}

export type ActionParams = ReadonlyArray<string | number | boolean>;

/** Hash over the canonically encoded, positionally fixed action parameters. */
export async function computeParamHash(params: ActionParams): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalEncode(params)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The exact bytes a wallet signs for this envelope, action, and parameters. */
export async function bytesToSign(
  envelope: NonceEnvelope,
  { appId, protocolVersion }: ProtocolInfo,
  action: string,
  params: ActionParams,
): Promise<string> {
  const message = canonicalEncode([protocolVersion, appId, envelope.mac, action, await computeParamHash(params)]);
  const literal: StringLiteral = { string: message };
  return packDataBytes(literal).bytes;
}

const IMPLICIT_PUBLIC_KEY_PREFIX = /^(edpk|sppk|p2pk)/;

/** Shared with the server (auth.ts re-exports this) so both sides agree on scope. */
export function isImplicitAccountPublicKey(publicKey: string): boolean {
  return IMPLICIT_PUBLIC_KEY_PREFIX.test(publicKey);
}
