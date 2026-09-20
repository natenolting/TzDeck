import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { RARITY_CONFIG, RARITY_HEX } from "@/components/rarityStyles";
import { coversText, readCodepointCoverage } from "@/lib/fontCoverage";
import { getObjktThumbnailUrl, type NFTCard } from "@/lib/objkt";
import { parseCardRef } from "@/lib/share";
import { loadSharedCard } from "@/lib/shareServer";

export const alt = "A card on TzDeck";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Oxanium is the brand face, and an all-Oxanium card is more on-brand than a
 * mixed setting, which is lucky: Inter Regular's static instance is 325KB
 * against Oxanium's 24KB, and the whole render has a byte budget to keep.
 */
const [OXANIUM_REGULAR, OXANIUM_BOLD] = await Promise.all([
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Regular.ttf")),
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Bold.ttf")),
]);
const COVERAGE = readCodepointCoverage(OXANIUM_REGULAR);

/**
 * 15.7% of listings blow this budget, and they are almost entirely animated
 * tokens that satori could not rasterise anyway. The fonts take 49KB, so this
 * leaves comfortable headroom under the render's own ceiling.
 */
const ARTWORK_BYTE_CEILING = 400 * 1024;

/** Every major crawler gives up somewhere past this; the p90 fetch is 825ms. */
const ARTWORK_TIMEOUT_MS = 2000;

/**
 * `(contract, tokenId)` names one token forever and its artwork never changes,
 * so a card that rendered its art needs no invalidation story. A degraded
 * render must not get the same treatment, or one bad minute at the CDN pins a
 * broken card there for a year.
 */
const CACHE_RESOLVED = "public, max-age=31536000, s-maxage=31536000, immutable";
const CACHE_DEGRADED = "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

type Artwork =
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
async function loadArtwork(card: NFTCard): Promise<Artwork> {
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
function tint(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

type CardText = {
  name: string | null;
  artist: string | null;
  editions: string;
  price: string;
};

/**
 * The strings the card will actually set, with anything the font cannot draw
 * removed rather than emitted as tofu. Prices are spelled "tez" because the
 * tez sign sits outside Oxanium; see fontCoverage.test.ts.
 */
function resolveText(card: NFTCard, nameLimit: number): CardText {
  const drawable = (text: string | undefined): string | null => (
    text && coversText(COVERAGE, text) ? text : null
  );
  const name = drawable(card.name);

  return {
    name: name && name.length > nameLimit ? `${name.slice(0, nameLimit - 1).trimEnd()}…` : name,
    artist: drawable(card.artist_alias),
    editions: card.editions === 1 ? "1 edition" : `${card.editions ?? "—"} editions`,
    price: card.price_xtz !== undefined ? `${card.price_xtz} tez` : "Not listed",
  };
}

function nameSize(name: string, scale: number): number {
  const base = name.length <= 24 ? 46 : name.length <= 48 ? 38 : 32;
  return Math.round(base * scale);
}

function RarityPill({ label, hex, scale }: { label: string; hex: string; scale: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        borderRadius: 999,
        border: `1px solid ${tint(hex, 0.35)}`,
        backgroundColor: tint(hex, 0.14),
        color: hex,
        padding: `${Math.round(6 * scale)}px ${Math.round(18 * scale)}px`,
        fontSize: Math.round(17 * scale),
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 2,
      }}
    >
      {label}
    </div>
  );
}

function Stat({ label, value, color, scale }: {
  label: string;
  value: string;
  color: string;
  scale: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: Math.round(19 * scale), color: "#6c7390" }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 4,
          fontSize: Math.round(25 * scale),
          fontWeight: 700,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The one element on the card doing acquisition work, so it gets its own row
 * and a rule above it rather than being crowded in beside the stats.
 */
function Credit({ scale }: { scale: number }) {
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
        <div style={{ display: "flex", fontSize: Math.round(19 * scale), color: "#6c7390" }}>
          Found on
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
        <div style={{ display: "flex", marginLeft: 9, fontSize: Math.round(17 * scale), color: "#6c7390" }}>
          {"· tzdeck.xyz"}
        </div>
      </div>
    </div>
  );
}

/**
 * Both compositions set every box explicitly. satori resolves `flex: 1` against
 * content rather than the remaining track, so a grown column overflows the
 * canvas silently, and `space-between` does nothing without a fixed height.
 */
function Details({ card, text, hex, scale, width, padding }: {
  card: NFTCard;
  text: CardText;
  hex: string;
  scale: number;
  width: number;
  padding: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height: size.height,
        padding,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <RarityPill label={RARITY_CONFIG[card.rarity].label} hex={hex} scale={scale} />
        {text.name && (
          <div
            style={{
              display: "flex",
              marginTop: Math.round(26 * scale),
              fontSize: nameSize(text.name, scale),
              fontWeight: 700,
              lineHeight: 1.12,
              color: "#f2f4fa",
            }}
          >
            {text.name}
          </div>
        )}
        {text.artist && (
          <div
            style={{
              display: "flex",
              marginTop: Math.round(18 * scale),
              fontSize: Math.round(26 * scale),
              color: "#a5abc2",
            }}
          >
            by {text.artist}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: Math.round(36 * scale) }}>
          <Stat label="Editions" value={text.editions} color="#f2f4fa" scale={scale} />
          <Stat label="Listed" value={text.price} color="#818cf8" scale={scale} />
        </div>
        <Credit scale={scale} />
      </div>
    </div>
  );
}

/** Artwork left, details right. The card as the artist-spotlight unit. */
function ArtworkCard({ card, artworkSrc, hex }: {
  card: NFTCard;
  artworkSrc: string;
  hex: string;
}) {
  const text = resolveText(card, 72);
  const art = size.height;
  return (
    <div
      style={{
        display: "flex",
        width: size.width,
        height: size.height,
        backgroundColor: "#07080f",
        fontFamily: "Oxanium",
      }}
    >
      <div style={{ display: "flex", position: "relative", width: art, height: art, backgroundColor: "#000000" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={artworkSrc} alt="" width={art} height={art} style={{ objectFit: "cover" }} />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: art,
            height: art,
            boxShadow: `inset 0 0 120px -40px ${hex}`,
          }}
        />
      </div>
      <Details
        card={card}
        text={text}
        hex={hex}
        scale={1}
        width={size.width - art}
        padding={48}
      />
    </div>
  );
}

/**
 * The card for a token whose artwork cannot travel: animated, oversized, or
 * simply not there in time. This is one share in six, not an edge case, so it
 * is a composition of its own rather than the other card with a hole in it.
 */
function NoArtworkCard({ card, hex }: { card: NFTCard; hex: string }) {
  const text = resolveText(card, 96);
  const bar = 14;
  return (
    <div
      style={{
        display: "flex",
        width: size.width,
        height: size.height,
        backgroundColor: "#07080f",
        backgroundImage: `linear-gradient(135deg, ${tint(hex, 0.22)} 0%, #07080f 58%)`,
        fontFamily: "Oxanium",
      }}
    >
      <div style={{ display: "flex", width: bar, height: size.height, backgroundColor: hex }} />
      <Details
        card={card}
        text={text}
        hex={hex}
        scale={1.6}
        width={size.width - bar}
        padding={64}
      />
    </div>
  );
}

type Props = { params: Promise<{ contract: string; tokenId: string }> };

export default async function Image({ params }: Props) {
  const { contract, tokenId } = await params;
  const ref = parseCardRef(contract, tokenId);
  if (!ref) notFound();

  const card = await loadSharedCard(ref);
  if (!card) notFound();

  const hex = RARITY_HEX[card.rarity];
  const artwork = await loadArtwork(card);

  return new ImageResponse(
    artwork.drawn
      ? <ArtworkCard card={card} artworkSrc={artwork.src} hex={hex} />
      : <NoArtworkCard card={card} hex={hex} />,
    {
      ...size,
      fonts: [
        { name: "Oxanium", data: OXANIUM_REGULAR, style: "normal", weight: 400 },
        { name: "Oxanium", data: OXANIUM_BOLD, style: "normal", weight: 700 },
      ],
      headers: {
        "Cache-Control": artwork.drawn ? CACHE_RESOLVED : CACHE_DEGRADED,
      },
    },
  );
}
