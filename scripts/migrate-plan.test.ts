import assert from "node:assert/strict";
import test from "node:test";

import { checksum, planMigrations, type DiskMigration, type LedgerRow } from "./migrate-plan";

function migration(filename: string, sql: string): DiskMigration {
  return { filename, sql, checksum: checksum(sql) };
}

function applied(migration: DiskMigration): LedgerRow {
  return { filename: migration.filename, checksum: migration.checksum };
}

test("checksum: stable for the same input and different for differing input", () => {
  assert.equal(checksum("SELECT 1;"), checksum("SELECT 1;"));
  assert.notEqual(checksum("SELECT 1;"), checksum("SELECT 2;"));
  assert.match(checksum("SELECT 1;"), /^[0-9a-f]{64}$/);
});

test("fresh database: an empty ledger makes every disk migration an apply, in filename order", () => {
  const disk = [
    migration("001_init.sql", "CREATE TABLE a ();"),
    migration("002_cards.sql", "CREATE TABLE b ();"),
  ];

  const plan = planMigrations(disk, []);

  assert.deepEqual(plan, [
    { kind: "apply", migration: disk[0] },
    { kind: "apply", migration: disk[1] },
  ]);
});

test("fully applied: every recorded file with a matching checksum is a skip", () => {
  const disk = [
    migration("001_init.sql", "CREATE TABLE a ();"),
    migration("002_cards.sql", "CREATE TABLE b ();"),
  ];

  const plan = planMigrations(disk, disk.map(applied));

  assert.deepEqual(plan, [
    { kind: "skip", filename: "001_init.sql" },
    { kind: "skip", filename: "002_cards.sql" },
  ]);
});

test("drift: an edited file that was already applied reports the recorded and actual checksums", () => {
  const original = migration("001_init.sql", "CREATE TABLE a ();");
  const edited = migration("001_init.sql", "CREATE TABLE a (id int);");

  const plan = planMigrations([edited], [applied(original)]);

  assert.deepEqual(plan, [
    {
      kind: "drift",
      filename: "001_init.sql",
      recorded: original.checksum,
      actual: edited.checksum,
    },
  ]);
});

test("NULL checksum: a row predating checksum tracking adopts rather than drifting or skipping", () => {
  const disk = migration("001_init.sql", "CREATE TABLE a ();");

  const plan = planMigrations([disk], [{ filename: "001_init.sql", checksum: null }]);

  assert.deepEqual(plan, [{ kind: "adopt", migration: disk }]);
});

test("orphaned: a ledger row with no file on disk is reported, not silently ignored", () => {
  const disk = migration("001_init.sql", "CREATE TABLE a ();");

  const plan = planMigrations([disk], [applied(disk), { filename: "000_deleted.sql", checksum: "abc" }]);

  assert.deepEqual(plan, [
    { kind: "skip", filename: "001_init.sql" },
    { kind: "orphaned", filename: "000_deleted.sql" },
  ]);
});

test("ordering: shuffled input comes back filename-ascending with orphaned entries last", () => {
  const c = migration("003_battles.sql", "CREATE TABLE c ();");
  const a = migration("001_init.sql", "CREATE TABLE a ();");
  const b = migration("002_cards.sql", "CREATE TABLE b ();");

  const plan = planMigrations(
    [c, a, b],
    [
      { filename: "009_gone.sql", checksum: "zzz" },
      applied(b),
      { filename: "000_also_gone.sql", checksum: "yyy" },
      applied(a),
    ],
  );

  assert.deepEqual(
    plan.map((step) => [step.kind, step.kind === "apply" || step.kind === "adopt" ? step.migration.filename : step.filename]),
    [
      ["skip", "001_init.sql"],
      ["skip", "002_cards.sql"],
      ["apply", "003_battles.sql"],
      ["orphaned", "000_also_gone.sql"],
      ["orphaned", "009_gone.sql"],
    ],
  );
});

test("planMigrations: does not mutate the caller's arrays", () => {
  const disk = [
    migration("002_cards.sql", "CREATE TABLE b ();"),
    migration("001_init.sql", "CREATE TABLE a ();"),
  ];
  const ledger: LedgerRow[] = [
    { filename: "009_gone.sql", checksum: "zzz" },
    applied(disk[1]),
  ];

  planMigrations(disk, ledger);

  assert.deepEqual(disk.map((m) => m.filename), ["002_cards.sql", "001_init.sql"]);
  assert.deepEqual(ledger.map((r) => r.filename), ["009_gone.sql", "001_init.sql"]);
});
