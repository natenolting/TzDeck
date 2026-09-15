import type { CardRarity } from "@/lib/objkt";
import { mulberry32, trainerId } from "./rules";

const GRID = 44;
const COLS = 5;
const ROWS = 5;
const CELL = GRID / COLS;

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * One deterministic identicon per trainer tier -- a mirrored 5x5 blocky
 * grid, seeded from the trainer's id via the same mulberry32 PRNG
 * rules.ts already uses for combat resolution. Colored with the app's
 * existing --rarity-* CSS custom properties (globals.css) so it always
 * matches the deck's own rarity palette, including in a future theme swap.
 * No asset to store or upload -- cheap enough to call on every render.
 */
export function trainerAvatarSvg(tier: CardRarity): string {
  const rng = mulberry32(hashSeed(trainerId(tier)));
  const color = `var(--rarity-${tier})`;
  let cells = `<rect width="${GRID}" height="${GRID}" fill="#0d0f19" rx="5"/>`;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < Math.ceil(COLS / 2); x++) {
      if (rng() <= 0.55) continue;
      const mirrorX = COLS - 1 - x;
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="${color}"/>`;
      if (mirrorX !== x) {
        cells += `<rect x="${mirrorX * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="${color}"/>`;
      }
    }
  }
  return `<svg viewBox="0 0 ${GRID} ${GRID}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}
