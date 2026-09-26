import { after } from "next/server";

import { getSql } from "@/lib/battle/store";
import { cardKey } from "./cardKey";
import { ALLOW_ALL, type DenylistIndex, type ExclusionRecord } from "./pullFilter";

/**
 * Database edge for pull filtering. See docs/pull-filter-spec.md.
 *
 * Note that getSql lives under lib/battle/ for historical reasons; it is
 * general-purpose infrastructure, not battle-specific. Moving it would churn
 * the 25 files that already import it, for no behavioural gain.
 */

export const DENYLIST_TTL_MS = 60_000;

let cached: { index: DenylistIndex; loadedAt: number } | null = null;

/** Test-only: drop the cached denylist so the next load hits the database. */
export function resetDenylistCacheForTests(): void {
  cached = null;
}

/**
 * Loads the denylist into an in-memory index, cached for DENYLIST_TTL_MS so a
 * pack draw costs no database round trip on the hot path. An addition takes
 * effect within a minute across instances without a deploy.
 *
 * Never throws. /api/random-pack works with no database at all -- DATABASE_URL
 * is scoped to battling -- so a database failure degrades the filter to the
 * three OBJKT rules rather than failing the pack. The three rules are where
 * nearly all the protection is; the denylist is a manual override on top.
 */
export async function loadDenylist(now: number = Date.now()): Promise<DenylistIndex> {
  if (cached && now - cached.loadedAt < DENYLIST_TTL_MS) return cached.index;

  try {
    const sql = getSql();
    const rows = await sql<{ fa_contract: string; token_id: string | null }>`
      SELECT fa_contract, token_id FROM pull_denylist
    `;

    const contracts = new Set<string>();
    const tokens = new Set<string>();
    for (const row of rows) {
      if (row.token_id === null) contracts.add(row.fa_contract);
      else tokens.add(cardKey(row.fa_contract, row.token_id));
    }

    const index: DenylistIndex = {
      has: (faContract, tokenId) =>
        contracts.has(faContract) || tokens.has(cardKey(faContract, tokenId)),
    };

    cached = { index, loadedAt: now };
    return index;
  } catch (err) {
    console.error("Pull denylist unavailable, falling back to OBJKT rules only:", err);
    return ALLOW_ALL;
  }
}

/**
 * Records what the filter removed. Called from `after()`, so it runs once the
 * response has been sent and never adds latency to a draw.
 *
 * The Sql shape is one statement per call, so this loops rather than batching.
 * A draw excludes well under one listing on average, so the loop is short.
 */
export async function recordExclusions(records: readonly ExclusionRecord[]): Promise<void> {
  if (records.length === 0) return;

  const sql = getSql();
  for (const record of records) {
    await sql`
      SELECT record_pull_exclusion(
        ${record.faContract}, ${record.tokenId}, ${record.tokenPk}, ${record.reason}
      )
    `;
  }
}

/**
 * Records exclusions once the response has been sent, so an audit trail never
 * makes a draw slower.
 *
 * `after` throws when there is no request scope -- unit tests, scripts. There is
 * no response to defer past in that case, so the work runs inline instead. The
 * catch is deliberately broad: every failure mode of `after` degrades to "run it
 * now on the current path", which is slower but still correct.
 */
export function scheduleExclusionWrite(records: readonly ExclusionRecord[]): void {
  if (records.length === 0) return;

  const work = async () => {
    try {
      await recordExclusions(records);
    } catch (error) {
      console.error("Failed to record pull exclusions:", error);
    }
  };

  try {
    after(work);
  } catch {
    void work();
  }
}
