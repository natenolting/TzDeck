import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  getSql,
  promoteHoldingsSnapshot,
  stageHoldingsPage,
  startOrResumeHoldingsSync,
  type StagedCard,
} from "./store";

const TEST_WALLET = "tz1HoldingsTestWallet0000000000000000";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM holdings_syncs WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${TEST_WALLET}`;
  await sql`DELETE FROM wallets WHERE address = ${TEST_WALLET}`;
}

function card(cardKey: string, editions = 5): StagedCard {
  return {
    cardKey,
    contractAddress: cardKey.split(":")[0],
    tokenId: cardKey.split(":")[1],
    seed: { editions, descriptionLength: 50 },
    source: "objkt",
  };
}

async function seedWallet() {
  const sql = getSql();
  await sql`INSERT INTO wallets (address) VALUES (${TEST_WALLET})`;
}

/** holdings_syncs.attempt_nonce FKs to battle_attempts -- a sync is always created under a real claimed attempt. */
async function seedAttempt(nonce: string) {
  const sql = getSql();
  const now = new Date();
  await sql`
    INSERT INTO battle_attempts (nonce, wallet, action, param_hash, issued_at, retry_until)
    VALUES (${nonce}, ${TEST_WALLET}, 'opt-in', 'test', ${now.toISOString()}, ${new Date(now.getTime() + 900_000).toISOString()})
  `;
}

test("holdings promotion: a complete snapshot materializes progress rows and active membership", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1"), card("KT1B:2")], null, true);

    const result = await promoteHoldingsSnapshot(syncId);
    assert.equal(result.promoted, true);
    assert.equal(result.newGeneration, 1);

    const progress = await sql<{ card_key: string }>`SELECT card_key FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} ORDER BY card_key`;
    assert.deepEqual(progress.map((r) => r.card_key), ["KT1A:1", "KT1B:2"]);

    const holdings = await sql<{ card_key: string }>`SELECT card_key FROM wallet_holdings WHERE wallet = ${TEST_WALLET} ORDER BY card_key`;
    assert.deepEqual(holdings.map((r) => r.card_key), ["KT1A:1", "KT1B:2"]);
  } finally {
    await cleanup();
  }
});

test("holdings promotion: never overwrites an already-leveled card's seed, xp, or progress_version", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    // Simulate an already-leveled card from a prior battle.
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source, progress_version)
      VALUES (${TEST_WALLET}, 'KT1A:1', 5000, 1, 500, 'objkt', 7)
    `;

    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    // Re-materialization sees the same card, but with different (fresher, larger) supply data.
    await stageHoldingsPage(syncId, "0", [card("KT1A:1", 999)], null, true);
    await promoteHoldingsSnapshot(syncId);

    const rows = await sql<{ xp: string; seed_editions: number; progress_version: string }>`
      SELECT xp, seed_editions, progress_version FROM wallet_card_progress WHERE wallet = ${TEST_WALLET} AND card_key = 'KT1A:1'
    `;
    assert.equal(Number(rows[0].xp), 5000, "xp must be untouched");
    assert.equal(rows[0].seed_editions, 1, "seed_editions must be untouched, not re-derived from fresh supply");
    assert.equal(Number(rows[0].progress_version), 7, "progress_version must be untouched");
  } finally {
    await cleanup();
  }
});

test("holdings promotion: rejects as stale when the wallet's holdings_generation changed since the snapshot started", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1")], null, true);

    // A competing opt-out (or another sync) bumps the generation before this one promotes.
    await sql`UPDATE wallets SET holdings_generation = holdings_generation + 1 WHERE address = ${TEST_WALLET}`;

    const result = await promoteHoldingsSnapshot(syncId);
    assert.equal(result.promoted, false);

    const progress = await sql`SELECT * FROM wallet_card_progress WHERE wallet = ${TEST_WALLET}`;
    assert.equal(progress.length, 0, "a stale promotion must not write any progress rows");
  } finally {
    await cleanup();
  }
});

test("holdings promotion: refuses to promote an incomplete sync", async () => {
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1")], "50", false); // never marked complete
    await assert.rejects(() => promoteHoldingsSnapshot(syncId));
  } finally {
    await cleanup();
  }
});

test("holdings staging: deduplicates by card key across pages, first-seen wins", async () => {
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1", 5)], "page1", false);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1", 999), card("KT1B:2", 5)], null, true); // duplicate KT1A:1

    const sql = getSql();
    const rows = await sql<{ staged_cards: StagedCard[] }>`SELECT staged_cards FROM holdings_syncs WHERE sync_id = ${syncId}`;
    assert.equal(rows[0].staged_cards.length, 2);
    const cardA = rows[0].staged_cards.find((c) => c.cardKey === "KT1A:1");
    assert.equal(cardA?.seed.editions, 5, "the first-staged version of a duplicate card key should win");
  } finally {
    await cleanup();
  }
});

test("holdings sync: resuming an existing sync id returns the same row rather than restarting", async () => {
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    const first = await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    await stageHoldingsPage(syncId, "0", [card("KT1A:1")], "checkpoint-1", false);

    const resumed = await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "1", 0);
    assert.equal(resumed.sync_id, first.sync_id);
    assert.equal(resumed.cursor, "checkpoint-1", "resuming must see the prior page's checkpoint, not restart from page one");
  } finally {
    await cleanup();
  }
});

test("holdings staging: a superseded worker generation's page write is dropped, not applied", async () => {
  await cleanup();
  try {
    await seedWallet();
    const syncId = randomUUID();
    await seedAttempt(`nonce-${syncId}`);
    await startOrResumeHoldingsSync(syncId, TEST_WALLET, `nonce-${syncId}`, "0", 0);
    // A newer worker (generation 1, e.g. after a lease reclaim) takes over and stages a page.
    await stageHoldingsPage(syncId, "1", [card("KT1A:1")], "checkpoint-1", false);

    // The old generation-0 worker, unaware it was superseded, tries to stage its own page.
    const staleWrite = await stageHoldingsPage(syncId, "0", [card("KT1B:2")], "checkpoint-old", false);
    assert.equal(staleWrite.stale, true, "a call from an older generation than the sync's current worker_generation must be rejected");

    const sql = getSql();
    const [row] = await sql<{ staged_cards: StagedCard[]; cursor: string | null }>`
      SELECT staged_cards, cursor FROM holdings_syncs WHERE sync_id = ${syncId}
    `;
    assert.deepEqual(row.staged_cards.map((c) => c.cardKey), ["KT1A:1"], "the stale write must not have been applied");
    assert.equal(row.cursor, "checkpoint-1", "the stale write's cursor must not have overwritten the newer generation's checkpoint");
  } finally {
    await cleanup();
  }
});
