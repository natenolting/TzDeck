// The film's format and cue sheet. REEL sets the canvas, length, output file and poster frame for
// the demo-reel engine. CUES is in beats on the 120 BPM grid; film.js and music.mjs both read it,
// so retiming a moment moves its picture and its sound together. Loaded as a plain script by
// index.html and imported for its side effect by the Node scripts.
globalThis.REEL = { name: 'tzdeck-promo', width: 1080, height: 1920, duration: 20, poster: 8.2 };
globalThis.CUES = {
  bpm: 120,
  pull: 0,              // "PULL." lands
  slam: 1,              // the pack slams in
  wobble: [2, 3],
  tear: 4,              // the top strip rips off
  burst: 5,             // light burst; the pack body drops away
  fan: 6,               // five card backs deal out
  flips: [8, 9, 10, 11],
  breakdown: 12,        // drums drop out, the hero card lifts and shakes
  hero: 14,             // the hero card flips
  collect: 20,
  battle: 26,
  hits: [28, 29, 30, 31],
  battleOut: 31.6,
  rarity: 32,           // first rarity chip
  rarityStep: 0.3,      // beats between chips
  logo: 35,             // chips collapse into the logo
  logoIn: 35.1,
  name: 35.5,
  words: [36, 36.5, 37], // Pull. Collect. Battle.
  cta: 37.1,
  footnote: 37.5,
};
