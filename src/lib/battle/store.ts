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
