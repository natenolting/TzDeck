import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRarity,
  calculateSupplyRarity,
  convertIpfsUrl,
  extractIpfsHash,
  fetchRandomPack,
  fetchUserHoldings,
  formatShortAddress,
  getCardKey,
  getCardImageSources,
  normalizeObjktToken,
  objktClient,
  PACK_MAX_PER_ARTIST,
  RARITY_LEGEND,
  selectDiverseListings,
  RARITY_THRESHOLDS,
  shuffleArray,
} from "./objkt";

function listingRow(
  id: number,
  contract: string,
  tokenId: string,
  artistAddress: string,
  name = `Token ${tokenId}`,
) {
  return {
    id,
    price: 2_000_000,
    token: {
      name,
      token_id: tokenId,
      fa_contract: contract,
      display_uri: `https://example.com/${tokenId}.jpg`,
      artifact_uri: null,
      thumbnail_uri: null,
      supply: 50,
      description: null,
      creators: [{ holder: { alias: artistAddress, address: artistAddress } }],
      fa: { name: "Test Collection" },
    },
  };
}

test("rarity legend matches calculateRarity boundaries", () => {
  assert.deepEqual(
    RARITY_LEGEND.map(({ tier, rule }) => [tier, rule]),
    [
      ["legendary", `1 of 1 and ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`],
      ["epic", `≤${RARITY_THRESHOLDS.epicEditions} editions and ${RARITY_THRESHOLDS.scarceTierPrice}ꜩ+ · or ${RARITY_THRESHOLDS.topTierPrice}ꜩ+`],
      ["rare", `1 of 1 or ${RARITY_THRESHOLDS.rarePrice}ꜩ+`],
      ["uncommon", `≤${RARITY_THRESHOLDS.uncommonEditions} editions or ${RARITY_THRESHOLDS.uncommonPrice}ꜩ+`],
      ["common", `>${RARITY_THRESHOLDS.uncommonEditions} editions and under ${RARITY_THRESHOLDS.uncommonPrice}ꜩ`],
    ],
  );

  assert.equal(calculateRarity(1, RARITY_THRESHOLDS.topTierPrice), "legendary");
  assert.equal(calculateRarity(1, RARITY_THRESHOLDS.topTierPrice - 0.001), "epic");
  assert.equal(
    calculateRarity(RARITY_THRESHOLDS.epicEditions, RARITY_THRESHOLDS.scarceTierPrice),
    "epic",
  );
  assert.equal(calculateRarity(200, RARITY_THRESHOLDS.topTierPrice), "epic");
  assert.equal(calculateRarity(RARITY_THRESHOLDS.rareEditions, 0), "rare");
  assert.equal(calculateRarity(200, RARITY_THRESHOLDS.rarePrice), "rare");
  assert.equal(calculateRarity(RARITY_THRESHOLDS.uncommonEditions, 0), "uncommon");
  assert.equal(calculateRarity(200, RARITY_THRESHOLDS.uncommonPrice), "uncommon");
  assert.equal(
    calculateRarity(RARITY_THRESHOLDS.uncommonEditions + 1, 0),
    "common",
  );
});

test("calculateSupplyRarity grades wallet holdings without listing prices", () => {
  assert.equal(calculateSupplyRarity(1), "rare");
  assert.equal(calculateSupplyRarity(25), "uncommon");
  assert.equal(calculateSupplyRarity(26), "common");
  assert.equal(calculateSupplyRarity(undefined), "common");
});

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

test("normalizeObjktToken maps shared OBJKT metadata and listing options", () => {
  const card = normalizeObjktToken(
    {
      name: null,
      token_id: "42",
      fa_contract: "KT1Example",
      display_uri: null,
      artifact_uri: "ipfs://QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU",
      thumbnail_uri: null,
      supply: 3,
      description: "A normalized token",
      creators: [
        {
          holder: {
            alias: null,
            address: "tz1abcdefghijklmnopqrstuvwxy123456",
          },
        },
      ],
      fa: { name: "Example Collection" },
    },
    { listingId: 99, priceMutez: 25_000_000, quantityOwned: 2 },
  );

  assert.equal(card.listing_id, 99);
  assert.equal(card.name, "OBJKT #42");
  assert.equal(card.display_uri, "https://gateway.pinata.cloud/ipfs/QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU");
  assert.equal(card.artist_alias, "tz1abc...3456");
  assert.equal(card.collection_name, "Example Collection");
  assert.equal(card.price_xtz, 25);
  assert.equal(card.rarity, "uncommon");
  assert.equal(card.quantity_owned, 2);
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

test("convertIpfsUrl converts CIDv0 to CIDv1/base32 for dweb subdomains", () => {
  assert.equal(
    convertIpfsUrl("ipfs://QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n", 2),
    "https://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku.ipfs.dweb.link/",
  );
});

test("convertIpfsUrl preserves a CIDv1 image across supported URL representations", () => {
  const cid = "bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy";
  const expected = `https://${cid}.ipfs.dweb.link/`;
  for (const uri of [
    cid,
    `ipfs://${cid}`,
    `ipfs://ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
    `/api/media?ipfs=${cid}`,
    `/api/media?url=${encodeURIComponent(expected)}`,
    expected,
  ]) {
    assert.equal(convertIpfsUrl(uri, 2), expected, uri);
  }
});

test("dweb subdomain conversion preserves paths, queries, and fragments", () => {
  const cid = "bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm";
  for (const suffix of [
    "/folder/preview%20image.png?filename=preview.png#art",
    "?filename=preview.png#art",
    "/folder/",
  ]) {
    const expected = `https://${cid}.ipfs.dweb.link/${suffix.replace(/^\//, "")}`;
    assert.equal(convertIpfsUrl(`ipfs://${cid}${suffix}`, 2), expected);
    assert.equal(convertIpfsUrl(`https://dweb.link/ipfs/${cid}${suffix}`, 2), expected);
    assert.equal(convertIpfsUrl(expected, 2), expected);
  }
});

test("subdomain media URLs remain recognizable across gateway fallbacks", () => {
  const cid = "bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy";
  const uri = `https://${cid}.ipfs.dweb.link/folder/preview.png?download=true#art`;
  assert.equal(extractIpfsHash(uri), `${cid}/folder/preview.png?download=true#art`);
  assert.equal(convertIpfsUrl(uri, 1), `https://ipfs.io/ipfs/${cid}/folder/preview.png?download=true#art`);
  assert.deepEqual(getCardImageSources(`ipfs://${cid}`, `https://${cid}.ipfs.dweb.link/`), [`ipfs://${cid}`]);
});

test("invalid CIDs do not throw or generate malformed dweb hostnames", () => {
  for (const uri of ["ipfs://not-a-cid/preview.png", "ipfs:///preview.png", "https://dweb.link/ipfs/invalid"]) {
    assert.equal(convertIpfsUrl(uri, 2), uri);
  }
  assert.equal(convertIpfsUrl(undefined, 2), "");
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

test("fetchRandomPack samples three staggered windows in one request", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  const originalRandom = Math.random;
  const requests: Array<Record<string, unknown> | undefined> = [];

  client.request = async (_document, variables) => {
    requests.push(variables);
    return {
      w1: [listingRow(1, "KT1A", "1", "artist-a")],
      w2: [listingRow(2, "KT1B", "2", "artist-b")],
      w3: [listingRow(3, "KT1C", "3", "artist-c")],
    };
  };
  Math.random = () => 0.5;

  try {
    const cards = await fetchRandomPack(3);

    // One round trip, three offsets, each drawn from its own band so the
    // sample is not a single contiguous block of listing IDs.
    assert.equal(requests.length, 1);
    assert.deepEqual(
      [requests[0]?.o1, requests[0]?.o2, requests[0]?.o3],
      [200, 1_000, 2_800],
    );
    assert.equal(cards.length, 3);
  } finally {
    client.request = originalRequest;
    Math.random = originalRandom;
  }
});

test("fetchRandomPack falls back to the newest listings when windows overrun", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  const originalRandom = Math.random;
  const originalConsoleError = console.error;
  let calls = 0;

  client.request = async () => {
    calls += 1;
    if (calls === 1) return { w1: [], w2: [], w3: [] };
    return { listing: [listingRow(101, "KT1Fallback", "7", "artist-z", "Fallback Find")] };
  };
  Math.random = () => 0.5;
  console.error = () => undefined;

  try {
    const cards = await fetchRandomPack(1);

    assert.equal(calls, 2);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.name, "Fallback Find");
  } finally {
    client.request = originalRequest;
    Math.random = originalRandom;
    console.error = originalConsoleError;
  }
});

test("a pack takes at most two cards from any one artist", () => {
  // A bulk lister dominating the window is the real-world case: five listings
  // from one artist plus two others.
  const pool = [
    listingRow(1, "KT1A", "1", "bulk-lister"),
    listingRow(2, "KT1A", "2", "bulk-lister"),
    listingRow(3, "KT1A", "3", "bulk-lister"),
    listingRow(4, "KT1A", "4", "bulk-lister"),
    listingRow(5, "KT1A", "5", "bulk-lister"),
    listingRow(6, "KT1B", "6", "second-artist"),
    listingRow(7, "KT1C", "7", "third-artist"),
    listingRow(8, "KT1D", "8", "fourth-artist"),
  ];

  const picked = selectDiverseListings(pool, 5);
  const perArtist = new Map<string, number>();
  for (const item of picked) {
    const key = item.token.creators?.[0]?.holder.address ?? "none";
    perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
  }

  assert.equal(picked.length, 5);
  assert.equal(perArtist.get("bulk-lister"), PACK_MAX_PER_ARTIST);
  assert.equal(perArtist.get("second-artist"), 1);
  assert.equal(perArtist.get("third-artist"), 1);
  assert.equal(perArtist.get("fourth-artist"), 1);
  assert.ok([...perArtist.values()].every((n) => n <= PACK_MAX_PER_ARTIST));
});

test("a pack fills past the cap rather than coming up short", () => {
  // When the pool really is one artist, a repetitive pack beats a broken one.
  const pool = [1, 2, 3, 4].map((n) => listingRow(n, "KT1A", String(n), "only-artist"));

  const picked = selectDiverseListings(pool, 4);

  assert.equal(picked.length, 4);
  assert.equal(new Set(picked).size, 4);
});

test("fetchRandomPack returns unique tokens using their cheapest listing", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  const originalRandom = Math.random;

  const token = (tokenId: string) => ({
    name: `Token ${tokenId}`,
    token_id: tokenId,
    fa_contract: "KT1DuplicateFixture",
    display_uri: `https://example.com/${tokenId}.jpg`,
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 50,
    description: null,
    creators: [],
    fa: { name: "Duplicate Fixture" },
  });

  client.request = async () => ({
    listing: [
      { id: 1, price: 10_000_000, token: token("duplicate") },
      { id: 2, price: 2_000_000, token: token("duplicate") },
      { id: 3, price: 3_000_000, token: token("unique-a") },
      { id: 4, price: 4_000_000, token: token("unique-b") },
    ],
  });
  Math.random = () => 0.999;

  try {
    const cards = await fetchRandomPack(3);
    const keys = cards.map(getCardKey);
    const duplicate = cards.find(({ token_id }) => token_id === "duplicate");

    assert.equal(cards.length, 3);
    assert.equal(new Set(keys).size, cards.length);
    assert.equal(duplicate?.listing_id, 2);
    assert.equal(duplicate?.price_xtz, 2);
  } finally {
    client.request = originalRequest;
    Math.random = originalRandom;
  }
});
