// Read-only report on table sizes and staleness against DATABASE_URL. Every
// statement here is a SELECT -- nothing is written, nothing is deleted. Meant
// to be run by hand, locally against the dev database or via the
// db-health-check workflow against production, never as part of CI or tests.
import { Pool } from "pg";

interface TableCount {
  table: string;
  rows: number;
}

async function countRows(pool: Pool, table: string): Promise<TableCount> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return { table, rows: Number(rows[0].n) };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the health check");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    console.log("-- row counts --");
    for (const table of [
      "wallets",
      "wallet_card_progress",
      "battle_attempts",
      "battle_log",
      "wallet_holdings",
      "holdings_syncs",
      "rate_limits",
    ]) {
      const { rows } = await countRows(pool, table);
      console.log(`${table}: ${rows}`);
    }

    console.log("\n-- battle_log retention (0014 sweeps rows older than 30 days) --");
    const battleLogAge = await pool.query<{ oldest: string | null; older_than_30d: string }>(`
      SELECT min(settled_at) AS oldest,
             count(*) FILTER (WHERE settled_at <= now() - interval '30 days') AS older_than_30d
      FROM battle_log
    `);
    console.log(`oldest settled_at: ${battleLogAge.rows[0].oldest ?? "(no rows)"}`);
    console.log(`rows past the 30-day retention window: ${battleLogAge.rows[0].older_than_30d}`);

    console.log("\n-- battle_attempts stuck past their own retry_until, still pending --");
    const stuckAttempts = await pool.query<{ action: string; n: string }>(`
      SELECT action, count(*) AS n
      FROM battle_attempts
      WHERE status = 'pending' AND retry_until <= now()
      GROUP BY action
      ORDER BY action
    `);
    if (stuckAttempts.rows.length === 0) {
      console.log("none");
    } else {
      for (const row of stuckAttempts.rows) console.log(`${row.action}: ${row.n}`);
    }

    console.log("\n-- holdings_syncs stuck in_progress for over an hour --");
    const stuckSyncs = await pool.query<{ n: string }>(`
      SELECT count(*) AS n FROM holdings_syncs
      WHERE status = 'in_progress' AND updated_at <= now() - interval '1 hour'
    `);
    console.log(stuckSyncs.rows[0].n);

    console.log("\n-- rate_limits past their own 1-day sweep window (0012) --");
    const staleRateLimits = await pool.query<{ n: string }>(`
      SELECT count(*) AS n FROM rate_limits WHERE window_started_at <= now() - interval '1 day'
    `);
    console.log(staleRateLimits.rows[0].n);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
