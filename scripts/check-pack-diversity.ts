import { fetchRandomPack } from "../src/lib/objkt";
import { PACK_MAX_PER_ARTIST } from "../src/lib/pullDraw";

const PACKS = 12;

async function main() {
  let worstRepeat = 0;
  let totalDistinct = 0;
  let short = 0;

  for (let index = 0; index < PACKS; index += 1) {
    // No denylist argument: this script measures diversity against the OBJKT
    // rules alone, so it needs no database.
    const { cards } = await fetchRandomPack(5);
    if (cards.length < 5) short += 1;

    const counts = new Map<string, number>();
    for (const card of cards) {
      const artist = card.artist_address || card.artist_alias || "unattributed";
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    }
    const maxRepeat = counts.size > 0 ? Math.max(...counts.values()) : 0;
    worstRepeat = Math.max(worstRepeat, maxRepeat);
    totalDistinct += counts.size;

    console.log(
      `pack ${String(index + 1).padStart(2)}: ${cards.length} cards, `
      + `${counts.size} distinct artists, max ${maxRepeat} from one`,
    );
  }

  console.log(`\ncap: ${PACK_MAX_PER_ARTIST} per artist`);
  console.log(`average distinct artists per 5-card pack: ${(totalDistinct / PACKS).toFixed(2)}`);
  console.log(`worst single-artist count: ${worstRepeat}`);
  console.log(`short packs: ${short}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
