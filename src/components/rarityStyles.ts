import { RARITY_LABELS, type CardRarity } from "@/lib/rarity";

/**
 * Presentation for each rarity tier.
 *
 * Rarity is expressed through the card frame only -- ring, glow and badge --
 * never as a wash over the artwork, so the art stays the one saturated thing
 * on a card. Every surface that shows a rarity reads from here, so a tier
 * cannot mean emerald in one place and indigo in another.
 */
export const RARITY_CONFIG: Record<
  CardRarity,
  {
    label: string;
    /** A small solid swatch, as in the About page's legend. */
    dot: string;
    ring: string;
    badge: string;
    text: string;
    glow: string;
  }
> = {
  common: {
    label: RARITY_LABELS.common,
    dot: "bg-rarity-common",
    ring: "ring-1 ring-rarity-common/60 hover:ring-rarity-common",
    text: "text-rarity-common",
    badge: "border-rarity-common/40 bg-rarity-common/15 text-rarity-common",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-common)] hover:shadow-[0_0_30px_-7px_var(--rarity-common)]",
  },
  uncommon: {
    label: RARITY_LABELS.uncommon,
    dot: "bg-rarity-uncommon",
    ring: "ring-1 ring-rarity-uncommon/60 hover:ring-rarity-uncommon",
    text: "text-rarity-uncommon",
    badge: "border-rarity-uncommon/40 bg-rarity-uncommon/15 text-rarity-uncommon",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-uncommon)] hover:shadow-[0_0_30px_-7px_var(--rarity-uncommon)]",
  },
  rare: {
    label: RARITY_LABELS.rare,
    dot: "bg-rarity-rare",
    ring: "ring-1 ring-rarity-rare/60 hover:ring-rarity-rare",
    text: "text-rarity-rare",
    badge: "border-rarity-rare/40 bg-rarity-rare/15 text-rarity-rare",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-rare)] hover:shadow-[0_0_30px_-7px_var(--rarity-rare)]",
  },
  epic: {
    label: RARITY_LABELS.epic,
    dot: "bg-rarity-epic",
    ring: "ring-1 ring-rarity-epic/60 hover:ring-rarity-epic",
    text: "text-rarity-epic",
    badge: "border-rarity-epic/40 bg-rarity-epic/15 text-rarity-epic",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-epic)] hover:shadow-[0_0_30px_-7px_var(--rarity-epic)]",
  },
  legendary: {
    label: RARITY_LABELS.legendary,
    dot: "bg-rarity-legendary",
    ring: "ring-1 ring-rarity-legendary/60 hover:ring-rarity-legendary",
    text: "text-rarity-legendary",
    badge: "border-rarity-legendary/40 bg-rarity-legendary/15 font-bold text-rarity-legendary",
    glow: "shadow-[0_0_28px_-8px_var(--rarity-legendary)] hover:shadow-[0_0_34px_-5px_var(--rarity-legendary)]",
  },
};

/**
 * Literal hex per tier, for renderers that cannot read the stylesheet.
 *
 * satori, which rasterises the OG card behind `next/og`, resolves neither
 * Tailwind classes nor `var(--rarity-*)`, so everything in RARITY_CONFIG is
 * unusable there. These mirror the `--rarity-*` declarations in globals.css,
 * and rarityStyles.test.ts fails if the two drift or if a new tier lands here
 * without a colour.
 */
export const RARITY_HEX: Record<CardRarity, string> = {
  common: "#64748b",
  uncommon: "#34d399",
  rare: "#22d3ee",
  epic: "#a78bfa",
  legendary: "#fbbf24",
};
