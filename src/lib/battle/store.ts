import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

/**
 * A single-statement SQL executor, shaped to match `@neondatabase/serverless`'s
 * `neon()` tagged-template interface. In production this *is* `neon()` --
 * Key Technical Decisions commits to the HTTP driver specifically to avoid
 * Vercel Fluid Compute's unsettled connection-pooling guidance. Neon's HTTP
 * gateway only exists for `*.neon.tech` endpoints, so local development and
 * tests against a plain Postgres instance (e.g. Docker) use a thin `pg.Pool`
 * shim with the same call signature instead -- this never touches the
 * production code path and does not reintroduce the pooling ambiguity the
 * HTTP driver was chosen to sidestep, since that concern is specific to
 * Vercel's serverless runtime, not a local test run.
 */
export type Sql = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

function isNeonHost(databaseUrl: string): boolean {
  return /neon\.tech/.test(databaseUrl);
}

let cachedSql: Sql | null = null;
let cachedPool: Pool | null = null;

export function getSql(): Sql {
  if (cachedSql) return cachedSql;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  if (isNeonHost(databaseUrl)) {
    cachedSql = neon(databaseUrl) as unknown as Sql;
    return cachedSql;
  }

  cachedPool = new Pool({ connectionString: databaseUrl });
  const pool = cachedPool;
  cachedSql = (async (strings, ...values) => {
    let text = strings[0];
    const params: unknown[] = [];
    for (let i = 0; i < values.length; i += 1) {
      params.push(values[i]);
      text += `$${params.length}${strings[i + 1]}`;
    }
    const result = await pool.query(text, params);
    return result.rows;
  }) as Sql;
  return cachedSql;
}

/** Test-only: drop the cached connection so a fresh DATABASE_URL takes effect. */
export function resetConnectionForTests(): void {
  cachedSql = null;
  if (cachedPool) {
    void cachedPool.end();
    cachedPool = null;
  }
}

// ---------------------------------------------------------------------------
// U1b: fenced attempt claims and recovery
// ---------------------------------------------------------------------------
//
// `battle_attempts` is the single state machine every wallet-attributed write
// (battle commit, participation change, holdings refresh) fences itself
// against. Every transition below compares `generation` so a worker that
// lost its lease (crash, timeout) can never mutate state a newer worker has
// since taken over, and every completed/failed row is immutable once set.

export const NONCE_FRESHNESS_MS = 5 * 60 * 1000;
export const RETRY_HORIZON_MS = 15 * 60 * 1000;
export const LEASE_DURATION_MS = 60 * 1000;
export const LEASE_RENEWAL_INTERVAL_MS = 20 * 1000;
export const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AttemptIdentity {
  wallet: string;
  action: string;
  paramHash: string;
}

export type AttemptStatus = "pending" | "completed" | "failed";

export interface AttemptRow {
  nonce: string;
  wallet: string;
  action: string;
  param_hash: string;
  issued_at: string;
  first_claimed_at: string | null;
  retry_until: string;
  status: AttemptStatus;
  generation: string;
  lease_expires_at: string | null;
  retryable: boolean | null;
  response: unknown;
  status_code: number | null;
  completed_at: string | null;
}

export type ClaimResult =
  | { kind: "claimed"; row: AttemptRow }
  | { kind: "identity_mismatch"; row: AttemptRow }
  | { kind: "in_progress"; row: AttemptRow }
  | { kind: "terminal"; row: AttemptRow }
  | { kind: "expired" };

/**
 * Claim a nonce as the start of a new attempt, or resolve what an existing
 * row for that nonce means for this caller. Never claims across a mismatched
 * identity -- a nonce found with a *different* wallet/action/param_hash never
 * returns that identity's result.
 */
export async function claimOrLookupAttempt(
  nonce: string,
  identity: AttemptIdentity,
  issuedAt: Date,
): Promise<ClaimResult> {
  const sql = getSql();
  const now = new Date();
  const retryUntil = new Date(now.getTime() + RETRY_HORIZON_MS);

  const inserted = await sql<AttemptRow>`
    INSERT INTO battle_attempts (nonce, wallet, action, param_hash, issued_at, first_claimed_at, retry_until, status, generation, lease_expires_at)
    VALUES (${nonce}, ${identity.wallet}, ${identity.action}, ${identity.paramHash}, ${issuedAt.toISOString()}, ${now.toISOString()}, ${retryUntil.toISOString()}, 'pending', 0, ${new Date(now.getTime() + LEASE_DURATION_MS).toISOString()})
    ON CONFLICT (nonce) DO NOTHING
    RETURNING *
  `;
  if (inserted.length > 0) {
    return { kind: "claimed", row: inserted[0] };
  }

  const existingRows = await sql<AttemptRow>`SELECT * FROM battle_attempts WHERE nonce = ${nonce}`;
  if (existingRows.length === 0) {
    // Lost the insert race to a concurrent claim that hasn't committed yet
    // in a visible snapshot; treat as in-flight, not absent.
    return { kind: "expired" };
  }
  const row = existingRows[0];

  if (row.wallet !== identity.wallet || row.action !== identity.action || row.param_hash !== identity.paramHash) {
    return { kind: "identity_mismatch", row };
  }
  if (row.status === "completed" || row.status === "failed") {
    return { kind: "terminal", row };
  }
  return { kind: "in_progress", row };
}

/**
 * Reclaim a `pending` attempt whose lease has expired, or a `failed` attempt
 * marked retryable, as a fresh generation -- but only within the original
 * retry horizon. Never extends `retry_until`. Two simultaneous reclaimers
 * race on this single atomic UPDATE; only one can match and increment
 * `generation`.
 */
export async function reclaimAttempt(
  nonce: string,
  identity: AttemptIdentity,
): Promise<{ generation: string } | null> {
  const sql = getSql();
  const newLeaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const rows = await sql<{ generation: string }>`
    UPDATE battle_attempts
    SET status = 'pending',
        generation = generation + 1,
        lease_expires_at = ${newLeaseExpiresAt}
    WHERE nonce = ${nonce}
      AND wallet = ${identity.wallet} AND action = ${identity.action} AND param_hash = ${identity.paramHash}
      AND retry_until > now()
      AND ((status = 'pending' AND lease_expires_at < now())
           OR (status = 'failed' AND retryable = true))
    RETURNING generation
  `;
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Renew an in-flight worker's lease. Requires the exact generation it
 * currently holds; a worker whose lease already expired (superseded by a
 * reclaim) can never renew its way back into ownership.
 */
export async function renewLease(nonce: string, generation: string): Promise<boolean> {
  const sql = getSql();
  const newLeaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const rows = await sql`
    UPDATE battle_attempts
    SET lease_expires_at = ${newLeaseExpiresAt}
    WHERE nonce = ${nonce} AND generation = ${generation}
      AND status = 'pending' AND lease_expires_at > now() AND retry_until > now()
    RETURNING nonce
  `;
  return rows.length > 0;
}

/** Release a lease early after a bounded work slice, without marking failure. */
export async function releaseLeaseForContinuation(nonce: string, generation: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE battle_attempts
    SET lease_expires_at = now()
    WHERE nonce = ${nonce} AND generation = ${generation} AND status = 'pending' AND lease_expires_at > now()
    RETURNING nonce
  `;
  return rows.length > 0;
}

export async function completeAttempt(
  nonce: string,
  generation: string,
  response: unknown,
  statusCode: number,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE battle_attempts
    SET status = 'completed', response = ${JSON.stringify(response)}::jsonb, status_code = ${statusCode}, completed_at = now()
    WHERE nonce = ${nonce} AND generation = ${generation} AND status = 'pending'
    RETURNING nonce
  `;
  return rows.length > 0;
}

/** Never overwrites a completed result or a newer generation's state. */
export async function failAttempt(
  nonce: string,
  generation: string,
  response: unknown,
  statusCode: number,
  retryable: boolean,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE battle_attempts
    SET status = 'failed', response = ${JSON.stringify(response)}::jsonb, status_code = ${statusCode}, retryable = ${retryable}
    WHERE nonce = ${nonce} AND generation = ${generation} AND status != 'completed'
    RETURNING nonce
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// U4c: staged, resumable holdings snapshots. Staging writes are serialized by
// the attempt's own lease (only one worker holds it at a time), so no extra
// DB-level locking is needed there; promotion touches shared cross-cutting
// tables and runs through the real plpgsql function above.
// ---------------------------------------------------------------------------

export interface StagedCard {
  cardKey: string;
  contractAddress: string;
  tokenId: string;
  seed: { editions: number; descriptionLength: number };
  source: string;
}

export interface HoldingsSyncRow {
  sync_id: string;
  wallet: string;
  attempt_nonce: string;
  worker_generation: string;
  captured_holdings_generation: number;
  cursor: string | null;
  status: "in_progress" | "complete" | "stale";
  staged_cards: StagedCard[];
}

/** Starts a fresh sync, or resumes one already staged under this exact attempt nonce. */
export async function startOrResumeHoldingsSync(
  syncId: string,
  wallet: string,
  attemptNonce: string,
  workerGeneration: string,
  capturedHoldingsGeneration: number,
): Promise<HoldingsSyncRow> {
  const sql = getSql();
  const existing = await sql<HoldingsSyncRow>`
    SELECT * FROM holdings_syncs WHERE sync_id = ${syncId}
  `;
  if (existing.length > 0) return existing[0];

  const inserted = await sql<HoldingsSyncRow>`
    INSERT INTO holdings_syncs (sync_id, wallet, attempt_nonce, worker_generation, captured_holdings_generation, staged_cards)
    VALUES (${syncId}, ${wallet}, ${attemptNonce}, ${workerGeneration}, ${capturedHoldingsGeneration}, '[]'::jsonb)
    RETURNING *
  `;
  return inserted[0];
}

/** Appends a page's cards, deduplicated by card key (first-seen wins), and advances the cursor. */
export async function stageHoldingsPage(
  syncId: string,
  newCards: StagedCard[],
  nextCursor: string | null,
): Promise<void> {
  const sql = getSql();
  const rows = await sql<{ staged_cards: StagedCard[] }>`
    SELECT staged_cards FROM holdings_syncs WHERE sync_id = ${syncId}
  `;
  const existingCards = rows[0]?.staged_cards ?? [];
  const seenKeys = new Set(existingCards.map((c) => c.cardKey));
  const merged = [...existingCards];
  for (const card of newCards) {
    if (!seenKeys.has(card.cardKey)) {
      merged.push(card);
      seenKeys.add(card.cardKey);
    }
  }

  await sql`
    UPDATE holdings_syncs
    SET staged_cards = ${JSON.stringify(merged)}::jsonb, cursor = ${nextCursor}, updated_at = now()
    WHERE sync_id = ${syncId}
  `;
}

export async function markHoldingsSyncComplete(syncId: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE holdings_syncs SET status = 'complete', updated_at = now() WHERE sync_id = ${syncId}`;
}

export interface PromotionResult {
  promoted: boolean;
  newGeneration: number;
}

/** Only a fully-traversed (status = 'complete') snapshot may be promoted. */
export async function promoteHoldingsSnapshot(syncId: string): Promise<PromotionResult> {
  const sql = getSql();
  const syncRows = await sql<HoldingsSyncRow>`SELECT * FROM holdings_syncs WHERE sync_id = ${syncId}`;
  const sync = syncRows[0];
  if (!sync) throw new Error(`holdings sync not found: ${syncId}`);
  if (sync.status !== "complete") {
    throw new Error(`cannot promote an incomplete holdings sync: ${syncId}`);
  }

  const rows = await sql<{ promoted: boolean; new_generation: number }>`
    SELECT * FROM promote_holdings_snapshot(
      ${sync.wallet},
      ${sync.captured_holdings_generation},
      ${JSON.stringify(sync.staged_cards)}::jsonb
    )
  `;
  return { promoted: rows[0].promoted, newGeneration: rows[0].new_generation };
}
