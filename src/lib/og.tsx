import { readFile } from "node:fs/promises";
import path from "node:path";

import { readCodepointCoverage } from "@/lib/fontCoverage";
import { getObjktThumbnailUrl, type NFTCard } from "@/lib/objkt";

// Shared by the generated link previews: a card's (/c/.../og) and a battle
// result's (/b/.../og). Server-only: it reads fonts off disk at import.

/**
 * Oxanium is the brand face, and an all-Oxanium card is more on-brand than a
 * mixed setting, which is lucky: Inter Regular's static instance is 325KB
 * against Oxanium's 24KB, and the whole render has a byte budget to keep.
 */
export const [OXANIUM_REGULAR, OXANIUM_BOLD] = await Promise.all([
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Regular.ttf")),
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Bold.ttf")),
]);
export const COVERAGE = readCodepointCoverage(OXANIUM_REGULAR);

/** The font list every preview passes to ImageResponse. */
export const OG_FONTS = [
  { name: "Oxanium", data: OXANIUM_REGULAR, style: "normal", weight: 400 },
  { name: "Oxanium", data: OXANIUM_BOLD, style: "normal", weight: 700 },
] as const;

/**
 * 15.7% of listings blow this budget, and they are almost entirely animated
 * tokens that satori could not rasterise anyway. The fonts take 49KB, so this
 * leaves comfortable headroom under the render's own ceiling.
 */
const ARTWORK_BYTE_CEILING = 400 * 1024;

/** Every major crawler gives up somewhere past this; the p90 fetch is 825ms. */
const ARTWORK_TIMEOUT_MS = 2000;

export type Artwork =
  | { drawn: true; src: string }
  | { drawn: false; reason: "animated" | "oversize" | "timeout" | "unreachable" };

/**
 * The media type of `bytes` if resvg can decode it, and null if it cannot.
 *
 * Trusting the `Content-Type` header is not enough here, because the failure is
 * not a missing image, it is a 500. Handing satori a WebP throws inside the
 * response stream, past the point any try/catch of ours could reach, and a
 * crawler that gets a 500 for og:image drops the whole preview. So the
 * signature has the last word, and only the two formats verified to rasterise
 * get through.
 */
function sniffRasterisable(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
}

/**
 * OBJKT's CDN still, under a hard byte and time budget.
 *
 * Animated GIF and WebP arrive as animated WebP at full size in every
 * derivative, `thumb288` included, so there is no smaller variant to fall back
 * to and no point spending the bytes on something satori renders as a single
 * frame at best. Rejecting the content type outright costs a handful of small
 * animations their artwork and saves every large one.
 */
export async function loadArtwork(card: NFTCard): Promise<Artwork> {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), ARTWORK_TIMEOUT_MS);

  try {
    const response = await fetch(getObjktThumbnailUrl(card), { signal: abort.signal });
    if (!response.ok) return { drawn: false, reason: "unreachable" };

    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type === "image/webp" || type === "image/gif") {
      return { drawn: false, reason: "animated" };
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > ARTWORK_BYTE_CEILING) {
      return { drawn: false, reason: "oversize" };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > ARTWORK_BYTE_CEILING) {
      return { drawn: false, reason: "oversize" };
    }

    const sniffed = sniffRasterisable(bytes);
    if (sniffed === null) return { drawn: false, reason: "animated" };

    return { drawn: true, src: `data:${sniffed};base64,${bytes.toString("base64")}` };
  } catch {
    return { drawn: false, reason: abort.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(deadline);
  }
}

/** A rarity hue at partial opacity, spelled out so satori never parses 8-digit hex. */
export function tint(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * The one element on the card doing acquisition work, so it gets its own row
 * and a rule above it rather than being crowded in beside the stats.
 */
export function Credit({ scale, verb = "Found on" }: { scale: number; verb?: string }) {
  return (
    <div
      style={{
        display: "flex",
        marginTop: Math.round(28 * scale),
        paddingTop: Math.round(20 * scale),
        borderTop: "1px solid rgba(255, 255, 255, 0.16)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ display: "flex", fontSize: Math.round(19 * scale), color: "#79809b" }}>
          {verb}
        </div>
        <div
          style={{
            display: "flex",
            marginLeft: 9,
            fontSize: Math.round(26 * scale),
            fontWeight: 700,
            color: "#f2f4fa",
          }}
        >
          TzDeck
        </div>
        <div style={{ display: "flex", marginLeft: 9, fontSize: Math.round(17 * scale), color: "#79809b" }}>
          {"· tzdeck.xyz"}
        </div>
      </div>
    </div>
  );
}
