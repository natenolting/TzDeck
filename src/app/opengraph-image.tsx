import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "TzDeck — pull, collect and battle Tezos NFTs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const [OXANIUM_REGULAR, OXANIUM_BOLD] = await Promise.all([
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Regular.ttf")),
  readFile(path.join(process.cwd(), "assets/og/Oxanium-Bold.ttf")),
]);

// The five rarity tiers, in ladder order. The card has no artwork to show, so
// the rarity ramp is the thing that says which product this is.
const TIERS = ["#64748b", "#34d399", "#22d3ee", "#a78bfa", "#fbbf24"];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          backgroundColor: "#07080f",
          backgroundImage:
            "radial-gradient(circle at 18% 0%, #6366f133, transparent 55%)",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {TIERS.map((hex) => (
              <div
                key={hex}
                style={{ display: "flex", width: 84, height: 8, borderRadius: 4, backgroundColor: hex }}
              />
            ))}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Oxanium",
              fontWeight: 700,
              fontSize: 132,
              color: "#f2f4fa",
              letterSpacing: -3,
              marginTop: 44,
            }}
          >
            TzDeck
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Oxanium",
              fontWeight: 700,
              fontSize: 46,
              color: "#818cf8",
              marginTop: 8,
            }}
          >
            Pull. Collect. Battle.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Oxanium",
              fontWeight: 400,
              fontSize: 31,
              color: "#a5abc2",
              maxWidth: 900,
            }}
          >
            Open free booster packs of Tezos art from OBJKT, build a deck from
            your own wallet, and battle other collectors.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              marginTop: 34,
              paddingTop: 26,
              borderTop: "1px solid rgba(255,255,255,0.1)",
              fontFamily: "Oxanium",
            }}
          >
            <div style={{ display: "flex", fontWeight: 400, fontSize: 26, color: "#6c7390" }}>
              tzdeck.xyz
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oxanium", data: OXANIUM_REGULAR, style: "normal", weight: 400 },
        { name: "Oxanium", data: OXANIUM_BOLD, style: "normal", weight: 700 },
      ],
    },
  );
}
