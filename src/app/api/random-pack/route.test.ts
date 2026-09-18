import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { objktClient } from "@/lib/objkt";
import { resetDenylistCacheForTests } from "@/lib/pullStore";
import { GET, POST } from "./route";

function packToken(
  tokenId: string,
  contract: string,
  overrides: { flag?: string; name?: string; pk?: number } = {},
) {
  return {
    pk: overrides.pk ?? Number(tokenId),
    flag: overrides.flag ?? "none",
    name: overrides.name ?? `Card ${tokenId}`,
    token_id: tokenId,
    fa_contract: contract,
    display_uri: `https://example.com/${tokenId}.jpg`,
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 5,
    description: null,
    creators: [{ verified: true, holder: { alias: "A", address: "tz1A", flag: "none" } }],
    fa: { name: "C", live: true },
  };
}

test("GET and POST return the same random-pack response contract", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  const originalRandom = Math.random;
  const originalNow = Date.now;

  client.request = async () => ({
    listing: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      price: 1_000_000,
      token: {
        // Eligible under the pull filter, so this stays a test about the
        // GET/POST response contract rather than about exclusion.
        pk: index + 1,
        flag: "none",
        name: `Card ${index + 1}`,
        token_id: String(index + 1),
        fa_contract: "KT1Pack",
        display_uri: `https://example.com/${index + 1}.jpg`,
        artifact_uri: null,
        thumbnail_uri: null,
        supply: 100,
        description: null,
        creators: [],
        fa: { name: "Test Pack", live: true },
      },
    })),
  });
  Math.random = () => 0;
  Date.now = () => 1_789_000_000_000;

  try {
    const getResponse = await GET(
      new NextRequest("http://localhost/api/random-pack?count=5"),
    );
    const postResponse = await POST(
      new NextRequest("http://localhost/api/random-pack", {
        method: "POST",
        body: JSON.stringify({ count: 5, address: "tz1Collector" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const getBody = await getResponse.json();
    const postBody = await postResponse.json();

    assert.equal(getResponse.status, 200);
    assert.equal(postResponse.status, 200);
    assert.deepEqual(postBody, getBody);
    assert.deepEqual(Object.keys(getBody).sort(), ["cards", "packSize", "timestamp"]);
  } finally {
    client.request = originalRequest;
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});

test("random-pack: excluded listings never reach the response body", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    w1: [
      { id: 1, price: 2_000_000, token: packToken("1", "KT1A") },
      { id: 2, price: 2_000_000, token: packToken("2", "KT1B", { flag: "banned", name: "Banned", pk: 20 }) },
    ],
    w2: [],
    w3: [],
  });

  try {
    const response = await GET(
      new NextRequest("http://localhost/api/random-pack?count=3"),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.cards.every((card: { name: string }) => card.name !== "Banned"));
    assert.equal(body.cards.length, body.packSize);
  } finally {
    client.request = originalRequest;
    // These tests call GET() outside a request scope, so the exclusion write
    // runs inline and lands rows whenever DATABASE_URL is set.
    if (process.env.DATABASE_URL) {
      const { getSql } = await import("@/lib/battle/store");
      await getSql()`DELETE FROM pull_exclusions WHERE fa_contract = 'KT1B'`;
    }
  }
});

test("random-pack: a pack still opens with no database configured", async () => {
  // DATABASE_URL is scoped to battling -- packs must not start requiring it.
  const originalUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  resetDenylistCacheForTests();

  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    w1: [{ id: 1, price: 2_000_000, token: packToken("1", "KT1A") }],
    w2: [],
    w3: [],
  });

  try {
    const response = await GET(
      new NextRequest("http://localhost/api/random-pack?count=3"),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.cards.length, 1);
  } finally {
    client.request = originalRequest;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    resetDenylistCacheForTests();
  }
});
