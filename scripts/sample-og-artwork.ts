import { objktClient } from "../src/lib/objkt";

// Link-preview images are rendered by satori, which fetches the artwork and
// rasterises it under a 500KB bundle ceiling. OBJKT serves pre-resized
// derivatives from its own CDN, but animated tokens come back at full size in
// every derivative, so the ceiling is a real constraint rather than a
// formality. This measures how much of the live catalogue clears it.

const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE ?? 300);
const CDN = "https://assets.objkt.media/file/assets-003";
const DERIVATIVE = process.env.DERIVATIVE ?? "thumb400";
const BUDGET_BYTES = Number(process.env.BUDGET_BYTES ?? 320_000);
const CONCURRENCY = 12;

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
      token { fa_contract token_id mime }
    }
  }
`;

interface RangeResponse { oldest: Array<{ id: number }>; newest: Array<{ id: number }> }
interface SampleResponse {
  listing: Array<{ token: { fa_contract: string; token_id: string; mime: string | null } }>;
}

interface Probe {
  mime: string;
  status: number;
  bytes: number;
  contentType: string;
  ms: number;
}

async function probe(contract: string, tokenId: string, mime: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(`${CDN}/${contract}/${tokenId}/${DERIVATIVE}`);
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
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

  console.log(`Probing ${tokens.length} tokens at ${CDN}/<contract>/<id>/${DERIVATIVE}`);
  const probes = await mapLimit(tokens, CONCURRENCY, (token) => (
    probe(token.fa_contract, token.token_id, token.mime ?? "unknown")
  ));

  const ok = probes.filter((p) => p.status === 200);
  const missing = probes.filter((p) => p.status === 404);
  const failed = probes.filter((p) => p.status !== 200 && p.status !== 404);
  const overBudget = ok.filter((p) => p.bytes > BUDGET_BYTES);
  const animated = ok.filter((p) => p.contentType.includes("webp"));

  const sizes = ok.map((p) => p.bytes).sort((a, b) => a - b);
  const times = ok.map((p) => p.ms).sort((a, b) => a - b);
  const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;
  const pct = (n: number) => `${((n / probes.length) * 100).toFixed(1)}%`;

  console.log(`\nreachable      ${ok.length}/${probes.length} (${pct(ok.length)})`);
  console.log(`no derivative  ${missing.length} (${pct(missing.length)})`);
  console.log(`errored        ${failed.length} (${pct(failed.length)})`);
  console.log(`over ${kb(BUDGET_BYTES)}      ${overBudget.length} (${pct(overBudget.length)})`);
  console.log(`webp (animated) ${animated.length} (${pct(animated.length)})`);
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
