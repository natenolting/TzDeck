import assert from "node:assert/strict";
import test from "node:test";

import {
  distinctCollectionName,
  convertIpfsUrl,
  extractIpfsHash,
  fetchCardsByKeys,
  fetchRandomPack,
  fetchTokenByKey,
  fetchUserHoldings,
  formatShortAddress,
  getCardKey,
  getCardImageSources,
  isImageArtifact,
  isPlayableVideo,
  normalizeEditions,
  normalizeObjktToken,
  objktClient,
  parseTokenReference,
  PACK_MAX_PER_ARTIST,
  selectDiverseListings,
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
      // Eligible under every pull-filter rule, so the tests using this helper
      // stay about windowing, fallback and diversity rather than the filter.
      // Filter behaviour has its own helper, filterableRow, below.
      pk: id * 10,
      flag: "none",
      name,
      token_id: tokenId,
      fa_contract: contract,
      display_uri: `https://example.com/${tokenId}.jpg`,
      artifact_uri: null,
      thumbnail_uri: null,
      supply: 50,
      description: null,
      creators: [{ holder: { alias: artistAddress, address: artistAddress, flag: "none" } }],
      fa: { name: "Test Collection", live: true },
    },
  };
}

function filterableRow(
  id: number,
  contract: string,
  tokenId: string,
  overrides: {
    flag?: string | null;
    live?: boolean | null;
    creatorFlag?: string | null;
    price?: number;
    pk?: number;
  } = {},
) {
  return {
    id,
    price: overrides.price ?? 2_000_000,
    token: {
      pk: overrides.pk ?? id * 10,
      flag: overrides.flag === undefined ? "none" : overrides.flag,
      name: `Token ${tokenId}`,
      token_id: tokenId,
      fa_contract: contract,
      display_uri: `https://example.com/${tokenId}.jpg`,
      artifact_uri: null,
      thumbnail_uri: null,
      supply: 50,
      description: null,
      creators: [
        {
          verified: true,
          holder: {
            alias: "Artist",
            address: `tz1Artist${tokenId}`,
            flag: overrides.creatorFlag === undefined ? "none" : overrides.creatorFlag,
          },
        },
      ],
      fa: { name: "Test Collection", live: overrides.live === undefined ? true : overrides.live },
    },
  };
}

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

// A real 36-character originated address, so the length and alphabet rules the
// parser enforces are exercised rather than asserted against a stand-in.
const PARSE_CONTRACT = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";

test("parseTokenReference reads a token out of every shape a collector can paste", () => {
  const expected = { contract_address: PARSE_CONTRACT, token_id: "123" };

  assert.deepEqual(
    parseTokenReference(`https://objkt.com/asset/${PARSE_CONTRACT}/123`),
    expected,
  );
  assert.deepEqual(
    parseTokenReference(`objkt.com/asset/${PARSE_CONTRACT}/123`),
    expected,
  );
  assert.deepEqual(
    parseTokenReference(`https://objkt.com/asset/${PARSE_CONTRACT}/123/`),
    expected,
  );
  assert.deepEqual(
    parseTokenReference(`https://objkt.com/asset/${PARSE_CONTRACT}/123?ref=tz1Friend`),
    expected,
  );
  assert.deepEqual(parseTokenReference(`${PARSE_CONTRACT}/123`), expected);
  assert.deepEqual(parseTokenReference(`${PARSE_CONTRACT}:123`), expected);
  assert.deepEqual(
    parseTokenReference(`   https://objkt.com/asset/${PARSE_CONTRACT}/123   `),
    expected,
  );
});

test("parseTokenReference returns null for anything that is not one token", () => {
  assert.equal(parseTokenReference(""), null);
  assert.equal(parseTokenReference("   "), null);
  assert.equal(
    parseTokenReference(`https://objkt.com/collection/${PARSE_CONTRACT}`),
    null,
  );
  assert.equal(parseTokenReference("https://objkt.com/users/tz1Collector"), null);
  assert.equal(parseTokenReference("https://objkt.com/asset/KT1Short/123"), null);
  assert.equal(
    parseTokenReference(`https://objkt.com/asset/${PARSE_CONTRACT}/not-a-number`),
    null,
  );
  assert.equal(parseTokenReference("the blue one from the drop last night"), null);
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
  assert.equal(
    card.display_uri,
    "https://ipfs.filebase.io/ipfs/QmZYcvkVeWWJRra8xafzBLbaVHDnt3hwxtA2egjmy32JFU",
  );
  assert.equal(card.artist_alias, "tz1abc...3456");
  assert.equal(card.collection_name, "Example Collection");
  assert.equal(card.price_xtz, 25);
  assert.equal(card.rarity, "uncommon");
  assert.equal(card.quantity_owned, 2);
});

test("normalizeEditions accepts only a real count, including TzKT's numeric strings", () => {
  assert.equal(normalizeEditions(1), 1);
  assert.equal(normalizeEditions(25), 25);
  assert.equal(normalizeEditions("40"), 40);
  for (const gap of [null, undefined, 0, "0", -3, 0.5, "", " ", "many", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeEditions(gap), undefined, `${String(gap)} is not an edition count`);
  }
});

test("a token OBJKT reports no supply for is Unknown, never a 1 of 1", () => {
  for (const supply of [null, 0]) {
    const token = {
      name: "Mystery",
      token_id: "7",
      fa_contract: "KT1Mystery",
      display_uri: null,
      artifact_uri: null,
      thumbnail_uri: null,
      supply,
    };

    const held = normalizeObjktToken(token);
    assert.equal(held.editions, undefined, `supply ${supply}`);
    assert.equal(held.rarity, "common", `a held token with supply ${supply} grades Common, as the server battles it`);

    // Listed: price alone decides, so a cheap listing can't be lifted by scarcity it never showed.
    assert.equal(normalizeObjktToken(token, { priceMutez: 200_000_000 }).rarity, "rare", `supply ${supply}`);
    assert.equal(normalizeObjktToken(token, { priceMutez: 1_000_000 }).rarity, "common", `supply ${supply}`);
  }
});

test("the TzKT fallback reads a string supply, falls back to metadata, and leaves a gap Unknown", async () => {
  const client = objktClient as unknown as { request: () => Promise<unknown> };
  const originalRequest = client.request;
  const originalFetch = globalThis.fetch;
  const balance = (tokenId: string, totalSupply?: string, editions?: string) => ({
    balance: "1",
    token: {
      tokenId,
      totalSupply,
      contract: { address: "KT1Tzkt" },
      metadata: { name: `Token ${tokenId}`, artifactUri: "ipfs://QmArt", editions },
    },
  });
  client.request = async () => {
    throw new Error("OBJKT is down");
  };
  globalThis.fetch = (async () => ({
    json: async () => [balance("1", "12"), balance("2", "0", "7"), balance("3", "0")],
  })) as unknown as typeof fetch;

  try {
    const cards = await fetchUserHoldings("tz1Collector");

    assert.deepEqual(cards.map((card) => [card.editions, card.rarity]), [
      [12, "uncommon"],
      [7, "rare"],
      [undefined, "common"],
    ]);
  } finally {
    client.request = originalRequest;
    globalThis.fetch = originalFetch;
  }
});

test("normalizeObjktToken carries the token's mime through", () => {
  const card = normalizeObjktToken({
    name: "A video",
    token_id: "20",
    fa_contract: "KT1Video",
    display_uri: "ipfs://QmPoster",
    artifact_uri: "ipfs://QmMovie",
    thumbnail_uri: null,
    supply: 1,
    mime: "video/mp4",
  });

  assert.equal(card.mime, "video/mp4");
});

test("normalizeObjktToken leaves mime undefined when OBJKT does not report one", () => {
  const card = normalizeObjktToken({
    name: "No mime",
    token_id: "1",
    fa_contract: "KT1Unknown",
    display_uri: "ipfs://QmStill",
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 1,
  });

  assert.equal(card.mime, undefined);
});

test("isPlayableVideo only accepts video tokens that carry a playable artifact", () => {
  const base = { artifact_uri: "https://example.com/a.mp4" };
  assert.equal(isPlayableVideo({ ...base, mime: "video/mp4" }), true);
  assert.equal(isPlayableVideo({ ...base, mime: "video/webm" }), true);
  // Browsers routinely cannot decode QuickTime; the poster is the safer default.
  assert.equal(isPlayableVideo({ ...base, mime: "video/quicktime" }), false);
  assert.equal(isPlayableVideo({ ...base, mime: "image/png" }), false);
  assert.equal(isPlayableVideo({ ...base, mime: undefined }), false);
  // A video token with nothing to play is not playable.
  assert.equal(isPlayableVideo({ artifact_uri: undefined, mime: "video/mp4" }), false);
});

test("isImageArtifact keeps the artifact in the image fallback chain only when it is one", () => {
  assert.equal(isImageArtifact({ mime: "image/png" }), true);
  assert.equal(isImageArtifact({ mime: "image/gif" }), true);
  assert.equal(isImageArtifact({ mime: "video/mp4" }), false);
  assert.equal(isImageArtifact({ mime: "application/x-directory" }), false);
  assert.equal(isImageArtifact({ mime: "model/gltf-binary" }), false);
  // Unknown mime keeps the pre-existing behaviour: cards saved before the field
  // existed, and any token OBJKT reports nothing for.
  assert.equal(isImageArtifact({ mime: undefined }), true);
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
    convertIpfsUrl("ipfs://QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n", 1),
    "https://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku.ipfs.dweb.link/",
  );
});

test("convertIpfsUrl normalizes supported URL representations to the primary gateway", () => {
  const cid = "bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy";
  const expected = `https://ipfs.filebase.io/ipfs/${cid}`;
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
    assert.equal(convertIpfsUrl(uri), expected, uri);
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
    assert.equal(convertIpfsUrl(`ipfs://${cid}${suffix}`, 1), expected);
    assert.equal(convertIpfsUrl(`https://dweb.link/ipfs/${cid}${suffix}`, 1), expected);
    assert.equal(convertIpfsUrl(expected, 1), expected);
  }
});

test("subdomain media URLs remain recognizable across gateway fallbacks", () => {
  const cid = "bafkreigdf3ynjvbfxq5ouefpurwdaizt4es2lfd7poeq62a5lkmlpevydy";
  const uri = `https://${cid}.ipfs.dweb.link/folder/preview.png?download=true#art`;
  assert.equal(extractIpfsHash(uri), `${cid}/folder/preview.png?download=true#art`);
  assert.equal(convertIpfsUrl(uri, 1), uri);
  assert.deepEqual(
    getCardImageSources(`ipfs://${cid}`, `https://${cid}.ipfs.dweb.link/`),
    [`ipfs://${cid}`],
  );
});

test("invalid CIDs do not throw or generate malformed dweb hostnames", () => {
  for (const uri of ["ipfs://not-a-cid/preview.png", "ipfs:///preview.png", "https://dweb.link/ipfs/invalid"]) {
    assert.equal(convertIpfsUrl(uri, 1), uri);
  }
  assert.equal(convertIpfsUrl(undefined, 1), "");
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
    "https://bafybeifpsex56m54o2npibd7np5vil4hqrk7tufaxgqwt5hir7swvy7vcm.ipfs.dweb.link/",
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

test("fetchTokenByKey resolves a single token's display metadata by contract and token id", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  let emittedVars: Record<string, unknown> | undefined;

  client.request = async (_document, variables) => {
    emittedVars = variables;
    return {
      token: [
        {
          name: "Interference 1",
          token_id: "0",
          fa_contract: "KT1Example",
          display_uri: "ipfs://QmExample",
          artifact_uri: null,
          thumbnail_uri: null,
          supply: 1,
          description: "a description",
          creators: [{ holder: { alias: "Example Artist", address: "tz1Example" } }],
          fa: { name: "Example Collection" },
        },
      ],
    };
  };

  try {
    const card = await fetchTokenByKey("KT1Example", "0");
    assert.equal(card?.name, "Interference 1");
    assert.equal(card?.contract_address, "KT1Example");
    assert.equal(card?.token_id, "0");
    assert.deepEqual(emittedVars, { contract: "KT1Example", tokenId: "0" });
  } finally {
    client.request = originalRequest;
  }
});

test("fetchTokenByKey returns null when the token can't be found", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({ token: [] });

  try {
    const card = await fetchTokenByKey("KT1Missing", "999");
    assert.equal(card, null);
  } finally {
    client.request = originalRequest;
  }
});

function rawToken(tokenId: string, contract = "KT1Example", supply = 1) {
  return {
    name: `Token ${tokenId}`,
    token_id: tokenId,
    fa_contract: contract,
    display_uri: "ipfs://QmExample",
    artifact_uri: null,
    thumbnail_uri: null,
    supply,
    description: null,
    creators: [{ holder: { alias: "Example Artist", address: "tz1Example" } }],
    fa: { name: "Example Collection" },
  };
}

test("fetchCardsByKeys resolves a whole wishlist in one request", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  let requestCount = 0;
  let emittedVars: Record<string, unknown> | undefined;

  client.request = async (_document, variables) => {
    requestCount += 1;
    emittedVars = variables;
    return {
      listing: [{ id: 9, price: 600_000_000, token: rawToken("0") }],
      token: [rawToken("0"), rawToken("1", "KT1Example", 40)],
    };
  };

  try {
    const cards = await fetchCardsByKeys([
      { contract_address: "KT1Example", token_id: "0" },
      { contract_address: "KT1Example", token_id: "1" },
    ]);

    assert.equal(requestCount, 1);
    assert.deepEqual(emittedVars?.contracts, ["KT1Example"]);
    assert.deepEqual(emittedVars?.tokenIds, ["0", "1"]);
    assert.equal(cards.size, 2);
    // Listed: price refreshes and rarity re-derives from supply plus price.
    assert.equal(cards.get("KT1Example:0")?.price_xtz, 600);
    assert.equal(cards.get("KT1Example:0")?.rarity, "legendary");
    // Unlisted: no price, so rarity falls back to the supply ladder.
    assert.equal(cards.get("KT1Example:1")?.price_xtz, undefined);
    assert.equal(cards.get("KT1Example:1")?.rarity, "common");
  } finally {
    client.request = originalRequest;
  }
});

test("fetchCardsByKeys takes the cheapest active listing for a token", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    listing: [
      { id: 9, price: 900_000_000, token: rawToken("0") },
      { id: 4, price: 120_000_000, token: rawToken("0") },
    ],
    token: [rawToken("0")],
  });

  try {
    const cards = await fetchCardsByKeys([{ contract_address: "KT1Example", token_id: "0" }]);
    assert.equal(cards.get("KT1Example:0")?.price_xtz, 120);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchCardsByKeys ignores tokens the caller didn't ask for", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  // `_in` on contract and token id independently can match pairs that were never
  // requested -- a second contract that happens to reuse token id "0".
  client.request = async () => ({
    listing: [],
    token: [rawToken("0"), rawToken("0", "KT1Other")],
  });

  try {
    const cards = await fetchCardsByKeys([{ contract_address: "KT1Example", token_id: "0" }]);
    assert.deepEqual([...cards.keys()], ["KT1Example:0"]);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchCardsByKeys returns an empty map when OBJKT is unreachable", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => {
    throw new Error("network down");
  };

  try {
    const cards = await fetchCardsByKeys([{ contract_address: "KT1Example", token_id: "0" }]);
    assert.equal(cards.size, 0);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchCardsByKeys can surface an OBJKT failure to callers that cache results", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => {
    throw new Error("network down");
  };

  try {
    await assert.rejects(
      fetchCardsByKeys(
        [{ contract_address: "KT1Example", token_id: "0" }],
        { throwOnError: true },
      ),
      /network down/,
    );
  } finally {
    client.request = originalRequest;
  }
});

test("fetchCardsByKeys makes no request for an empty wishlist", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  let requestCount = 0;

  client.request = async () => {
    requestCount += 1;
    return { listing: [], token: [] };
  };

  try {
    const cards = await fetchCardsByKeys([]);
    assert.equal(requestCount, 0);
    assert.equal(cards.size, 0);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchRandomPack requests the fields the filter reads", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;
  let emittedQuery = "";

  client.request = async (document) => {
    emittedQuery = document;
    return {
      w1: [filterableRow(1, "KT1A", "1")],
      w2: [filterableRow(2, "KT1B", "2")],
      w3: [filterableRow(3, "KT1C", "3")],
    };
  };

  try {
    await fetchRandomPack(3);

    assert.match(emittedQuery, /\bpk\b/);
    assert.match(emittedQuery, /\bflag\b/);
    assert.match(emittedQuery, /live/);
    // activeWhere must NOT have grown moderation filters -- the rules run in code.
    assert.doesNotMatch(emittedQuery, /_not:\s*{\s*creators/);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchRandomPack drops flagged listings and reports them as exclusions", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    w1: [
      filterableRow(1, "KT1A", "1"),
      filterableRow(2, "KT1B", "2", { flag: "banned", pk: 222 }),
    ],
    w2: [
      filterableRow(3, "KT1C", "3", { live: false }),
      filterableRow(4, "KT1D", "4", { creatorFlag: "banned" }),
    ],
    w3: [filterableRow(5, "KT1E", "5")],
  });

  try {
    const { cards, excluded } = await fetchRandomPack(5);

    assert.deepEqual(
      cards.map((card) => card.contract_address).sort(),
      ["KT1A", "KT1E"],
    );
    assert.deepEqual(
      excluded.map((record) => record.reason).sort(),
      ["creator_flag", "fa_not_live", "token_flag"],
    );
    assert.equal(excluded.find((r) => r.reason === "token_flag")?.tokenPk, 222);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchRandomPack applies the denylist it is given", async () => {
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    w1: [filterableRow(1, "KT1A", "1"), filterableRow(2, "KT1Bad", "9")],
    w2: [],
    w3: [],
  });

  try {
    const { cards, excluded } = await fetchRandomPack(2, {
      has: (contract) => contract === "KT1Bad",
    });

    assert.deepEqual(cards.map((card) => card.contract_address), ["KT1A"]);
    assert.deepEqual(excluded, [
      { faContract: "KT1Bad", tokenId: "9", tokenPk: 20, reason: "denylist" },
    ]);
  } finally {
    client.request = originalRequest;
  }
});

test("fetchRandomPack filters before the cheapest-per-token tiebreak", async () => {
  // A banned cheap listing of a token must not suppress the same token's clean,
  // pricier listing -- which is what would happen if the filter ran after
  // cheapestPerToken picked the cheapest row.
  const client = objktClient as unknown as {
    request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
  };
  const originalRequest = client.request;

  client.request = async () => ({
    w1: [
      filterableRow(1, "KT1A", "1", { price: 5_000_000 }),
      filterableRow(2, "KT1A", "1", { price: 1_000_000, flag: "banned" }),
    ],
    w2: [],
    w3: [],
  });

  try {
    const { cards } = await fetchRandomPack(1);

    assert.equal(cards.length, 1);
    assert.equal(cards[0].price_mutez, 5_000_000);
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
    const { cards } = await fetchRandomPack(3);

    // One round trip, three offsets, each drawn from its own band so the
    // sample is not a single contiguous block of listing IDs.
    assert.equal(requests.length, 1);
    assert.deepEqual(
      [requests[0]?.o1, requests[0]?.o2, requests[0]?.o3],
      [400, 2_900, 12_500],
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
    const { cards } = await fetchRandomPack(1);

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

  // Eligible under the pull filter, so this stays a test about the
  // cheapest-per-token tiebreak rather than about exclusion.
  const token = (tokenId: string) => ({
    pk: 1,
    flag: "none",
    name: `Token ${tokenId}`,
    token_id: tokenId,
    fa_contract: "KT1DuplicateFixture",
    display_uri: `https://example.com/${tokenId}.jpg`,
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 50,
    description: null,
    creators: [],
    fa: { name: "Duplicate Fixture", live: true },
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
    const { cards } = await fetchRandomPack(3);
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

test("distinctCollectionName hides a collection named after its own artist", () => {
  assert.equal(
    distinctCollectionName({ artist_alias: "Marie & Laveau ", collection_name: "Marie & Laveau" }),
    undefined,
  );
  assert.equal(
    distinctCollectionName({ artist_alias: "arghavan", collection_name: "ARGHAVAN" }),
    undefined,
  );
});

test("distinctCollectionName keeps a collection that says something new", () => {
  assert.equal(
    distinctCollectionName({ artist_alias: "Arghavan", collection_name: "Persian Paper Tales " }),
    "Persian Paper Tales",
  );
});

test("distinctCollectionName treats a blank collection as absent", () => {
  assert.equal(distinctCollectionName({ artist_alias: "Janis", collection_name: "   " }), undefined);
  assert.equal(distinctCollectionName({ artist_alias: "Janis" }), undefined);
});

test("normalizeObjktToken trims the whitespace OBJKT ships around names", () => {
  const card = normalizeObjktToken({
    name: "  Butterfly of Hope ",
    token_id: "7",
    fa_contract: "KT1Example",
    display_uri: null,
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 1,
    description: null,
    creators: [{ holder: { alias: " Mojdeh ", address: "tz1abcdefghijklmnopqrstuvwxy123456" } }],
    fa: { name: "Wings Of Hope " },
  });

  // A stray space reaches places HTML cannot re-flow: aria-labels, the
  // document title, and the generated preview image.
  assert.equal(card.name, "Butterfly of Hope");
  assert.equal(card.artist_alias, "Mojdeh");
  assert.equal(card.collection_name, "Wings Of Hope");
});

test("normalizeObjktToken falls back when a name is only whitespace", () => {
  const card = normalizeObjktToken({
    name: "   ",
    token_id: "8",
    fa_contract: "KT1Example",
    display_uri: null,
    artifact_uri: null,
    thumbnail_uri: null,
    supply: 1,
    description: null,
    creators: [],
    fa: { name: "  " },
  });

  assert.equal(card.name, "OBJKT #8");
  assert.equal(card.collection_name, "Tezos Art");
});
