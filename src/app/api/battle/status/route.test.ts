import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { getSql } from "@/lib/battle/store";
import { GET } from "./route";

const WALLET = "tz1StatusRouteWallet0000000000000000";

async function cleanup() {
  const sql = getSql();
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${WALLET}`;
  await sql`DELETE FROM wallets WHERE address = ${WALLET}`;
}

test("GET /api/battle/status: returns opt-in, effective cap usage, and per-card derived stats without a signature", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`
      INSERT INTO wallets (address, opted_in, attack_count, attack_reset_at, defense_count, defense_reset_at)
      VALUES (${WALLET}, true, 3, now() + interval '1 hour', 0, now() + interval '1 hour')
    `;
    await sql`
      INSERT INTO wallet_card_progress (wallet, card_key, xp, seed_editions, seed_description_length, seed_source, recovery_until, recovery_reason)
      VALUES (${WALLET}, 'KT1Status:1', 150, 5, 50, 'test', now() + interval '1 hour', 'offensive')
    `;

    const response = await GET(new NextRequest(`http://localhost/api/battle/status?address=${WALLET}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");

    const json = await response.json();
    assert.equal(json.optedIn, true);
    assert.equal(json.effectiveAttackCount, 3);
    assert.equal(json.cards.length, 1);
    assert.equal(json.cards[0].cardKey, "KT1Status:1");
    assert.equal(json.cards[0].recoveryReason, "offensive");
    assert.ok(json.cards[0].power > 0);
    assert.ok(json.cards[0].hp > 0);
  } finally {
    await cleanup();
  }
});

test("GET /api/battle/status: a cap past its reset time reads as effectively zero without a write", async () => {
  const sql = getSql();
  await cleanup();
  try {
    await sql`
      INSERT INTO wallets (address, opted_in, attack_count, attack_reset_at)
      VALUES (${WALLET}, true, 20, now() - interval '1 hour')
    `;
    const response = await GET(new NextRequest(`http://localhost/api/battle/status?address=${WALLET}`));
    const json = await response.json();
    assert.equal(json.effectiveAttackCount, 0);

    const [row] = await sql<{ attack_count: number }>`SELECT attack_count FROM wallets WHERE address = ${WALLET}`;
    assert.equal(row.attack_count, 20, "a read must never write the reset itself");
  } finally {
    await cleanup();
  }
});

test("GET /api/battle/status: an unknown wallet returns a clean default, not an error", async () => {
  const response = await GET(new NextRequest("http://localhost/api/battle/status?address=tz1NeverSeenBefore00000000000000000"));
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.optedIn, false);
  assert.deepEqual(json.cards, []);
});
