import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { objktClient } from "@/lib/objkt";
import { GET, POST } from "./route";

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
        name: `Card ${index + 1}`,
        token_id: String(index + 1),
        fa_contract: "KT1Pack",
        display_uri: `https://example.com/${index + 1}.jpg`,
        artifact_uri: null,
        thumbnail_uri: null,
        supply: 100,
        description: null,
        creators: [],
        fa: { name: "Test Pack" },
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
