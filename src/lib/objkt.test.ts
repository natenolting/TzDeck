import assert from "node:assert/strict";
import test from "node:test";

import {
  convertIpfsUrl,
  extractIpfsHash,
  fetchRandomPack,
  fetchUserHoldings,
  formatShortAddress,
  getCardKey,
  getCardImageSources,
  objktClient,
  shuffleArray,
} from "./objkt";

test("formatShortAddress creates the shared compact wallet label", () => {
  assert.equal(
    formatShortAddress("tz1abcdefghijklmnopqrstuvwxy123456"),
    "tz1abc...3456",
  );
});

test("getCardKey creates a stable contract and token identity", () => {
  assert.equal(
    getCardKey({ contract_address: "KT1Example", token_id: "42" }),
    "KT1Example:42",
  );
});

test("shuffleArray applies Fisher-Yates without mutating its input", () => {
  const originalRandom = Math.random;
  const randomValues = [0.5, 0, 0.9];
  const input = ["a", "b", "c", "d"];

  Math.random = () => randomValues.shift() ?? 0;

  try {
    assert.deepEqual(shuffleArray(input), ["d", "b", "a", "c"]);
    assert.deepEqual(input, ["a", "b", "c", "d"]);
  } finally {
    Math.random = originalRandom;
  }
});

test("shuffleArray distributes each item uniformly across positions", () => {
  const originalRandom = Math.random;
  const itemCount = 4;
  const iterations = 12_000;
  const expectedPerCell = iterations / itemCount;
  const counts = Array.from(
    { length: itemCount },
    () => Array<number>(itemCount).fill(0),
  );
  let seed = 0x12345678;

  Math.random = () => {
    seed = (Math.imul(1_664_525, seed) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const shuffled = shuffleArray([0, 1, 2, 3]);
      shuffled.forEach((item, position) => {
        counts[item][position] += 1;
      });
    }
  } finally {
    Math.random = originalRandom;
  }

  const chiSquared = counts.flat().reduce((total, observed) => {
    const difference = observed - expectedPerCell;
    return total + (difference * difference) / expectedPerCell;
  }, 0);

  assert.ok(
    chiSquared < 40,
    `Expected a uniform distribution; chi-square was ${chiSquared.toFixed(2)}`,
  );
});

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

test("fetchRandomPack retries an empty random window from offset zero", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  const originalRandom = Math.random;
  const originalConsoleError = console.error;
  const requestedOffsets: number[] = [];

  client.request = async (_document, variables) => {
    requestedOffsets.push(Number(variables?.offset));

    if (requestedOffsets.length === 1) {
      return { listing: [] };
    }

    return {
      listing: [
        {
          id: 101,
          price: 2_000_000,
          token: {
            name: "Fallback Find",
            token_id: "7",
            fa_contract: "KT1Fallback",
            display_uri: "https://example.com/fallback.jpg",
            artifact_uri: null,
            thumbnail_uri: null,
            supply: 50,
            description: null,
            creators: [],
            fa: { name: "Fallback Collection" },
          },
        },
      ],
    };
  };
  Math.random = () => 0.5;
  console.error = () => undefined;

  try {
    const cards = await fetchRandomPack(1);

    assert.deepEqual(requestedOffsets, [400, 0]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.name, "Fallback Find");
  } finally {
    client.request = originalRequest;
    Math.random = originalRandom;
    console.error = originalConsoleError;
  }
});
