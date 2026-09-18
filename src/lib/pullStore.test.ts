import assert from "node:assert/strict";
import test from "node:test";

import { getSql } from "@/lib/battle/store";
import {
  DENYLIST_TTL_MS,
  loadDenylist,
  recordExclusions,
  resetDenylistCacheForTests,
  scheduleExclusionWrite,
} from "./pullStore";

const TEST_CONTRACT = "KT1PullFilterTest000000000000000000";
const TEST_CONTRACT_WIDE = "KT1PullFilterWide000000000000000000";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM pull_denylist WHERE fa_contract IN (${TEST_CONTRACT}, ${TEST_CONTRACT_WIDE})`;
  await sql`DELETE FROM pull_exclusions WHERE fa_contract IN (${TEST_CONTRACT}, ${TEST_CONTRACT_WIDE})`;
}

test("pullStore: loadDenylist matches a token-level entry", async () => {
  await cleanup();
  resetDenylistCacheForTests();
  try {
    const sql = getSql();
    await sql`
      INSERT INTO pull_denylist (fa_contract, token_id, reason)
      VALUES (${TEST_CONTRACT}, '42', 'test')
    `;

    const denylist = await loadDenylist();

    assert.equal(denylist.has(TEST_CONTRACT, "42"), true);
    assert.equal(denylist.has(TEST_CONTRACT, "43"), false);
  } finally {
    await cleanup();
    resetDenylistCacheForTests();
  }
});

test("pullStore: a null token_id denylists the whole contract", async () => {
  await cleanup();
  resetDenylistCacheForTests();
  try {
    const sql = getSql();
    await sql`
      INSERT INTO pull_denylist (fa_contract, token_id, reason)
      VALUES (${TEST_CONTRACT_WIDE}, NULL, 'test')
    `;

    const denylist = await loadDenylist();

    assert.equal(denylist.has(TEST_CONTRACT_WIDE, "1"), true);
    assert.equal(denylist.has(TEST_CONTRACT_WIDE, "99999"), true);
  } finally {
    await cleanup();
    resetDenylistCacheForTests();
  }
});

test("pullStore: the denylist is cached for the TTL and refreshed after it", async () => {
  await cleanup();
  resetDenylistCacheForTests();
  try {
    const sql = getSql();
    const start = 1_000_000;

    const before = await loadDenylist(start);
    assert.equal(before.has(TEST_CONTRACT, "42"), false);

    await sql`
      INSERT INTO pull_denylist (fa_contract, token_id, reason)
      VALUES (${TEST_CONTRACT}, '42', 'test')
    `;

    // Inside the TTL: still the cached index, so the new row is invisible.
    const cached = await loadDenylist(start + DENYLIST_TTL_MS - 1);
    assert.equal(cached.has(TEST_CONTRACT, "42"), false);

    // Past the TTL: reloaded.
    const fresh = await loadDenylist(start + DENYLIST_TTL_MS);
    assert.equal(fresh.has(TEST_CONTRACT, "42"), true);
  } finally {
    await cleanup();
    resetDenylistCacheForTests();
  }
});

test("pullStore: loadDenylist degrades to allow-all when the database is unreachable", async () => {
  const originalUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  resetDenylistCacheForTests();
  try {
    const denylist = await loadDenylist();
    assert.equal(denylist.has(TEST_CONTRACT, "42"), false);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    resetDenylistCacheForTests();
  }
});

test("pullStore: recordExclusions upserts one row and counts repeats", async () => {
  await cleanup();
  try {
    const sql = getSql();
    const record = {
      faContract: TEST_CONTRACT,
      tokenId: "7",
      tokenPk: 555,
      reason: "token_flag" as const,
    };

    await recordExclusions([record]);
    await recordExclusions([record]);
    await recordExclusions([record]);

    const rows = await sql<{ hit_count: number; reason: string; token_pk: string | null }>`
      SELECT hit_count, reason, token_pk FROM pull_exclusions
      WHERE fa_contract = ${TEST_CONTRACT} AND token_id = '7'
    `;

    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].hit_count), 3);
    assert.equal(rows[0].reason, "token_flag");
    assert.equal(Number(rows[0].token_pk), 555);
  } finally {
    await cleanup();
  }
});

test("pullStore: recordExclusions with no records touches nothing", async () => {
  await cleanup();
  try {
    await recordExclusions([]);
    const sql = getSql();
    const rows = await sql`SELECT 1 FROM pull_exclusions WHERE fa_contract = ${TEST_CONTRACT}`;
    assert.equal(rows.length, 0);
  } finally {
    await cleanup();
  }
});

test("pullStore: scheduleExclusionWrite falls back to inline work outside a request scope", async () => {
  // `after` throws when there is no request context. This test IS that context,
  // so the fallback path is what runs here.
  await cleanup();
  try {
    scheduleExclusionWrite([
      { faContract: TEST_CONTRACT, tokenId: "11", tokenPk: 111, reason: "denylist" },
    ]);

    // The fallback is fire-and-forget, so give the write a turn to land.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const sql = getSql();
    const rows = await sql`
      SELECT reason FROM pull_exclusions
      WHERE fa_contract = ${TEST_CONTRACT} AND token_id = '11'
    `;
    assert.equal(rows.length, 1);
  } finally {
    await cleanup();
  }
});
