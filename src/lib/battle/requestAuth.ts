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
      // Signature and address checked out; only the envelope's freshness
      // window has passed. That's fine for replaying an already-terminal
      // result (the whole point of retry_until outliving the 5-minute
      // freshness window), but never for claiming a brand-new attempt.
      const identity = { wallet: verifyResult.wallet, action, paramHash: computeParamHash(actionParams) };
      const existing = await lookupAttemptByNonce(verifyResult.nonce);
      const isMatchingTerminal =
        existing &&
        existing.wallet === identity.wallet &&
        existing.action === identity.action &&
        existing.param_hash === identity.paramHash &&
        (existing.status === "completed" || (existing.status === "failed" && !existing.retryable));
      if (isMatchingTerminal) {
        return { outcome: "terminal", row: existing };
      }
      return { outcome: "rejected", status: 401, reason: "nonce_expired" };
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
