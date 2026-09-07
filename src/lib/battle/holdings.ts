import { objktClient } from "@/lib/objkt";
import { deriveBaseSeed, type BaseSeed } from "./rules";

/**
 * Authoritative, server-fetched card metadata for materializing progress
 * rows. Deliberately separate from `fetchUserHoldings` -- that helper
 * collapses total upstream failure into `[]`, indistinguishable from a
 * genuinely empty wallet, and defaults a missing `supply` to `1` (fine for
 * display, dangerous for battle stats: an unknown supply would otherwise be
 * rewarded with legendary-tier rarity).
 */
export interface BattleTokenMetadata {
  cardKey: string;
  contractAddress: string;
  tokenId: string;
  seed: BaseSeed;
  source: "objkt" | "tzkt";
  observedAt: Date;
}

/** Conservative fallback for a missing/invalid supply value -- never treated as scarce. */
const UNKNOWN_SUPPLY_FALLBACK = 100_000;

const UPSTREAM_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`upstream timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function resolveEditions(rawSupply: unknown): number {
  const supply = Number(rawSupply);
  if (!Number.isFinite(supply) || supply <= 0) return UNKNOWN_SUPPLY_FALLBACK;
  return Math.trunc(supply);
}

export type MetadataResult =
  | { status: "ok"; metadata: BattleTokenMetadata }
  | { status: "not_held" }
  | { status: "unavailable" };

interface ObjktSingleTokenResponse {
  token_holder: Array<{
    quantity: number | string;
    token: { supply: number | string | null; description: string | null };
  }>;
}

/** Fetches one card's authoritative metadata fresh from the upstream, never from client-supplied stats. */
export async function fetchBattleTokenMetadata(
  address: string,
  contractAddress: string,
  tokenId: string,
): Promise<MetadataResult> {
  const cardKey = `${contractAddress}:${tokenId}`;
  try {
    const query = `
      query SingleTokenMetadata($address: String!, $contract: String!, $tokenId: String!) {
        token_holder(
          where: {
            holder_address: { _eq: $address },
            token: { fa_contract: { _eq: $contract }, token_id: { _eq: $tokenId } }
          },
          limit: 1
        ) {
          quantity
          token { supply description }
        }
      }
    `;
    const data = await withTimeout(
      objktClient.request<ObjktSingleTokenResponse>(query, { address, contract: contractAddress, tokenId }),
      UPSTREAM_TIMEOUT_MS,
    );
    const row = data?.token_holder?.[0];
    if (!row) return { status: "not_held" };
    if (Number(row.quantity) <= 0) return { status: "not_held" };

    const editions = resolveEditions(row.token.supply);
    return {
      status: "ok",
      metadata: {
        cardKey,
        contractAddress,
        tokenId,
        seed: deriveBaseSeed(editions, row.token.description),
        source: "objkt",
        observedAt: new Date(),
      },
    };
  } catch (err) {
    console.warn("OBJKT single-token metadata fetch failed:", err);
    return { status: "unavailable" };
  }
}

export type HoldingsPageResult =
  | { status: "ok"; cards: BattleTokenMetadata[]; nextCursor: number | null; complete: boolean }
  | { status: "unavailable" };

interface ObjktHoldingsPageResponse {
  token_holder: Array<{
    quantity: number | string;
    token: { fa_contract: string; token_id: string; supply: number | string | null; description: string | null };
  }>;
}

const PAGE_SIZE = 100;

/**
 * Paginates past fetchUserHoldings' 250-card ceiling using offset-based
 * paging over the same proven query shape. Known limitation (documented,
 * not silently assumed away): offset pagination can skip or repeat a row if
 * the wallet's holdings change between page fetches -- acceptable here
 * because staging deduplicates by card key and promotion only replaces
 * active membership once a full traversal completes; a mid-sync change is
 * caught by the next refresh, not silently presented as complete.
 */
export async function fetchBattleHoldingsPage(
  address: string,
  cursor: number | null,
  pageSize: number = PAGE_SIZE,
): Promise<HoldingsPageResult> {
  const offset = cursor ?? 0;
  try {
    const query = `
      query HoldingsPage($address: String!, $limit: Int!, $offset: Int!) {
        token_holder(
          where: { holder_address: { _eq: $address }, quantity: { _gt: "0" } },
          limit: $limit,
          offset: $offset,
          order_by: [{ token: { fa_contract: asc } }, { token: { token_id: asc } }]
        ) {
          quantity
          token { fa_contract token_id supply description }
        }
      }
    `;
    const data = await withTimeout(
      objktClient.request<ObjktHoldingsPageResponse>(query, { address, limit: pageSize, offset }),
      UPSTREAM_TIMEOUT_MS,
    );
    const rows = data?.token_holder ?? [];
    const cards: BattleTokenMetadata[] = rows.map((row) => ({
      cardKey: `${row.token.fa_contract}:${row.token.token_id}`,
      contractAddress: row.token.fa_contract,
      tokenId: row.token.token_id,
      seed: deriveBaseSeed(resolveEditions(row.token.supply), row.token.description),
      source: "objkt",
      observedAt: new Date(),
    }));
    const complete = rows.length < pageSize;
    return { status: "ok", cards, nextCursor: complete ? null : offset + pageSize, complete };
  } catch (err) {
    console.error("OBJKT holdings page fetch failed:", err);
    return { status: "unavailable" };
  }
}
