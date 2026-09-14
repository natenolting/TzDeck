// Applies migrations/*.sql in filename order against DATABASE_URL, tracking
// applied files and their checksums in a `schema_migrations` table so
// re-running is a no-op. A run holds a session advisory lock for its whole
// duration, so two concurrent runs cannot apply the same file. An edited
// already-applied file (drift) or a ledger row whose file is gone (orphaned)
// aborts the run before anything is written. `--status` / `--dry-run` reads the
// ledger and prints the plan without locking or writing.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

import {
  checksum,
  planMigrations,
  type DiskMigration,
  type LedgerRow,
  type PlanStep,
} from "./migrate-plan";

const MIGRATION_ADVISORY_LOCK_KEY = "7735492100013";
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

function readDiskMigrations(dir: string): DiskMigration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), "utf8");
      return { filename, sql, checksum: checksum(sql) };
    });
}

// A dry run must not write, so it cannot create the ledger or add the checksum
// column: a database that predates either is reported as if those rows were
// unrecorded/unchecksummed rather than crashing the status output.
async function readLedger(db: Pool | PoolClient): Promise<LedgerRow[]> {
  try {
    const { rows } = await db.query<LedgerRow>("SELECT filename, checksum FROM schema_migrations");
    return rows;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === UNDEFINED_TABLE) return [];
    if (code === UNDEFINED_COLUMN) {
      const { rows } = await db.query<LedgerRow>(
        "SELECT filename, NULL::text AS checksum FROM schema_migrations",
      );
      return rows;
    }
    throw err;
  }
}

function printPlan(plan: PlanStep[]) {
  for (const step of plan) {
    switch (step.kind) {
      case "apply":
        console.log(`pending: ${step.migration.filename}`);
        break;
      case "skip":
        console.log(`skip (already applied): ${step.filename}`);
        break;
      case "adopt":
        console.log(`adopt (recording checksum for a pre-checksum row): ${step.migration.filename}`);
        break;
      case "drift":
        console.error(
          `drift: ${step.filename} was applied as ${step.recorded} but is now ${step.actual}`,
        );
        break;
      case "orphaned":
        console.error(`orphaned: ${step.filename} is recorded in schema_migrations but missing from disk`);
        break;
    }
  }
}

// A status check that exits 0 on drift would hand a caller a false all-clear,
// so both the read-only and the applying path fail on the same conditions.
function reportBlocked(plan: PlanStep[], summary: string): boolean {
  const blocked = plan.filter((step) => step.kind === "drift" || step.kind === "orphaned");
  if (blocked.length === 0) return false;
  console.error(`${summary}: ${blocked.length} file(s) disagree with schema_migrations`);
  return true;
}

async function applyMigration(pool: Pool, migration: DiskMigration) {
  console.log(`applying: ${migration.filename}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [migration.filename, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`migration failed: ${migration.filename}: ${(err as Error).message}`);
  } finally {
    client.release();
  }
}

// PgBouncer in transaction mode can hand each statement a different backend, so
// a session-level pg_advisory_lock is taken on one connection and released
// against another: serialization silently stops working and the lock leaks.
// Reads never take the lock, so --status through the pooler is fine.
function poolerHost(databaseUrl: string): string | null {
  try {
    const { hostname } = new URL(databaseUrl);
    return hostname.includes("-pooler.") ? hostname : null;
  } catch {
    return null;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--status");
  const disk = readDiskMigrations(join(import.meta.dirname, "..", "migrations"));

  const pooled = dryRun ? null : poolerHost(databaseUrl);
  if (pooled) {
    throw new Error(
      `refusing to apply through the connection pooler at ${pooled}; ` +
        `re-run against the direct endpoint ${pooled.replace("-pooler.", ".")}`,
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (dryRun) {
      const plan = planMigrations(disk, await readLedger(pool));
      printPlan(plan);
      if (reportBlocked(plan, "schema check failed")) {
        process.exitCode = 1;
      }
      return;
    }

    const lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);

      await lockClient.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await lockClient.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

      const plan = planMigrations(disk, await readLedger(lockClient));
      printPlan(plan);

      if (reportBlocked(plan, "refusing to migrate; nothing was applied")) {
        process.exitCode = 1;
        return;
      }

      for (const step of plan) {
        if (step.kind === "adopt") {
          await lockClient.query("UPDATE schema_migrations SET checksum = $1 WHERE filename = $2", [
            step.migration.checksum,
            step.migration.filename,
          ]);
          console.log(`adopted: ${step.migration.filename}`);
        } else if (step.kind === "apply") {
          await applyMigration(pool, step.migration);
        }
      }

      console.log("migrations up to date");
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
      lockClient.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
