import { ImageResponse } from "next/og";

import { RARITY_CONFIG, RARITY_HEX } from "@/components/rarityStyles";
import { coversText } from "@/lib/fontCoverage";
import type { NFTCard } from "@/lib/objkt";
import { COVERAGE, Credit, loadArtwork, OG_FONTS, tint } from "@/lib/og";
import { OG_IMAGE_SIZE, parseCardRef } from "@/lib/share";
import { loadSharedCard } from "@/lib/shareServer";

/**
 * `(contract, tokenId)` names one token forever and its artwork never changes,
 * so a card that rendered its art needs no invalidation story. A degraded
 * render must not get the same treatment, or one bad minute at the CDN pins a
 * broken card there for a year.
 */
const CACHE_RESOLVED = "public, max-age=31536000, s-maxage=31536000, immutable";
const CACHE_DEGRADED = "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

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
      <div style={{ display: "flex", fontSize: Math.round(19 * scale), color: "#79809b" }}>
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
        height: OG_IMAGE_SIZE.height,
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
  const art = OG_IMAGE_SIZE.height;
  return (
    <div
      style={{
        display: "flex",
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
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
        width={OG_IMAGE_SIZE.width - art}
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
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        backgroundColor: "#07080f",
        backgroundImage: `linear-gradient(135deg, ${tint(hex, 0.22)} 0%, #07080f 58%)`,
        fontFamily: "Oxanium",
      }}
    >
      <div style={{ display: "flex", width: bar, height: OG_IMAGE_SIZE.height, backgroundColor: hex }} />
      <Details
        card={card}
        text={text}
        hex={hex}
        scale={1.6}
        width={OG_IMAGE_SIZE.width - bar}
        padding={64}
      />
    </div>
  );
}

type Context = { params: Promise<{ contract: string; tokenId: string }> };

/**
 * An explicit handler rather than `opengraph-image.tsx`, because the file
 * convention's wrapper discards the `headers` passed to `ImageResponse` once
 * deployed and serves ImageResponse's own `max-age=0, must-revalidate`
 * instead, measured in production against `ed9e94a7`. Here the response is
 * ours and nothing rewraps it.
 *
 * A card that does not exist answers with a bare 404 rather than `notFound()`,
 * which would render an HTML error page under an image content type. A crawler
 * that cannot decode that drops the whole preview, not just the image.
 */
export async function GET(_request: Request, { params }: Context) {
  const { contract, tokenId } = await params;
  const ref = parseCardRef(contract, tokenId);
  if (!ref) return new Response(null, { status: 404 });

  const card = await loadSharedCard(ref);
  if (!card) return new Response(null, { status: 404 });

  const hex = RARITY_HEX[card.rarity];
  const artwork = await loadArtwork(card);

  const image = new ImageResponse(
    artwork.drawn
      ? <ArtworkCard card={card} artworkSrc={artwork.src} hex={hex} />
      : <NoArtworkCard card={card} hex={hex} />,
    {
      ...OG_IMAGE_SIZE,
      fonts: [...OG_FONTS],
    },
  );
  image.headers.set("Cache-Control", artwork.drawn ? CACHE_RESOLVED : CACHE_DEGRADED);
  return image;
}
