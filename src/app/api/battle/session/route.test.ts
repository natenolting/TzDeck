import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { getSql } from "@/lib/battle/store";
import { GET } from "./route";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

function sessionRequest(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/battle/session", { headers: { "x-forwarded-for": ip } });
}

async function cleanupRateLimit(ip: string) {
  const sql = getSql();
  await sql`DELETE FROM rate_limits WHERE bucket_key = ${`session:${ip}`}`;
}

test("GET /api/battle/session issues a self-contained nonce envelope with no-store caching", async () => {
  const ip = "203.0.113.1";
  try {
    const response = await GET(sessionRequest(ip));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");

    const body = await response.json();
    assert.equal(typeof body.timestamp, "number");
    assert.equal(typeof body.random, "string");
    assert.equal(typeof body.mac, "string");
  } finally {
    await cleanupRateLimit(ip);
  }
});

test("GET /api/battle/session returns a distinct envelope on every call", async () => {
  const ip = "203.0.113.2";
  try {
    const first = await (await GET(sessionRequest(ip))).json();
    const second = await (await GET(sessionRequest(ip))).json();
    assert.notEqual(first.mac, second.mac);
  } finally {
    await cleanupRateLimit(ip);
  }
});

test("GET /api/battle/session: an IP past its request budget is rate-limited", async () => {
  const ip = "203.0.113.3";
  try {
    for (let i = 0; i < 30; i += 1) {
      const response = await GET(sessionRequest(ip));
      assert.equal(response.status, 200, `request ${i + 1} of 30 should be within budget`);
    }
    const overBudget = await GET(sessionRequest(ip));
    assert.equal(overBudget.status, 429);
  } finally {
    await cleanupRateLimit(ip);
  }
});
