import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  claimOrLookupAttempt,
  commitHoldingsRefresh,
  commitParticipation,
  getSql,
  stageHoldingsPage,
  startOrResumeHoldingsSync,
  type AttemptIdentity,
  type StagedCard,
} from "./store";

const WALLET = "tz1ParticipationCommitWallet00000000";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM holdings_syncs WHERE wallet = ${WALLET}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${WALLET}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${WALLET}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${WALLET}`;
  await sql`DELETE FROM wallets WHERE address = ${WALLET}`;
}

function card(cardKey: string): StagedCard {
  return { cardKey, contractAddress: cardKey.split(":")[0], tokenId: cardKey.split(":")[1], seed: { editions: 5, descriptionLength: 50 }, source: "test" };
}

async function claimAttempt(action: "opt-in" | "refresh"): Promise<{ nonce: string; generation: string }> {
  const nonce = randomUUID();
  const identity: AttemptIdentity = { wallet: WALLET, action, paramHash: "test" };
  const claimed = await claimOrLookupAttempt(nonce, identity, new Date());
  assert.equal(claimed.kind, "claimed");
  if (claimed.kind !== "claimed") throw new Error("unreachable");
  return { nonce, generation: claimed.row.generation };
}

test("commit_participation: a lost holdings-generation race is retryable, not a permanent dead end", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${WALLET})`;
    const { nonce, generation } = await claimAttempt("opt-in");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    await stageHoldingsPage(syncId, generation, [card("KT1A:1")], null, true);

    // A concurrent opt-out bumps holdings_generation between staging and promotion.
    await sql`UPDATE wallets SET holdings_generation = holdings_generation + 1 WHERE address = ${WALLET}`;

    const result = await commitParticipation(nonce, generation, WALLET, "test", true, syncId);
    assert.equal(result.status_code, 409);
    assert.equal((result.response as { error: string }).error, "stale_holdings_generation");

    const [attempt] = await sql<{ retryable: boolean | null }>`SELECT retryable FROM battle_attempts WHERE nonce = ${nonce}`;
    assert.equal(attempt.retryable, true, "a lost race is operational timing, not a business rule the caller broke");
  } finally {
    await cleanup();
  }
});

test("commit_participation: an attempt reclaimed to a new generation after staging already completed can still promote", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${WALLET})`;
    const { nonce, generation } = await claimAttempt("opt-in");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    // Staging finishes under generation 0 -- worker_generation is now frozen at 0.
    await stageHoldingsPage(syncId, generation, [card("KT1A:1")], null, true);

    // The process died before promotion ran; a later request reclaims the
    // attempt to a fresh generation (mirrors what reclaimAttempt does).
    const reclaimedGeneration = "1";
    await sql`UPDATE battle_attempts SET generation = ${reclaimedGeneration}::bigint, lease_expires_at = now() + interval '1 minute' WHERE nonce = ${nonce}`;

    const result = await commitParticipation(nonce, reclaimedGeneration, WALLET, "test", true, syncId);
    assert.equal(result.status_code, 200, "a reclaimed generation must still be able to promote a sync staged under an older generation");
    assert.deepEqual(result.response, { optedIn: true });

    const [wallet] = await sql<{ opted_in: boolean }>`SELECT opted_in FROM wallets WHERE address = ${WALLET}`;
    assert.equal(wallet.opted_in, true);
  } finally {
    await cleanup();
  }
});

test("commit_participation: a call from a genuinely superseded (older) generation is still rejected", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address) VALUES (${WALLET})`;
    const { nonce, generation } = await claimAttempt("opt-in");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    // A newer worker (generation 2) stages and completes the sync.
    await stageHoldingsPage(syncId, "2", [card("KT1A:1")], null, true);

    // This call still thinks it's generation 1 -- genuinely superseded, not just resumed.
    await sql`UPDATE battle_attempts SET generation = '1'::bigint, lease_expires_at = now() + interval '1 minute' WHERE nonce = ${nonce}`;
    const result = await commitParticipation(nonce, "1", WALLET, "test", true, syncId);
    assert.equal(result.status_code, 409);
    assert.equal((result.response as { error: string }).error, "invalid_holdings_sync");
  } finally {
    await cleanup();
  }
});

test("commit_holdings_refresh: a lost holdings-generation race is retryable, not a permanent dead end", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${WALLET}, true)`;
    const { nonce, generation } = await claimAttempt("refresh");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    await stageHoldingsPage(syncId, generation, [card("KT1A:1")], null, true);

    await sql`UPDATE wallets SET holdings_generation = holdings_generation + 1 WHERE address = ${WALLET}`;

    const result = await commitHoldingsRefresh(nonce, generation, WALLET, "test", syncId);
    assert.equal(result.status_code, 409);
    assert.equal((result.response as { error: string }).error, "stale_holdings_generation");

    const [attempt] = await sql<{ retryable: boolean | null }>`SELECT retryable FROM battle_attempts WHERE nonce = ${nonce}`;
    assert.equal(attempt.retryable, true);
  } finally {
    await cleanup();
  }
});

test("commit_holdings_refresh: an attempt reclaimed to a new generation after staging already completed can still promote", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${WALLET}, true)`;
    const { nonce, generation } = await claimAttempt("refresh");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    // Staging finishes under generation 0 -- worker_generation is now frozen at 0.
    await stageHoldingsPage(syncId, generation, [card("KT1A:1")], null, true);

    // The process died before promotion ran; a later request reclaims the
    // attempt to a fresh generation (mirrors what reclaimAttempt does).
    const reclaimedGeneration = "1";
    await sql`UPDATE battle_attempts SET generation = ${reclaimedGeneration}::bigint, lease_expires_at = now() + interval '1 minute' WHERE nonce = ${nonce}`;

    const result = await commitHoldingsRefresh(nonce, reclaimedGeneration, WALLET, "test", syncId);
    assert.equal(result.status_code, 200, "a reclaimed generation must still be able to promote a sync staged under an older generation");
    assert.deepEqual(result.response, { refreshed: true });

    const holdings = await sql`SELECT * FROM wallet_holdings WHERE wallet = ${WALLET}`;
    assert.equal(holdings.length, 1);
  } finally {
    await cleanup();
  }
});

test("commit_holdings_refresh: a call from a genuinely superseded (older) generation is still rejected", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${WALLET}, true)`;
    const { nonce, generation } = await claimAttempt("refresh");
    const syncId = `sync:${nonce}`;
    await startOrResumeHoldingsSync(syncId, WALLET, nonce, generation, 0);
    // A newer worker (generation 2) stages and completes the sync.
    await stageHoldingsPage(syncId, "2", [card("KT1A:1")], null, true);

    // This call still thinks it's generation 1 -- genuinely superseded, not just resumed.
    await sql`UPDATE battle_attempts SET generation = '1'::bigint, lease_expires_at = now() + interval '1 minute' WHERE nonce = ${nonce}`;
    const result = await commitHoldingsRefresh(nonce, "1", WALLET, "test", syncId);
    assert.equal(result.status_code, 409);
    assert.equal((result.response as { error: string }).error, "invalid_holdings_sync");
  } finally {
    await cleanup();
  }
});
