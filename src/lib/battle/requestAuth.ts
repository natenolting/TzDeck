import { computeParamHash, verifySignedAction, type NonceEnvelope } from "./auth";
import { claimOrLookupAttempt, type AttemptRow } from "./store";

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
): Promise<AuthenticateAndClaimResult> {
  const verifyResult = verifySignedAction({
    envelope: body.envelope,
    publicKey: body.publicKey,
    signature: body.signature,
    claimedAddress: body.claimedAddress,
    action,
    actionParams,
  });
  if (!verifyResult.ok) {
    return { outcome: "rejected", status: 401, reason: verifyResult.reason };
  }

  const identity = { wallet: verifyResult.wallet, action, paramHash: computeParamHash(actionParams) };
  const claim = await claimOrLookupAttempt(verifyResult.nonce, identity, new Date(body.envelope.timestamp));

  switch (claim.kind) {
    case "claimed":
      return { outcome: "claimed", wallet: verifyResult.wallet, nonce: verifyResult.nonce, generation: claim.row.generation };
    case "terminal":
      return { outcome: "terminal", row: claim.row };
    case "in_progress":
      return { outcome: "in_progress" };
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

/** Splits "KT1Contract:123" into its contract address and token id. */
export function splitCardKey(cardKey: string): { contractAddress: string; tokenId: string } {
  const separatorIndex = cardKey.lastIndexOf(":");
  if (separatorIndex === -1) throw new Error(`malformed card key: ${cardKey}`);
  return {
    contractAddress: cardKey.slice(0, separatorIndex),
    tokenId: cardKey.slice(separatorIndex + 1),
  };
}
