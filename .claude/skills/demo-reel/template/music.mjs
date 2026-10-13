// node music.mjs  The score's arrangement, locked to the cue sheet. The instruments and master
// live in synth.mjs; this file only places them in time. Rewrite it alongside the scenes: every
// cut gets a sound, and the groove drops out before the moment the film builds to.
import './timeline.js';
import { BEAT, b, kick, clap, hat, bass, pluck, bell, riser, whoosh, impact, flick, master } from './synth.mjs';

const Q = globalThis.CUES;

// Am - F - C - G, one chord per bar. Roots for bass, triads for plucks.
const CHORDS = [[57, [69, 72, 76]], [53, [69, 72, 77]], [48, [67, 72, 76]], [55, [67, 71, 74]]];
const chordAt = (beat) => CHORDS[Math.floor(beat / 4) % 4];

// Hook: the headline and the screen each land on an impact, the wobble ticks, a riser into the groove.
impact(b(Q.hook), 1);
impact(b(Q.slam), 0.8);
flick(b(Q.wobble[0]), 0.18, -0.4);
flick(b(Q.wobble[1]), 0.18, 0.4);
riser(b(Q.wobble[1]), b(Q.features[0]) - b(Q.wobble[1]), 0.22);

// Groove from the first feature to the lockup.
for (let beat = Q.features[0]; beat < Q.logo; beat++) {
  const t = b(beat);
  kick(t, 0.75);
  if (beat % 2 === 1) clap(t);
  hat(t + BEAT / 2, 0.09, beat % 2 ? 0.35 : -0.35);
  const [root, triad] = chordAt(beat);
  bass(t, BEAT * 0.95, root);
  for (let s = 0; s < 4; s++) pluck(t + s * BEAT / 4, triad[(beat * 4 + s) % 3] + (s === 3 ? 12 : 0), 0.07, s % 2 ? 0.45 : -0.45);
}

// Each feature whips in.
Q.features.forEach((beat, i) => { whoosh(b(beat) - 0.15, 0.45, 0.3, i % 2 ? 0.2 : -0.2); if (i > 0) impact(b(beat), 0.5); });
riser(b(Q.logo - 4), b(4), 0.18);

// Lockup: a chime on the logo, one pluck per word, a pop for the URL.
impact(b(Q.logoIn), 0.8);
[57, 64, 69, 73, 76].forEach((n, i) => bell(b(Q.logoIn) + i * 0.04, n + 12, 0.08, 0, 0.9));
Q.words.forEach((beat, i) => pluck(b(beat), [76, 79, 81][i % 3], 0.12));
flick(b(Q.cta), 0.25);

master();
