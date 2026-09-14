import { objktClient } from "@/lib/objkt";

/**
 * A fresh, single-card ownership check -- narrower and cheaper than
 * fetchUserHoldings' 250-token pull, and able to tell "not held" apart from
 * "could not verify" (fetchUserHoldings collapses both into `[]` on total
 * upstream failure, which is unsafe to reuse for R4's fresh-ownership gate).
 */
export type OwnershipResult =
  | { status: "held"; observedAt: Date; source: "objkt" | "tzkt" }
  | { status: "not_held" }
  | { status: "unverifiable" };

const UPSTREAM_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`upstream timed out after ${ms}ms`)), ms);
    }),
  ]);
}

interface ObjktSingleHolderResponse {
  token_holder: Array<{ quantity: number | string }>;
}

async function checkObjkt(
  address: string,
  contractAddress: string,
  tokenId: string,
): Promise<OwnershipResult | null> {
  const query = `
    query SingleTokenOwnership($address: String!, $contract: String!, $tokenId: String!) {
      token_holder(
        where: {
          holder_address: { _eq: $address },
          token: { fa_contract: { _eq: $contract }, token_id: { _eq: $tokenId } }
        },
        limit: 1
      ) {
        quantity
      }
    }
  `;
  const data = await withTimeout(
    objktClient.request<ObjktSingleHolderResponse>(query, {
      address,
      contract: contractAddress,
      tokenId,
    }),
    UPSTREAM_TIMEOUT_MS,
  );

  const balance = data?.token_holder?.[0];
  if (!balance) return { status: "not_held" };
  if (Number(balance.quantity) > 0) {
    return { status: "held", observedAt: new Date(), source: "objkt" };
  }
  return { status: "not_held" };
}

interface TzktBalanceRow {
  balance?: number | string;
}

async function checkTzkt(
  address: string,
  contractAddress: string,
  tokenId: string,
): Promise<OwnershipResult | null> {
  const url = `https://api.tzkt.io/v1/tokens/balances?account=${encodeURIComponent(address)}&token.contract=${encodeURIComponent(contractAddress)}&token.tokenId=${encodeURIComponent(tokenId)}`;
  const response = await withTimeout(
    fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
    UPSTREAM_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`TzKT ownership check failed: ${response.status}`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("TzKT ownership check returned an unexpected shape");
  }

  const held = rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const balance = Number((row as TzktBalanceRow).balance ?? 0);
    return balance > 0;
  });
  return held
    ? { status: "held", observedAt: new Date(), source: "tzkt" }
    : { status: "not_held" };
}

/**
 * Verify a specific wallet/card pair immediately before settlement. Never
 * collapses an upstream failure into "not held" -- callers must branch on
 * `unverifiable` explicitly (R4, AE6).
 */
export async function verifyOwnership(
  address: string,
  contractAddress: string,
  tokenId: string,
): Promise<OwnershipResult> {
  try {
    const result = await checkObjkt(address, contractAddress, tokenId);
    if (result) return result;
  } catch (err) {
    console.warn("OBJKT single-token ownership check failed, attempting TzKT fallback:", err);
  }

  try {
    const result = await checkTzkt(address, contractAddress, tokenId);
    if (result) return result;
  } catch (err) {
    console.error("TzKT single-token ownership check also failed:", err);
  }

  return { status: "unverifiable" };
}
