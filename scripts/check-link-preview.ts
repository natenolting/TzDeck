// Checks what a link-preview crawler actually receives for a URL: the OG and
// Twitter tags, then the preview image itself. A 200 on the page proves
// nothing -- platforms drop the whole card when the image is missing, the
// wrong size, or served as the wrong type.

const CRAWLER_UA =
  "Mozilla/5.0 (compatible; Twitterbot/1.0)";

const REQUIRED = [
  "og:title",
  "og:description",
  "og:image",
  "og:url",
  "og:type",
  "twitter:card",
] as const;

function parseMeta(html: string): Map<string, string> {
  const found = new Map<string, string>();
  const tag = /<meta\s+[^>]*>/gi;
  for (const match of html.matchAll(tag)) {
    const el = match[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(el)?.[1];
    const value = /content\s*=\s*["']([^"']*)["']/i.exec(el)?.[1];
    if (key && value !== undefined) found.set(key.toLowerCase(), value);
  }
  return found;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: tsx check-link-preview.ts <url>");
    process.exit(2);
  }

  const problems: string[] = [];
  const page = await fetch(target, { headers: { "user-agent": CRAWLER_UA }, redirect: "follow" });
  console.log(`page   ${page.status} ${page.headers.get("content-type") ?? ""}`);
  if (!page.ok) problems.push(`page returned ${page.status}`);

  const meta = parseMeta(await page.text());
  console.log("");
  for (const key of REQUIRED) {
    const value = meta.get(key);
    console.log(`${key.padEnd(18)} ${value ?? "MISSING"}`);
    if (!value) problems.push(`${key} missing`);
  }

  const card = meta.get("twitter:card");
  if (card && card !== "summary_large_image") {
    problems.push(`twitter:card is "${card}", wanted summary_large_image`);
  }

  const imageUrl = meta.get("og:image");
  if (imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl)) {
      problems.push("og:image is not absolute; crawlers will not resolve it");
    }
    const started = Date.now();
    const image = await fetch(new URL(imageUrl, target), { headers: { "user-agent": CRAWLER_UA } });
    const bytes = new Uint8Array(await image.arrayBuffer());
    const ms = Date.now() - started;
    const size = pngSize(bytes);
    console.log("");
    console.log(`image  ${image.status} ${image.headers.get("content-type") ?? ""} ${Math.round(bytes.length / 1024)}KB in ${ms}ms`);
    console.log(`cache  ${image.headers.get("cache-control") ?? "(none)"}`);
    const vercel = image.headers.get("x-vercel-cache");
    if (vercel) console.log(`x-vercel-cache ${vercel}`);
    console.log(`dims   ${size ? `${size.width}x${size.height}` : "not a PNG"}`);

    if (!image.ok) problems.push(`og:image returned ${image.status}`);
    if (bytes.length === 0) problems.push("og:image is empty");
    if (size && (size.width !== 1200 || size.height !== 630)) {
      problems.push(`og:image is ${size.width}x${size.height}, wanted 1200x630`);
    }
    if (ms > 5000) problems.push(`og:image took ${ms}ms; crawlers give up around 5s`);
  }

  console.log("");
  if (problems.length === 0) {
    console.log("OK: this URL will unfurl with a large image card.");
  } else {
    console.log(`${problems.length} problem(s):`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
