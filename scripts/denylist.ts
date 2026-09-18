// Manages the pull_denylist table (docs/pull-filter-spec.md). Run by hand; the
// spec deliberately has no admin route or UI for v1. Uses pg.Pool directly, the
// same way db-health-check.ts does, rather than the app's Sql shim.
import { Pool } from "pg";

import { parseDenylistArgs } from "./denylist-args";

async function main() {
  const command = parseDenylistArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to manage the denylist");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    if (command.kind === "list") {
      const { rows } = await pool.query<{
        fa_contract: string;
        token_id: string | null;
        reason: string;
        added_at: Date;
      }>(`SELECT fa_contract, token_id, reason, added_at FROM pull_denylist
          ORDER BY added_at DESC`);

      if (rows.length === 0) {
        console.log("Denylist is empty.");
        return;
      }
      for (const row of rows) {
        const target = row.token_id === null
          ? `${row.fa_contract} (whole contract)`
          : `${row.fa_contract}:${row.token_id}`;
        console.log(`${target} -- ${row.reason} (${row.added_at.toISOString()})`);
      }
      return;
    }

    if (command.kind === "add") {
      await pool.query(
        `INSERT INTO pull_denylist (fa_contract, token_id, reason, added_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fa_contract, COALESCE(token_id, '')) DO UPDATE
           SET reason = EXCLUDED.reason, added_by = EXCLUDED.added_by`,
        [command.faContract, command.tokenId, command.reason, process.env.USER ?? "cli"],
      );
      console.log(`Denylisted ${command.faContract}${command.tokenId ? `:${command.tokenId}` : " (whole contract)"}.`);
      console.log("Takes effect within 60 seconds.");
      return;
    }

    const { rowCount } = await pool.query(
      `DELETE FROM pull_denylist
       WHERE fa_contract = $1 AND COALESCE(token_id, '') = COALESCE($2, '')`,
      [command.faContract, command.tokenId],
    );
    console.log(rowCount === 0 ? "No matching entry." : "Removed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
