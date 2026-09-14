import { createHash } from "node:crypto";

export type DiskMigration = { filename: string; sql: string; checksum: string };

export type LedgerRow = { filename: string; checksum: string | null };

export type PlanStep =
  | { kind: "apply"; migration: DiskMigration }
  | { kind: "skip"; filename: string }
  | { kind: "adopt"; migration: DiskMigration }
  | { kind: "drift"; filename: string; recorded: string; actual: string }
  | { kind: "orphaned"; filename: string };

/**
 * Content hash used to detect edits to an already-applied migration file.
 *
 * @param sql - Raw migration file contents.
 * @returns The SHA-256 digest as lowercase hex.
 */
export function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function byFilename(a: { filename: string }, b: { filename: string }): number {
  if (a.filename < b.filename) return -1;
  if (a.filename > b.filename) return 1;
  return 0;
}

/**
 * Reconciles the migration files on disk against the `schema_migrations` ledger.
 *
 * A file absent from the ledger is `apply`; one recorded with a matching
 * checksum is `skip`; one recorded with a null checksum is `adopt` (the row
 * predates checksum tracking); one recorded with a different checksum is
 * `drift`. A ledger row with no file on disk is `orphaned`.
 *
 * @param disk - Migration files found on disk.
 * @param ledger - Rows read from `schema_migrations`.
 * @returns Disk-derived steps sorted by filename, then orphaned steps sorted by filename.
 */
export function planMigrations(disk: DiskMigration[], ledger: LedgerRow[]): PlanStep[] {
  const recorded = new Map(ledger.map((row) => [row.filename, row]));
  const onDisk = new Set(disk.map((migration) => migration.filename));

  const diskSteps: PlanStep[] = [...disk].sort(byFilename).map((migration) => {
    const row = recorded.get(migration.filename);
    if (!row) return { kind: "apply", migration };
    if (row.checksum === null) return { kind: "adopt", migration };
    if (row.checksum === migration.checksum) return { kind: "skip", filename: migration.filename };
    return {
      kind: "drift",
      filename: migration.filename,
      recorded: row.checksum,
      actual: migration.checksum,
    };
  });

  const orphanedSteps: PlanStep[] = [...ledger]
    .filter((row) => !onDisk.has(row.filename))
    .sort(byFilename)
    .map((row) => ({ kind: "orphaned", filename: row.filename }));

  return [...diskSteps, ...orphanedSteps];
}
