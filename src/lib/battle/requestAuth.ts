import { computeParamHash, verifySignedAction, type NonceEnvelope, type VerifyResult } from "./auth";
import { claimOrLookupAttempt, lookupAttemptByNonce, reclaimAttempt, type AttemptRow } from "./store";

export interface SignedRequestBody {
  envelope: NonceEnvelope;
  publicKey: string;
  signature: string;
  claimedAddress: string;
}

/**
 * L2: a route that only truthy-checked its fields let a non-string (e.g. a
 * number or object) reach signature verification, where it throws inside
 * `Buffer.from`/`verifySignature` instead of failing the input check -- a
 * 500 plus an attempt row wedged pending for the full 15-minute retry
 * horizon, instead of a clean 400 before any attempt was ever claimed.
 */
export function isSignedRequestBodyShapeValid(body: unknown): body is SignedRequestBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.publicKey !== "string") return false;
  if (typeof candidate.signature !== "string") return false;
  if (typeof candidate.claimedAddress !== "string") return false;
  const envelope = candidate.envelope;
  if (typeof envelope !== "object" || envelope === null) return false;
  const envelopeCandidate = envelope as Record<string, unknown>;
  if (typeof envelopeCandidate.timestamp !== "number") return false;
  if (typeof envelopeCandidate.random !== "string") return false;
  if (typeof envelopeCandidate.mac !== "string") return false;
  return true;
}

/** Why a signed request was turned away before any attempt could be claimed. */
export type AuthRejection =
  | Exclude<Extract<VerifyResult, { ok: false }>["reason"], "expired">
  | "nonce_expired"
  | "rate_limited"
  | "identity_mismatch";

export type AuthenticateAndClaimResult =
  | { outcome: "claimed"; wallet: string; nonce: string; generation: string; paramHash: string }
  | { outcome: "terminal"; row: AttemptRow }
  | { outcome: "in_progress" }
  | { outcome: "rejected"; status: number; reason: AuthRejection };

/**
 * Shared by every wallet-attributed write route: verify the action-bound
 * signature, then resolve what the attempt ledger says about this exact
 * nonce+identity. Never authenticates a request whose reconstructed bytes
 * don't match what was actually signed for THIS action/params.
 */
export interface AuthenticateAndClaimOptions {
  /** Test seam only -- production callers rely on the default (Date.now()). */
  now?: number;
  /**
   * Called with the signature-verified wallet, before any attempt row is
   * created or reclaimed. Returning false rejects the request with no DB
   * write at all, rather than the budget check running only after a fresh
   * attempt was already inserted -- otherwise a caller with a valid keypair
   * can force one permanent `battle_attempts` row per over-budget request,
   * for free, forever.
   */
  checkBudget?: (wallet: string) => Promise<boolean>;
}

export async function authenticateAndClaim(
  body: SignedRequestBody,
  action: string,
  actionParams: ReadonlyArray<string | number | boolean>,
  options: AuthenticateAndClaimOptions = {},
): Promise<AuthenticateAndClaimResult> {
  const { now, checkBudget } = options;
  const verifyResult = verifySignedAction({
    envelope: body.envelope,
    publicKey: body.publicKey,
    signature: body.signature,
    claimedAddress: body.claimedAddress,
    action,
    actionParams,
    now,
  });
  if (!verifyResult.ok) {
    if (verifyResult.reason === "expired") {
      // Signature and address checked out; only the envelope's 5-minute
      // freshness window has passed. Freshness gates CREATING a new attempt
      // only -- it says nothing about how long an already-accepted attempt
      // stays continuable, which is retry_until's job (15 minutes). So an
      // existing attempt is resumed exactly as the fresh-envelope path below
      // would resume it (terminal replay, reclaim, or in-progress), just
      // never inserted fresh: an absent or foreign nonce can't be claimed by
      // an expired envelope.
      const identity = { wallet: verifyResult.wallet, action, paramHash: computeParamHash(actionParams) };
      const existing = await lookupAttemptByNonce(verifyResult.nonce);
      const matchesIdentity =
        existing &&
        existing.wallet === identity.wallet &&
        existing.action === identity.action &&
        existing.param_hash === identity.paramHash;
      if (!matchesIdentity) {
        return { outcome: "rejected", status: 401, reason: "nonce_expired" };
      }
      if (existing.status === "completed" || (existing.status === "failed" && !existing.retryable)) {
        return { outcome: "terminal", row: existing };
      }
      if (new Date(existing.retry_until).getTime() <= Date.now()) {
        // Pending or retryable, but the attempt's own retry horizon has
        // also closed -- there is no longer anything to continue.
        return { outcome: "rejected", status: 401, reason: "nonce_expired" };
      }
      if (checkBudget && !(await checkBudget(verifyResult.wallet))) {
        return { outcome: "rejected", status: 429, reason: "rate_limited" };
      }
      const reclaimed = await reclaimAttempt(verifyResult.nonce, identity);
      if (reclaimed) {
        return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: reclaimed.generation, paramHash: identity.paramHash };
      }
      // Still within its retry horizon with a live lease: a genuinely
      // in-flight worker owns it right now.
      return { outcome: "in_progress" };
    }
    return { outcome: "rejected", status: 401, reason: verifyResult.reason };
  }

  const identity = { wallet: verifyResult.wallet, action, paramHash: computeParamHash(actionParams) };

  // A brand-new nonce is about to insert a permanent `battle_attempts` row;
  // gate that on budget *before* writing it, not after -- otherwise an
  // over-budget caller with a valid keypair gets a free row per rejected
  // request. A nonce that already has a row (replay, reclaim) is charged
  // against budget at the point it actually mutates state below instead,
  // matching a terminal replay staying free either way.
  if (checkBudget) {
    const existing = await lookupAttemptByNonce(verifyResult.nonce);
    if (!existing && !(await checkBudget(verifyResult.wallet))) {
      return { outcome: "rejected", status: 429, reason: "rate_limited" };
    }
  }

  const claim = await claimOrLookupAttempt(verifyResult.nonce, identity, new Date(body.envelope.timestamp));

  switch (claim.kind) {
    case "claimed":
      return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: claim.row.generation, paramHash: identity.paramHash };
    case "terminal":
      return { outcome: "terminal", row: claim.row };
    case "in_progress": {
      // The lease may have expired (a prior worker released it for bounded
      // continuation, or crashed) -- attempt a reclaim before reporting
      // in-flight. If the lease is still genuinely live, this is a no-op.
      if (checkBudget && !(await checkBudget(verifyResult.wallet))) {
        return { outcome: "rejected", status: 429, reason: "rate_limited" };
      }
      const reclaimed = await reclaimAttempt(verifyResult.nonce, identity);
      if (reclaimed) {
        return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: reclaimed.generation, paramHash: identity.paramHash };
      }
      return { outcome: "in_progress" };
    }
    case "identity_mismatch":
      return { outcome: "rejected", status: 401, reason: "identity_mismatch" };
    case "expired":
      return { outcome: "rejected", status: 401, reason: "nonce_expired" };
    default: {
      const exhaustive: never = claim;
      throw new Error(`unhandled claim kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Best-effort caller IP, for rate-limiting the unauthenticated routes that
 * have no wallet identity yet. `x-vercel-forwarded-for` is set by Vercel's
 * edge itself and can't be spoofed by the client (Vercel strips any
 * client-supplied copy) -- it's the only header here that's actually
 * trustworthy. Plain `x-forwarded-for` is attacker-controlled at its first
 * hop, so if that's all we have, the last entry (appended nearest the
 * server) is the least-untrustworthy fallback, not the first.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor) return vercelForwardedFor.split(",")[0].trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((hop) => hop.trim());
    return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Splits "KT1Contract:123" into its contract address and token id. */
export function splitCardKey(cardKey: string): { contractAddress: string; tokenId: string } {
  const separatorIndex = cardKey.lastIndexOf(":");
  if (separatorIndex === -1) throw new Error(`malformed card key: ${cardKey}`);
  return {
    contractAddress: cardKey.slice(0, separatorIndex),
    tokenId: cardKey.slice(separatorIndex + 1),
  };
}
