import assert from "node:assert/strict";
import test from "node:test";

import { fetchMatchmakingCandidatePool, getSql } from "./store";

const ATTACKER = "tz1MatchmakingAttacker000000000000000";
const OPTED_IN_WALLET = "tz1MatchmakingOptedIn0000000000000000";
const OPTED_OUT_WALLET = "tz1MatchmakingOptedOut0000000000000000";

async function cleanup() {
  const sql = getSql();
  for (const wallet of [ATTACKER, OPTED_IN_WALLET, OPTED_OUT_WALLET]) {
    await sql`DELETE FROM wallet_holdings WHERE wallet = ${wallet}`;
    await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
    await sql`DELETE FROM wallets WHERE address = ${wallet}`;
  }
}

test("fetchMatchmakingCandidatePool: excludes the attacker's own wallet and non-opted-in wallets", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${ATTACKER}, true)`;
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${OPTED_IN_WALLET}, true)`;
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${OPTED_OUT_WALLET}, false)`;

    for (const wallet of [ATTACKER, OPTED_IN_WALLET, OPTED_OUT_WALLET]) {
      await sql`
        INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
        VALUES (${wallet}, 'KT1:1', 5, 50, 'test')
      `;
      await sql`INSERT INTO wallet_holdings (wallet, card_key) VALUES (${wallet}, 'KT1:1')`;
    }

    const pool = await fetchMatchmakingCandidatePool(ATTACKER);
    const wallets = pool.map((row) => row.wallet);
    assert.ok(!wallets.includes(ATTACKER), "the attacker's own wallet must never appear as a candidate");
    assert.ok(wallets.includes(OPTED_IN_WALLET), "an opted-in wallet with active holdings must appear");
    assert.ok(!wallets.includes(OPTED_OUT_WALLET), "a non-opted-in wallet must never appear");
  } finally {
    await cleanup();
  }
});

test("fetchMatchmakingCandidatePool: a card with progress but no active holdings entry (sold) is excluded", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`INSERT INTO wallets (address, opted_in) VALUES (${OPTED_IN_WALLET}, true)`;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
      VALUES (${OPTED_IN_WALLET}, 'KT1:1', 5, 50, 'test')
    `;
    // No wallet_holdings row -- this card was sold since it last leveled.

    const pool = await fetchMatchmakingCandidatePool(ATTACKER);
    assert.equal(pool.some((row) => row.wallet === OPTED_IN_WALLET), false);
  } finally {
    await cleanup();
  }
});
