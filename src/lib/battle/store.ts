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
  // A `failed` row marked retryable is NOT terminal -- it must still reach
  // reclaimAttempt (via the "in_progress" branch below), or a transient
  // failure (upstream timeout, rate limit) could never be retried.
  if (row.status === "completed" || (row.status === "failed" && !row.retryable)) {
    return { kind: "terminal", row };
  }
  return { kind: "in_progress", row };
}

/** Read-only lookup by nonce, for replaying a terminal result without reclaiming or mutating anything. */
export async function lookupAttemptByNonce(nonce: string): Promise<AttemptRow | null> {
  const sql = getSql();
  const rows = await sql<AttemptRow>`SELECT * FROM battle_attempts WHERE nonce = ${nonce}`;
  return rows[0] ?? null;
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
// U4c: staged, resumable holdings snapshots. Every staging write is fenced
// against the attempt's own current generation/lease/retry-deadline (0011,
// stage_holdings_page) -- the lease alone does not serialize this: a
// takeover reclaims the ATTEMPT, not the sync row, so the sync needs its own
// check against that same source of truth. Promotion touches shared
// cross-cutting tables and runs through the real plpgsql function above.
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

/**
 * Starts a fresh sync, or resumes one already staged under this exact
 * attempt nonce. A sync whose captured holdings generation no longer
 * matches the wallet's current one (a competing opt-out, or another sync,
 * changed it since this one started) is restarted fresh under the current
 * generation rather than resumed -- promote_holdings_snapshot fences
 * promotion on exactly that comparison, so resuming the old capture
 * unchanged can never promote again; reclaiming the ATTEMPT alone doesn't
 * touch this sync's stale capture. Only one worker ever holds a given sync
 * (the attempt's lease fences that -- see stage_holdings_page, 0011), so no
 * extra locking is needed here.
 */
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
  if (existing.length > 0) {
    const sync = existing[0];
    if (sync.captured_holdings_generation === capturedHoldingsGeneration) {
      return sync;
    }
    const restarted = await sql<HoldingsSyncRow>`
      UPDATE holdings_syncs SET
        captured_holdings_generation = ${capturedHoldingsGeneration},
        staged_cards = '[]'::jsonb,
        cursor = NULL,
        status = 'in_progress',
        worker_generation = ${workerGeneration}::bigint,
        updated_at = now()
      WHERE sync_id = ${syncId}
      RETURNING *
    `;
    return restarted[0];
  }

  const inserted = await sql<HoldingsSyncRow>`
    INSERT INTO holdings_syncs (sync_id, wallet, attempt_nonce, worker_generation, captured_holdings_generation, staged_cards)
    VALUES (${syncId}, ${wallet}, ${attemptNonce}, ${workerGeneration}, ${capturedHoldingsGeneration}, '[]'::jsonb)
    RETURNING *
  `;
  return inserted[0];
}

export interface StagePageResult {
  ok: boolean;
  /** true if this caller is no longer the attempt's current, live, in-window owner -- this call's page was dropped, not applied. */
  stale: boolean;
}

/**
 * Appends a page's cards (deduplicated by card key, first-seen wins),
 * advances the cursor, and optionally marks the sync complete -- all inside
 * one plpgsql call (migrations/0011_stage_holdings_page_attempt_fencing.sql),
 * fenced on the attempt's current generation, pending status, live lease,
 * and retry deadline -- checked atomically with the write -- so a worker
 * superseded by a takeover (or one whose lease simply expired) can never
 * write, even before the newer worker has staged anything itself.
 */
export async function stageHoldingsPage(
  nonce: string,
  syncId: string,
  generation: string,
  newCards: StagedCard[],
  nextCursor: string | null,
  complete: boolean,
): Promise<StagePageResult> {
  const sql = getSql();
  const rows = await sql<{ ok: boolean; stale: boolean }>`
    SELECT * FROM stage_holdings_page(
      ${nonce}, ${syncId}, ${generation}::bigint, ${JSON.stringify(newCards)}::jsonb, ${nextCursor}, ${complete}
    )
  `;
  return rows[0];
}

export interface PromotionResult {
  promoted: boolean;
  newGeneration: number;
}

// ---------------------------------------------------------------------------
// U7: matchmaking candidate pool. This file only fetches the raw eligible
// rows -- opted-in wallets' actively-held cards, excluding the attacker's
// own wallet. It does NOT filter or sort by Power x HP product (that's
// derived from base_seed on read, not a stored sortable column -- Key
// Technical Decisions); all banding/widening/selection happens in rules.ts.
// ---------------------------------------------------------------------------

export interface ProgressRow {
  wallet: string;
  card_key: string;
  xp: string;
  seed_editions: number;
  seed_description_length: number;
  recovery_until: string | null;
  recovery_reason: string | null;
  progress_version: string;
}

export interface WalletRow {
  address: string;
  opted_in: boolean;
  attack_count: number;
  attack_reset_at: string;
  defense_count: number;
  defense_reset_at: string;
  holdings_generation: number;
  holdings_refreshed_at: string | null;
}

export async function fetchWallet(wallet: string): Promise<WalletRow | null> {
  const sql = getSql();
  const rows = await sql<WalletRow>`SELECT * FROM wallets WHERE address = ${wallet}`;
  return rows[0] ?? null;
}

/** Ensures a wallets row exists (opted_in=false, zero caps) without disturbing an existing one. */
export async function ensureWalletExists(wallet: string): Promise<WalletRow> {
  const sql = getSql();
  const rows = await sql<WalletRow>`
    INSERT INTO wallets (address) VALUES (${wallet})
    ON CONFLICT (address) DO UPDATE SET address = wallets.address
    RETURNING *
  `;
  return rows[0];
}

export async function fetchAllProgressForWallet(wallet: string): Promise<ProgressRow[]> {
  const sql = getSql();
  return sql<ProgressRow>`SELECT * FROM wallet_card_progress WHERE wallet = ${wallet} ORDER BY card_key`;
}

export async function fetchProgress(wallet: string, cardKey: string): Promise<ProgressRow | null> {
  const sql = getSql();
  const rows = await sql<ProgressRow>`
    SELECT * FROM wallet_card_progress WHERE wallet = ${wallet} AND card_key = ${cardKey}
  `;
  return rows[0] ?? null;
}

export interface CandidatePoolRow {
  wallet: string;
  card_key: string;
  seed_editions: number;
  seed_description_length: number;
  xp: string;
  recovery_until: string | null;
  progress_version: string;
  defense_count: number;
  defense_reset_at: string;
}

export async function fetchMatchmakingCandidatePool(attackerWallet: string): Promise<CandidatePoolRow[]> {
  const sql = getSql();
  return sql<CandidatePoolRow>`
    SELECT
      p.wallet,
      p.card_key,
      p.seed_editions,
      p.seed_description_length,
      p.xp,
      p.recovery_until,
      p.progress_version,
      w.defense_count,
      w.defense_reset_at
    FROM wallet_card_progress p
    JOIN wallet_holdings h ON h.wallet = p.wallet AND h.card_key = p.card_key
    JOIN wallets w ON w.address = p.wallet
    WHERE w.opted_in = true AND w.address != ${attackerWallet}
  `;
}

// ---------------------------------------------------------------------------
// U8: the battle commit itself. A thin wrapper around the commit_battle
// plpgsql function (migrations/0003_commit_battle.sql) -- all eligibility
// logic, locking, and rollback-on-rejection lives in that function; this is
// just parameter marshaling.
// ---------------------------------------------------------------------------

export interface CommitBattleParams {
  nonce: string;
  generation: string;
  attackerWallet: string;
  attackerCardKey: string;
  /** null means "expected absent" -- a first-use commit-time upsert. */
  attackerExpectedVersion: string | null;
  attackerSeedEditions: number;
  attackerSeedDescriptionLength: number;
  attackerSeedSource: string;
  defenderWallet: string;
  defenderCardKey: string;
  defenderExpectedVersion: string;
  outcome: "win" | "draw";
  winnerWallet: string | null;
  winnerCardKey: string | null;
  loserWallet: string | null;
  loserCardKey: string | null;
  loserRecoveryReason: "offensive" | "defensive" | null;
  baseXpAward: number;
  rulesVersion: string;
  rngSeed: string;
  inputs: unknown;
}

export interface CommitBattleResult {
  /** The exact payload persisted to battle_attempts.response -- a first attempt and a later replay are byte-identical. */
  response: unknown;
  statusCode: number;
}

export async function commitBattle(params: CommitBattleParams): Promise<CommitBattleResult> {
  const sql = getSql();
  const rows = await sql<{ response: unknown; status_code: number }>`
    SELECT * FROM commit_battle(
      ${params.nonce},
      ${params.generation}::bigint,
      ${params.attackerWallet},
      ${params.attackerCardKey},
      ${params.attackerExpectedVersion}::bigint,
      ${params.attackerSeedEditions},
      ${params.attackerSeedDescriptionLength},
      ${params.attackerSeedSource},
      ${params.defenderWallet},
      ${params.defenderCardKey},
      ${params.defenderExpectedVersion}::bigint,
      ${params.outcome},
      ${params.winnerWallet},
      ${params.winnerCardKey},
      ${params.loserWallet},
      ${params.loserCardKey},
      ${params.loserRecoveryReason},
      ${params.baseXpAward},
      ${params.rulesVersion},
      ${params.rngSeed},
      ${JSON.stringify(params.inputs)}::jsonb
    )
  `;
  const row = rows[0];
  return { response: row.response, statusCode: row.status_code };
}

/**
 * Application-layer request budget, independent of the daily attack/defense
 * caps -- Vercel's own WAF rate-limit rule is IP-keyed and shared across all
 * of /api (project memory), so a single wallet or caller within that budget
 * still needs its own narrower fence (U9/U10). One atomic DB call
 * (migrations/0007_rate_limits.sql); the window resets in place.
 */
export async function checkRateLimit(key: string, windowSeconds: number, maxRequests: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql<{ check_rate_limit: boolean }>`
    SELECT check_rate_limit(${key}, ${windowSeconds}, ${maxRequests}) AS check_rate_limit
  `;
  return rows[0].check_rate_limit;
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

export async function commitParticipation(
  nonce: string, generation: string, wallet: string, paramHash: string,
  optedIn: boolean, syncId: string | null,
): Promise<{ response: unknown; status_code: number }> {
  const sql = getSql();
  const [result] = await sql<{ response: unknown; status_code: number }>`
    SELECT * FROM commit_participation(${nonce}, ${generation}::bigint, ${wallet}, ${paramHash}, ${optedIn}, ${syncId})
  `;
  return result;
}

/** Refresh's atomic promote+complete -- never touches wallets.opted_in, unlike commitParticipation. */
export async function commitHoldingsRefresh(
  nonce: string, generation: string, wallet: string, paramHash: string, syncId: string,
): Promise<{ response: unknown; status_code: number }> {
  const sql = getSql();
  const [result] = await sql<{ response: unknown; status_code: number }>`
    SELECT * FROM commit_holdings_refresh(${nonce}, ${generation}::bigint, ${wallet}, ${paramHash}, ${syncId})
  `;
  return result;
}
