import assert from "node:assert/strict";
import test from "node:test";

import {
  convertIpfsUrl,
  extractIpfsHash,
  fetchUserHoldings,
  getCardImageSources,
  objktClient,
} from "./objkt";

test("convertIpfsUrl sends an IPFS asset directly to the selected gateway", () => {
  assert.equal(
    convertIpfsUrl("ipfs://QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU", 2),
    "https://dweb.link/ipfs/QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU",
  );
});

test("extractIpfsHash accepts a raw CID while preserving its path", () => {
  assert.equal(
    extractIpfsHash("bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm/preview.png"),
    "bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm/preview.png",
  );
});

test("convertIpfsUrl leaves ordinary HTTPS media URLs unchanged", () => {
  assert.equal(
    convertIpfsUrl("https://example.com/art.jpg"),
    "https://example.com/art.jpg",
  );
});

test("convertIpfsUrl restores an IPFS URL saved by the unfinished media proxy", () => {
  assert.equal(
    convertIpfsUrl(
      "/api/media?ipfs=bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm",
      1,
    ),
    "https://ipfs.io/ipfs/bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm",
  );
});

test("convertIpfsUrl restores an HTTPS URL saved by the unfinished media proxy", () => {
  assert.equal(
    convertIpfsUrl("/api/media?url=https%3A%2F%2Fexample.com%2Fart.jpg"),
    "https://example.com/art.jpg",
  );
});

test("getCardImageSources skips duplicate representations of the same IPFS asset", () => {
  const cid = "QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU";

  assert.deepEqual(
    getCardImageSources(
      `ipfs://${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      "/api/media?ipfs=QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU",
      "https://example.com/artifact.jpg",
    ),
    [`ipfs://${cid}`, "https://example.com/artifact.jpg"],
  );
});

test("fetchUserHoldings orders OBJKT holdings by the schema-supported timestamp", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  let emittedQuery = "";

  client.request = async (document) => {
    emittedQuery = document;
    return {
      token_holder: [
        {
          quantity: 1,
          token: {
            name: "Clarence Duplex",
            token_id: "65",
            fa_contract: "KT1Example",
            display_uri: "ipfs://QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU",
            artifact_uri: null,
            thumbnail_uri: null,
            supply: 1,
            description: null,
            creators: [
              {
                holder: {
                  alias: "Example Artist",
                  address: "tz1Example",
                },
              },
            ],
            fa: {
              name: "Example Collection",
            },
          },
        },
      ],
    };
  };

  try {
    const cards = await fetchUserHoldings("tz1Collector");

    assert.match(emittedQuery, /order_by:\s*{\s*last_incremented_at:/);
    assert.equal(cards[0]?.name, "Clarence Duplex");
  } finally {
    client.request = originalRequest;
  }
});
