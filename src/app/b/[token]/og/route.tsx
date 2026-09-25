import { ImageResponse } from "next/og";

import { RARITY_HEX } from "@/components/rarityStyles";
import { loadBattleShare, type ResolvedBattleShare } from "@/lib/battleShareServer";
import { coversText } from "@/lib/fontCoverage";
import { calculateSupplyRarity } from "@/lib/objkt";
import { COVERAGE, Credit, loadArtwork, OG_FONTS, tint } from "@/lib/og";
import { OG_IMAGE_SIZE } from "@/lib/share";

/**
 * The battle behind a token never changes, but its cards can: an artist opting
 * out has to reach links shared before, so even a fully drawn result is cached
 * for a day rather than the card preview's year. A degraded render gets the
 * card preview's short cache, so one bad minute at the CDN doesn't stick.
 */
const CACHE_RESOLVED = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
const CACHE_DEGRADED = "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

const WIN_GREEN = "#22c55e";
const TEXT = "#f2f4fa";
const TEXT_SECONDARY = "#a5abc2";
const TEXT_TERTIARY = "#79809b";

type BattleText = {
  name: string;
  artist: string | null;
  beat: string;
  opponentHex: string;
};

/** Every string the preview sets, minus anything the font can't draw. */
function resolveText(resolved: ResolvedBattleShare, nameLimit: number): BattleText {
  const drawable = (text: string | undefined): string | null => (
    text && coversText(COVERAGE, text) ? text : null
  );
  const rawName = drawable(resolved.winnerCard?.name) ?? "A card";
  const name = rawName.length > nameLimit ? `${rawName.slice(0, nameLimit - 1).trimEnd()}…` : rawName;
  const rounds = resolved.share.rounds === 1 ? "1 round" : `${resolved.share.rounds} rounds`;
  return {
    name,
    artist: drawable(resolved.winnerCard?.artist_alias),
    // The opponent by tier only: its art and name stay on the page (#81).
    beat: `Beat ${resolved.opponentPhrase} in ${rounds}`,
    opponentHex: resolved.opponentRarity ? RARITY_HEX[resolved.opponentRarity] : TEXT_SECONDARY,
  };
}

function nameSize(name: string, scale: number): number {
  const base = name.length <= 24 ? 46 : name.length <= 48 ? 38 : 32;
  return Math.round(base * scale);
}

function Stat({ label, value, scale }: { label: string; value: string; scale: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: Math.round(19 * scale), color: TEXT_TERTIARY }}>{label}</div>
      <div style={{ display: "flex", marginTop: 4, fontSize: Math.round(25 * scale), fontWeight: 700, color: TEXT }}>
        {value}
      </div>
    </div>
  );
}

/** Explicit boxes throughout, as in the card preview: satori sizes flex:1 by content. */
function Details({ resolved, text, scale, width, padding }: {
  resolved: ResolvedBattleShare;
  text: BattleText;
  scale: number;
  width: number;
  padding: number;
}) {
  const { winnerSide } = resolved.share;
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
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            borderRadius: 999,
            border: `1px solid ${tint(WIN_GREEN, 0.4)}`,
            backgroundColor: tint(WIN_GREEN, 0.14),
            color: WIN_GREEN,
            padding: `${Math.round(6 * scale)}px ${Math.round(18 * scale)}px`,
            fontSize: Math.round(17 * scale),
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          Victory
        </div>
        <div
          style={{
            display: "flex",
            marginTop: Math.round(26 * scale),
            fontSize: nameSize(text.name, scale),
            fontWeight: 700,
            lineHeight: 1.12,
            color: TEXT,
          }}
        >
          {text.name}
        </div>
        {text.artist && (
          <div style={{ display: "flex", marginTop: Math.round(14 * scale), fontSize: Math.round(24 * scale), color: TEXT_SECONDARY }}>
            by {text.artist}
          </div>
        )}
        <div
          style={{
            display: "flex",
            marginTop: Math.round(22 * scale),
            fontSize: Math.round(26 * scale),
            fontWeight: 700,
            color: text.opponentHex,
          }}
        >
          {text.beat}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: Math.round(36 * scale) }}>
          <Stat label="HP left" value={`${winnerSide.finalHp} / ${winnerSide.maxHp}`} scale={scale} />
          <Stat label="Power" value={String(winnerSide.power)} scale={scale} />
        </div>
        <Credit scale={scale} verb="Won on" />
      </div>
    </div>
  );
}

/** The winner's artwork left, the result right. Only the winner is drawn. */
function ArtworkResult({ resolved, artworkSrc, hex }: { resolved: ResolvedBattleShare; artworkSrc: string; hex: string }) {
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
      <Details resolved={resolved} text={resolveText(resolved, 60)} scale={1} width={OG_IMAGE_SIZE.width - art} padding={48} />
    </div>
  );
}

/** For a winner whose artwork can't travel, or can't be shown at all. */
function NoArtworkResult({ resolved, hex }: { resolved: ResolvedBattleShare; hex: string }) {
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
      <Details resolved={resolved} text={resolveText(resolved, 80)} scale={1.45} width={OG_IMAGE_SIZE.width - bar} padding={64} />
    </div>
  );
}

type Context = { params: Promise<{ token: string }> };

/**
 * An explicit handler, like the card preview's, so the Cache-Control set here
 * is the one served. A token that doesn't verify answers with a bare 404: a
 * crawler that got an HTML error page under an image type would drop the whole
 * preview.
 */
export async function GET(_request: Request, { params }: Context) {
  const { token } = await params;
  const resolved = await loadBattleShare(token);
  if (!resolved) return new Response(null, { status: 404 });

  const { winnerCard } = resolved;
  const hex = winnerCard ? RARITY_HEX[calculateSupplyRarity(winnerCard.editions)] : WIN_GREEN;
  const artwork = winnerCard ? await loadArtwork(winnerCard) : null;

  const image = new ImageResponse(
    artwork?.drawn
      ? <ArtworkResult resolved={resolved} artworkSrc={artwork.src} hex={hex} />
      : <NoArtworkResult resolved={resolved} hex={hex} />,
    { ...OG_IMAGE_SIZE, fonts: [...OG_FONTS] },
  );
  image.headers.set("Cache-Control", artwork?.drawn ? CACHE_RESOLVED : CACHE_DEGRADED);
  return image;
}
