import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "./route";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

test("GET /api/battle/session issues a self-contained nonce envelope with no-store caching", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const body = await response.json();
  assert.equal(typeof body.timestamp, "number");
  assert.equal(typeof body.random, "string");
  assert.equal(typeof body.mac, "string");
});

test("GET /api/battle/session returns a distinct envelope on every call", async () => {
  const first = await (await GET()).json();
  const second = await (await GET()).json();
  assert.notEqual(first.mac, second.mac);
});
