import { computeParamHash, verifySignedAction, type NonceEnvelope } from "./auth";
import { claimOrLookupAttempt, lookupAttemptByNonce, reclaimAttempt, type AttemptRow } from "./store";

export interface SignedRequestBody {
  envelope: NonceEnvelope;
  publicKey: string;
  signature: string;
  claimedAddress: string;
}

export type AuthenticateAndClaimResult =
  | { outcome: "claimed"; wallet: string; nonce: string; generation: string }
  | { outcome: "terminal"; row: AttemptRow }
  | { outcome: "in_progress" }
  | { outcome: "rejected"; status: number; reason: string };

/**
 * Shared by every wallet-attributed write route: verify the action-bound
 * signature, then resolve what the attempt ledger says about this exact
 * nonce+identity. Never authenticates a request whose reconstructed bytes
 * don't match what was actually signed for THIS action/params.
 */
export async function authenticateAndClaim(
  body: SignedRequestBody,
  action: string,
  actionParams: ReadonlyArray<string | number | boolean>,
  /** Test seam only -- production callers rely on the default (Date.now()). */
  now?: number,
): Promise<AuthenticateAndClaimResult> {
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
      const reclaimed = await reclaimAttempt(verifyResult.nonce, identity);
      if (reclaimed) {
        return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: reclaimed.generation };
      }
      // Still within its retry horizon with a live lease: a genuinely
      // in-flight worker owns it right now.
      return { outcome: "in_progress" };
    }
    return { outcome: "rejected", status: 401, reason: verifyResult.reason };
  }

  const identity = { wallet: verifyResult.wallet, action, paramHash: computeParamHash(actionParams) };
  const claim = await claimOrLookupAttempt(verifyResult.nonce, identity, new Date(body.envelope.timestamp));

  switch (claim.kind) {
    case "claimed":
      return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: claim.row.generation };
    case "terminal":
      return { outcome: "terminal", row: claim.row };
    case "in_progress": {
      // The lease may have expired (a prior worker released it for bounded
      // continuation, or crashed) -- attempt a reclaim before reporting
      // in-flight. If the lease is still genuinely live, this is a no-op.
      const reclaimed = await reclaimAttempt(verifyResult.nonce, identity);
      if (reclaimed) {
        return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: reclaimed.generation };
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

/** Best-effort caller IP, for rate-limiting the unauthenticated routes that have no wallet identity yet. */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
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
