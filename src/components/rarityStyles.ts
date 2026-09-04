import type { CardRarity } from "@/lib/objkt";

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
    ring: string;
    badge: string;
    glow: string;
  }
> = {
  common: {
    label: "Common",
    ring: "ring-1 ring-rarity-common/60 hover:ring-rarity-common",
    badge: "border-rarity-common/40 bg-rarity-common/15 text-rarity-common",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-common)] hover:shadow-[0_0_30px_-7px_var(--rarity-common)]",
  },
  uncommon: {
    label: "Uncommon",
    ring: "ring-1 ring-rarity-uncommon/60 hover:ring-rarity-uncommon",
    badge: "border-rarity-uncommon/40 bg-rarity-uncommon/15 text-rarity-uncommon",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-uncommon)] hover:shadow-[0_0_30px_-7px_var(--rarity-uncommon)]",
  },
  rare: {
    label: "Rare",
    ring: "ring-1 ring-rarity-rare/60 hover:ring-rarity-rare",
    badge: "border-rarity-rare/40 bg-rarity-rare/15 text-rarity-rare",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-rare)] hover:shadow-[0_0_30px_-7px_var(--rarity-rare)]",
  },
  epic: {
    label: "Epic",
    ring: "ring-1 ring-rarity-epic/60 hover:ring-rarity-epic",
    badge: "border-rarity-epic/40 bg-rarity-epic/15 text-rarity-epic",
    glow: "shadow-[0_0_24px_-10px_var(--rarity-epic)] hover:shadow-[0_0_30px_-7px_var(--rarity-epic)]",
  },
  legendary: {
    label: "Legendary",
    ring: "ring-1 ring-rarity-legendary/60 hover:ring-rarity-legendary",
    badge: "border-rarity-legendary/40 bg-rarity-legendary/15 font-bold text-rarity-legendary",
    glow: "shadow-[0_0_28px_-8px_var(--rarity-legendary)] hover:shadow-[0_0_34px_-5px_var(--rarity-legendary)]",
  },
};
