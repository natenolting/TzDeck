import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql, resetConnectionForTests } from "./store.ts";

const TEST_WALLET = "tz1TestWallet00000000000000000000000";
const TEST_CARD_KEY = "KT1TestContract00000000000000000000:1";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM wallets WHERE address = ${TEST_WALLET}`;
}

test("a wallet_card_progress row can be created, read, and updated", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${TEST_WALLET})`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source)
      VALUES (${TEST_WALLET}, ${TEST_CARD_KEY}, 0, 5, 120, 'test')
    `;

    const rows = await sql<{ xp: string }>`
      SELECT xp FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].xp), 0);

    await sql`
      UPDATE wallet_card_progress SET xp = xp + 50
      WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    const updated = await sql<{ xp: string }>`
      SELECT xp FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    assert.equal(Number(updated[0].xp), 50);
  } finally {
    await cleanup();
  }
});

test("two concurrent relative-XP updates on the same row both land", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${TEST_WALLET})`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source)
      VALUES (${TEST_WALLET}, ${TEST_CARD_KEY}, 0, 5, 120, 'test')
    `;

    await Promise.all([
      sql`UPDATE wallet_card_progress SET xp = xp + 10 WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}`,
      sql`UPDATE wallet_card_progress SET xp = xp + 20 WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}`,
    ]);

    const rows = await sql<{ xp: string }>`
      SELECT xp FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = ${TEST_CARD_KEY}
    `;
    assert.equal(Number(rows[0].xp), 30, "both concurrent awards must land, neither lost");
  } finally {
    await cleanup();
  }
});

test("a connection failure surfaces a clear error rather than hanging", async () => {
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://bad:bad@localhost:1/doesnotexist";
  resetConnectionForTests();
  try {
    await assert.rejects(async () => {
      const sql = getSql();
      await sql`SELECT 1`;
    });
  } finally {
    process.env.DATABASE_URL = originalUrl;
    resetConnectionForTests();
  }
});
