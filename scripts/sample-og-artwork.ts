import { convertIpfsUrl, IPFS_GATEWAYS } from "../src/lib/ipfs";
import { objktClient } from "../src/lib/objkt";

// Link-preview images are rendered by satori, which fetches the token's own
// IPFS thumbnail and rasterises it under a byte and time budget. Thumbnails
// are whatever the minting platform stored, and animated ones arrive at full
// size, so the budget is a real constraint rather than a formality. This
// measures how much of the live catalogue clears it.
//
// Timings are from wherever this runs, not from Vercel. Sizes are the same.

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE ?? 300);
const BUDGET_BYTES = Number(process.env.BUDGET_BYTES ?? 400 * 1024);
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 2000);
const PROBE_TIMEOUT_MS = 10_000;
// Filebase answers 429 to everything after about 100 rapid requests from one
// IP, which would count as unreachable artwork that isn't.
const REQUEST_GAP_MS = 700;

const listingFilter = `
  status: { _eq: "active" },
  price: { _gt: 0 },
  token: {
    display_uri: { _is_null: false },
    supply: { _gt: 0 }
  }
`;

const rangeQuery = `
  query OgArtworkRange {
    oldest: listing(where: { ${listingFilter} }, limit: 1, order_by: { id: asc }) { id }
    newest: listing(where: { ${listingFilter} }, limit: 1, order_by: { id: desc }) { id }
  }
`;

const sampleQuery = `
  query OgArtworkSample($limit: Int!, $startId: bigint!) {
    listing(
      where: { ${listingFilter}, id: { _gte: $startId } },
      limit: $limit,
      order_by: { id: asc }
    ) {
      token { mime thumbnail_uri display_uri artifact_uri }
    }
  }
`;

interface SampledToken {
  mime: string | null;
  thumbnail_uri: string | null;
  display_uri: string | null;
  artifact_uri: string | null;
}

interface RangeResponse { oldest: Array<{ id: number }>; newest: Array<{ id: number }> }
interface SampleResponse { listing: Array<{ token: SampledToken }> }

interface Probe {
  mime: string;
  status: number;
  bytes: number;
  contentType: string;
  ms: number;
}

async function probe(token: SampledToken): Promise<Probe> {
  const mime = token.mime ?? "unknown";
  // The same fallback the card normaliser applies before the route sees it.
  const source = convertIpfsUrl(token.thumbnail_uri || token.display_uri || token.artifact_uri || undefined);
  const started = Date.now();
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const buffer = await response.arrayBuffer();
    return {
      mime,
      status: response.status,
      bytes: buffer.byteLength,
      contentType: response.headers.get("content-type") ?? "",
      ms: Date.now() - started,
    };
  } catch {
    return { mime, status: 0, bytes: 0, contentType: "", ms: Date.now() - started };
  }
}

function percentile(sorted: number[], rank: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * rank))];
}

async function main() {
  const range = await objktClient.request<RangeResponse>(rangeQuery);
  const oldest = range.oldest[0]?.id;
  const newest = range.newest[0]?.id;
  if (oldest === undefined || newest === undefined) {
    throw new Error("OBJKT returned no active listings to sample.");
  }

  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(SAMPLE_SIZE / pageSize));
  const startIds = Array.from({ length: pageCount }, (_, index) => (
    Math.floor(oldest + ((newest - oldest) * index) / pageCount)
  ));
  const pages = await Promise.all(startIds.map((startId) => (
    objktClient.request<SampleResponse>(sampleQuery, { limit: pageSize, startId })
  )));

  const tokens = pages
    .flatMap((page) => page.listing)
    .map((row) => row.token)
    .slice(0, SAMPLE_SIZE);

  console.log(`Probing ${tokens.length} token thumbnails via ${IPFS_GATEWAYS[0]}`);
  const probes: Probe[] = [];
  for (const token of tokens) {
    probes.push(await probe(token));
    await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  }

  const ok = probes.filter((p) => p.status === 200);
  const timedOut = probes.filter((p) => p.status === 0);
  const failed = probes.filter((p) => p.status !== 200 && p.status !== 0);
  const overBudget = ok.filter((p) => p.bytes > BUDGET_BYTES);
  const animated = ok.filter((p) => /webp|gif/.test(p.contentType));
  const drawn = ok.filter((p) => (
    /png|jpeg/.test(p.contentType) && p.bytes <= BUDGET_BYTES && p.ms <= BUDGET_MS
  ));

  const sizes = ok.map((p) => p.bytes).sort((a, b) => a - b);
  const times = ok.map((p) => p.ms).sort((a, b) => a - b);
  const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;
  const pct = (n: number) => `${((n / probes.length) * 100).toFixed(1)}%`;

  console.log(`\nwould draw     ${drawn.length}/${probes.length} (${pct(drawn.length)})`);
  console.log(`reachable      ${ok.length} (${pct(ok.length)})`);
  console.log(`timed out      ${timedOut.length} (${pct(timedOut.length)})`);
  const failedBy = Object.entries(Object.groupBy(failed, (p) => String(p.status)))
    .map(([status, rows]) => `${status}×${rows?.length}`).join(" ");
  console.log(`errored        ${failed.length} (${pct(failed.length)}) ${failedBy}`);
  console.log(`over ${kb(BUDGET_BYTES)}      ${overBudget.length} (${pct(overBudget.length)})`);
  console.log(`webp/gif       ${animated.length} (${pct(animated.length)})`);
  console.log(`\nsize   p50 ${kb(percentile(sizes, 0.5))}  p90 ${kb(percentile(sizes, 0.9))}  p99 ${kb(percentile(sizes, 0.99))}  max ${kb(sizes[sizes.length - 1] ?? 0)}`);
  console.log(`time   p50 ${percentile(times, 0.5)}ms  p90 ${percentile(times, 0.9)}ms  p99 ${percentile(times, 0.99)}ms`);

  const byMime = new Map<string, { n: number; over: number }>();
  for (const p of ok) {
    const entry = byMime.get(p.mime) ?? { n: 0, over: 0 };
    entry.n += 1;
    if (p.bytes > BUDGET_BYTES) entry.over += 1;
    byMime.set(p.mime, entry);
  }
  console.log("\nover-budget by source mime:");
  for (const [mime, entry] of [...byMime].sort((a, b) => b[1].over - a[1].over).slice(0, 8)) {
    console.log(`  ${mime.padEnd(18)} ${entry.over}/${entry.n}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
