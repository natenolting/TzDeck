/**
 * Which characters a vendored font can actually draw.
 *
 * satori has no system font fallback: hand it a name in Persian, Cyrillic or
 * CJK with a Latin-only font loaded and it emits tofu boxes, silently, in a
 * 200 response. For a project whose whole pitch is spotlighting artists
 * worldwide, shipping a broken card is worse than shipping a plain one, so the
 * OG route asks the font itself what it covers and drops the text it cannot
 * draw.
 *
 * The answer comes from the font's own `cmap` table rather than a hand-written
 * list of Unicode blocks, so swapping in a font with wider coverage widens what
 * renders without anyone remembering to edit a range list.
 */

/** Inclusive codepoint ranges, ascending, non-overlapping. */
export type CodepointRanges = ReadonlyArray<readonly [number, number]>;

function u16(font: Uint8Array, at: number): number {
  return (font[at] << 8) | font[at + 1];
}

function u32(font: Uint8Array, at: number): number {
  return u16(font, at) * 0x10000 + u16(font, at + 2);
}

function tag(font: Uint8Array, at: number): string {
  return String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]);
}

function findTable(font: Uint8Array, wanted: string): number | null {
  const tableCount = u16(font, 4);
  for (let i = 0; i < tableCount; i += 1) {
    const record = 12 + i * 16;
    if (tag(font, record) === wanted) return u32(font, record + 8);
  }
  return null;
}

/**
 * The Unicode subtable to read, preferring the one that reaches past the BMP.
 * Windows Unicode (3,10) and (3,1) are what a modern TrueType ships; platform 0
 * is the Apple-flavoured spelling of the same thing.
 */
function findUnicodeSubtable(font: Uint8Array, cmap: number): number | null {
  const subtableCount = u16(font, cmap + 2);
  let best: { rank: number; at: number } | null = null;

  for (let i = 0; i < subtableCount; i += 1) {
    const record = cmap + 4 + i * 8;
    const platform = u16(font, record);
    const encoding = u16(font, record + 2);
    const at = cmap + u32(font, record + 4);

    const rank = platform === 3 && encoding === 10 ? 3
      : platform === 3 && encoding === 1 ? 2
      : platform === 0 ? 1
      : 0;
    if (rank > 0 && (best === null || rank > best.rank)) best = { rank, at };
  }

  return best?.at ?? null;
}

function readFormat4(font: Uint8Array, at: number): Array<[number, number]> {
  const segments = u16(font, at + 6) / 2;
  const endCodes = at + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const ranges: Array<[number, number]> = [];

  for (let i = 0; i < segments; i += 1) {
    const start = u16(font, startCodes + i * 2);
    const end = u16(font, endCodes + i * 2);
    // The final segment is the mandatory 0xFFFF terminator, not coverage.
    if (start === 0xffff || start > end) continue;
    ranges.push([start, end]);
  }
  return ranges;
}

function readFormat12(font: Uint8Array, at: number): Array<[number, number]> {
  const groupCount = u32(font, at + 12);
  const ranges: Array<[number, number]> = [];

  for (let i = 0; i < groupCount; i += 1) {
    const group = at + 16 + i * 12;
    if (u32(font, group + 8) === 0) continue;
    ranges.push([u32(font, group), u32(font, group + 4)]);
  }
  return ranges;
}

/**
 * Every codepoint the font maps to a glyph, as ranges.
 *
 * Returns an empty list for a font whose cmap uses a format this does not read,
 * which makes every string unrenderable and so falls back to the text-free
 * layout. That is the safe direction, and `fontCoverage.test.ts` fails if the
 * fonts this repo actually vendors ever land there.
 */
export function readCodepointCoverage(font: Uint8Array): CodepointRanges {
  const cmap = findTable(font, "cmap");
  if (cmap === null) return [];

  const subtable = findUnicodeSubtable(font, cmap);
  if (subtable === null) return [];

  const format = u16(font, subtable);
  const ranges = format === 4 ? readFormat4(font, subtable)
    : format === 12 ? readFormat12(font, subtable)
    : [];

  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * Codepoints that need no font coverage.
 *
 * `next/og` substitutes an image for emoji rather than asking the font, so an
 * emoji in a token name is not a reason to throw the whole name away. The
 * joiners and variation selectors are the glue that holds emoji sequences
 * together and draw nothing on their own.
 */
function isRenderedWithoutFont(codepoint: number): boolean {
  return codepoint === 0x200d
    || codepoint === 0xfe0e
    || codepoint === 0xfe0f
    || (codepoint >= 0x1f000 && codepoint <= 0x1ffff)
    || (codepoint >= 0x2600 && codepoint <= 0x27bf)
    || (codepoint >= 0x2b00 && codepoint <= 0x2bff);
}

/** Whether every character of `text` will draw as itself rather than as tofu. */
export function coversText(ranges: CodepointRanges, text: string): boolean {
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) continue;
    if (isRenderedWithoutFont(codepoint)) continue;
    if (!ranges.some(([start, end]) => codepoint >= start && codepoint <= end)) {
      return false;
    }
  }
  return true;
}
