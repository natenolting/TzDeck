// The film's format and cue sheet. REEL sets the canvas, length, output file and poster frame.
// CUES is in beats on the bpm grid; film.js and music.mjs both read it, so retiming a moment
// moves its picture and its sound together. Loaded as a plain script by index.html and imported
// for its side effect by the Node scripts.
//
// Formats: 1080x1920 (9:16 Reels, Shorts, TikTok), 1080x1080 (1:1 feeds), 1920x1080 (16:9 site,
// YouTube). film.js lays out for portrait or landscape from the canvas shape.
globalThis.REEL = { name: 'demo-reel', width: 1080, height: 1920, duration: 20, poster: 6.2 };

globalThis.CUES = {
  bpm: 120,
  hook: 0,              // the headline lands
  slam: 1,              // the hero screen slams in
  wobble: [2, 3],
  hookLine: 2,          // the one-line pitch
  features: [8, 16, 24], // each feature whips in; one per COPY.features entry
  logo: 32,             // the lockup starts
  logoIn: 32.1,
  name: 32.5,
  words: [33, 33.5, 34], // one per COPY.words entry
  cta: 34.5,            // the URL pill
  footnote: 35,
};
