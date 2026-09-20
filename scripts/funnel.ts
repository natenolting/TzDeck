// Read-only report on the launch bar against DATABASE_URL. Every statement is
// a SELECT -- nothing is written, nothing is deleted -- so this is safe to
// point at production. Run by hand; never part of CI or tests.
//
// The bar, set in issue #68: 30 wallets each battling on two separate days,
// within 30 days of launch. The definitions live in the SQL below rather than
// in prose, so they cannot drift away from what the app actually does.
import { readFileSync } from "node:fs";

import { Pool } from "pg";

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 30);
const TARGET_WALLETS = Number(process.env.TARGET_WALLETS ?? 30);
const TARGET_DAYS = Number(process.env.TARGET_DAYS ?? 2);

/**
 * A battle counts for the wallet that *attacked*.
 *
 * `battle_log.attacker_wallet` is always the player, in a win and in a loss.
 * Defending is deliberately excluded: a defender is chosen by someone else and
 * may never have opened the app that day, so counting it would credit people
 * who did nothing.
 *
 * `commit_trainer_battle` (migration 0016) writes `defender_wallet` as
 * 'trainer:' || tier, and a Tezos address is always tz1/tz2/tz3/KT1, so the
 * prefix cannot collide with a real wallet.
 */
const IS_TRAINER = "defender_wallet LIKE 'trainer:%'";

/**
 * Days are UTC, matching `date_trunc('day', now())` in commit_battle's daily
 * attack limit. Two definitions of "day" in one codebase is a bug waiting.
 */
const ACTIVE_DAY = "date_trunc('day', settled_at AT TIME ZONE 'UTC')";


/**
 * Where the connection string came from, so a run can never be ambiguous
 * about which database it read.
 *
 * An explicit DATABASE_URL always wins, because that is how production is
 * reached and it should stay a deliberate act. `.env.local` is the fallback,
 * so the common local case needs no ceremony.
 */
function resolveDatabaseUrl(): { url: string; source: string } {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return { url: fromEnv, source: "DATABASE_URL" };

  let file: string;
  try {
    file = readFileSync(".env.local", "utf8");
  } catch {
    throw new Error(
      "DATABASE_URL is required to read the funnel. Set it, or add it to .env.local.",
    );
  }

  const line = file.split(new RegExp("\r?\n")).find((l) => l.startsWith("DATABASE_URL="));
  const url = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
  if (!url) {
    throw new Error("DATABASE_URL is required to read the funnel, and .env.local does not set it.");
  }
  return { url, source: ".env.local" };
}

/** Host only. The connection string carries a password and must never be printed. */
function describe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable host)";
  }
}

/**
 * Pins the SSL mode the driver is already using, rather than inheriting it.
 *
 * pg treats sslmode=prefer, require and verify-ca as aliases for verify-full
 * today and warns, at length, that a future major will give them libpq
 * semantics instead, which are weaker. Saying verify-full outright keeps the
 * behaviour this connection already has when that day comes, and takes nine
 * lines of warning off a report meant to be read daily.
 */
function pinSslMode(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const aliased = ["prefer", "require", "verify-ca"];
  if (aliased.includes(parsed.searchParams.get("sslmode") ?? "")) {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}
async function main() {
  const { url, source } = resolveDatabaseUrl();
  console.log(`reading ${describe(url)} (from ${source})
`);

  const pool = new Pool({ connectionString: pinSslMode(url) });
  try {
    console.log(`-- the bar: ${TARGET_WALLETS} wallets attacking on ${TARGET_DAYS}+ separate UTC days in ${WINDOW_DAYS} days --`);
    const bar = await pool.query<{ scope: string; wallets: string }>(
      `
      WITH active AS (
        SELECT attacker_wallet AS wallet,
               ${ACTIVE_DAY} AS day,
               ${IS_TRAINER} AS trainer
        FROM battle_log
        WHERE settled_at > now() - ($1 || ' days')::interval
      )
      SELECT scope, count(*)::text AS wallets FROM (
        SELECT 'any battle' AS scope, wallet FROM active
          GROUP BY wallet HAVING count(DISTINCT day) >= $2
        UNION ALL
        SELECT 'player vs player only', wallet FROM active WHERE NOT trainer
          GROUP BY wallet HAVING count(DISTINCT day) >= $2
        UNION ALL
        SELECT 'trainers only', wallet FROM active WHERE trainer
          GROUP BY wallet HAVING count(DISTINCT day) >= $2
      ) q GROUP BY scope ORDER BY scope
      `,
      [WINDOW_DAYS, TARGET_DAYS],
    );
    if (bar.rows.length === 0) {
      console.log("no wallet has attacked on two separate days yet");
    }
    for (const row of bar.rows) {
      const n = Number(row.wallets);
      const verdict = row.scope === "any battle" ? (n >= TARGET_WALLETS ? "  MET" : `  ${TARGET_WALLETS - n} short`) : "";
      console.log(`${row.scope.padEnd(24)} ${n}${verdict}`);
    }

    console.log("\n-- today: wallets that attacked at all this UTC day --");
    const today = await pool.query<{ all: string; pvp: string; trainer: string }>(
      `
      SELECT count(DISTINCT attacker_wallet)::text AS all,
             count(DISTINCT attacker_wallet) FILTER (WHERE NOT ${IS_TRAINER})::text AS pvp,
             count(DISTINCT attacker_wallet) FILTER (WHERE ${IS_TRAINER})::text AS trainer
      FROM battle_log
      WHERE ${ACTIVE_DAY} = date_trunc('day', now() AT TIME ZONE 'UTC')
      `,
    );
    const t = today.rows[0];
    console.log(`attacked today: ${t.all}   of which player vs player: ${t.pvp}, trainers: ${t.trainer}`);

    console.log(`\n-- wallets created in the last ${WINDOW_DAYS} days --`);
    const created = await pool.query<{ recent: string; total: string; opted_in: string }>(
      `
      SELECT count(*) FILTER (WHERE created_at > now() - ($1 || ' days')::interval)::text AS recent,
             count(*)::text AS total,
             count(*) FILTER (WHERE opted_in)::text AS opted_in
      FROM wallets
      `,
      [WINDOW_DAYS],
    );
    const c = created.rows[0];
    console.log(`created in window: ${c.recent}   all time: ${c.total}   opted in: ${c.opted_in}`);

    // A wallets row appears on opt-in or first battle, never on connect. So the
    // gap between the anonymous wallet_connected count in Vercel Analytics and
    // this number is how many people connected and then stopped. It cannot be
    // computed here: the two live in different systems on purpose.
    console.log(`\ncompare "all time" above against the wallet_connected count in Vercel Analytics.`);
    console.log(`the difference is people who connected a wallet and never opted in.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
