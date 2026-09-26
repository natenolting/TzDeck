import { objktClient } from "../src/lib/objkt";
import { RARITY_THRESHOLDS, RARITY_TIERS, rarityFor, type CardRarity } from "../src/lib/rarity";

const SAMPLE_SIZE = 500;
const RARITIES = [...RARITY_TIERS].reverse();

interface CalibrationResponse {
  listing: Array<{
    id: number;
    price: number;
    token: {
      supply: number | null;
    };
  }>;
}

interface CalibrationRangeResponse {
  oldest: Array<{ id: number }>;
  newest: Array<{ id: number }>;
}

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileRank / 100) * sorted.length) - 1,
  );
  return Number(sorted[Math.max(0, index)].toFixed(3));
}

const listingFilter = `
  status: { _eq: "active" },
  price: { _gt: 0 },
  token: {
    display_uri: { _is_null: false },
    supply: { _gt: 0 }
  }
`;

const rangeQuery = `
  query RarityCalibrationRange {
    oldest: listing(
      where: { ${listingFilter} },
      limit: 1,
      order_by: { id: asc }
    ) { id }
    newest: listing(
      where: { ${listingFilter} },
      limit: 1,
      order_by: { id: desc }
    ) { id }
  }
`;

const sampleQuery = `
  query RarityCalibration($limit: Int!, $startId: bigint!) {
    listing(
      where: { ${listingFilter}, id: { _gte: $startId } },
      limit: $limit,
      order_by: { id: asc }
    ) {
      id
      price
      token {
        supply
      }
    }
  }
`;

async function main() {
  const range = await objktClient.request<CalibrationRangeResponse>(rangeQuery);
  const oldestId = range.oldest[0]?.id;
  const newestId = range.newest[0]?.id;
  if (oldestId === undefined || newestId === undefined) {
    throw new Error("OBJKT returned no active listings for calibration.");
  }

  const pageSize = 100;
  const pageCount = SAMPLE_SIZE / pageSize;
  const startIds = Array.from({ length: pageCount }, (_, index) => (
    Math.floor(oldestId + ((newestId - oldestId) * index) / pageCount)
  ));
  const pages = await Promise.all(startIds.map((startId) => (
    objktClient.request<CalibrationResponse>(sampleQuery, {
      limit: pageSize,
      startId,
    })
  )));
  const data: CalibrationResponse = {
    listing: pages.flatMap((page) => page.listing),
  };

  if (data.listing.length !== SAMPLE_SIZE) {
    throw new Error(
      `Expected ${SAMPLE_SIZE} active listings, received ${data.listing.length}.`,
    );
  }

  if (new Set(data.listing.map(({ id }) => id)).size !== SAMPLE_SIZE) {
    throw new Error("Calibration slices returned duplicate listing IDs.");
  }

  const counts = Object.fromEntries(
    RARITIES.map((rarity) => [rarity, 0]),
  ) as Record<CardRarity, number>;

  for (const listing of data.listing) {
    const priceXtz = listing.price / 1_000_000;
    counts[rarityFor(listing.token.supply ?? undefined, priceXtz)] += 1;
  }

  const distribution = RARITIES.map((rarity) => ({
    rarity,
    count: counts[rarity],
    percent: Number(((counts[rarity] / SAMPLE_SIZE) * 100).toFixed(1)),
  }));

  console.log("Active listing ID range", { oldestId, newestId });
  console.log("Sample start IDs", startIds);
  console.log("Rarity thresholds", RARITY_THRESHOLDS);
  console.table(distribution);

  const segments = [
    { segment: "all", listings: data.listing },
    ...[1, 2, 3, 4, 5, 10, 25, 100].map((maximumSupply) => ({
      segment: `≤${maximumSupply} editions`,
      listings: data.listing.filter(
        ({ token }) => token.supply !== null && token.supply <= maximumSupply,
      ),
    })),
  ];

  console.table(segments.map(({ segment, listings }) => {
    const prices = listings.map(({ price }) => price / 1_000_000);
    return {
      segment,
      count: listings.length,
      p50: percentile(prices, 50),
      p75: percentile(prices, 75),
      p90: percentile(prices, 90),
      p95: percentile(prices, 95),
      p97: percentile(prices, 97),
      max: prices.length > 0 ? Math.max(...prices) : null,
    };
  }));

  const percentages = Object.fromEntries(
    distribution.map(({ rarity, percent }) => [rarity, percent]),
  ) as Record<CardRarity, number>;

  const failures = [
    ["Legendary", percentages.legendary, 3],
    ["Epic", percentages.epic, 10],
    ["Rare", percentages.rare, 25],
  ] as const;

  for (const [label, actual, maximum] of failures) {
    if (actual > maximum) {
      console.error(`${label} is ${actual}% (target: ≤${maximum}%).`);
      process.exitCode = 1;
    }
  }

  if (!process.exitCode) {
    console.log("Calibration targets passed.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
