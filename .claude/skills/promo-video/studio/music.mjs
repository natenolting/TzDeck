// node music.mjs  The score's arrangement, locked to the film's cue sheet. The instruments and
// the master live in synth.mjs (from the demo-reel engine); this file only places them in time.
import './timeline.js';
import { BEAT, b, add, noise, kick, clap, hat, bass, pluck, bell, riser, whoosh, rip, impact, punch, flick, master } from './synth.mjs';

const Q = globalThis.CUES;

// ---------------------------------------------------------------- arrangement
// Am - F - C - G, one chord per bar (2 s). Roots for bass, triads for plucks.
const CHORDS = [[57, [69, 72, 76]], [53, [69, 72, 77]], [48, [67, 72, 76]], [55, [67, 71, 74]]];
const chordAt = (t) => CHORDS[Math.floor(t / 2) % 4];

// Hook: two impacts, wobble ticks, a riser into the tear.
impact(b(Q.pull), 1);
impact(b(Q.slam), 0.8);
flick(b(Q.wobble[0]), 0.18, -0.4);
flick(b(Q.wobble[1]), 0.18, 0.4);
riser(b(Q.wobble[0]), b(Q.burst) - b(Q.wobble[0]), 0.2);
rip(b(Q.tear));
whoosh(b(Q.burst) - 0.1, 0.5, 0.35);

// Groove from the fan-out to the lockup, with a breakdown before the hero flip.
const BREAK = [b(Q.breakdown), b(Q.hero)];
for (let beat = Q.fan; beat < Q.logo; beat++) {
  const t = b(beat);
  const inBreak = t >= BREAK[0] && t < BREAK[1];
  if (!inBreak) kick(t, 0.75);
  if (!inBreak && beat % 2 === 1) clap(t);
  hat(t + BEAT / 2, inBreak ? 0.05 : 0.09, beat % 2 ? 0.35 : -0.35);
  const [root, triad] = chordAt(t);
  if (!inBreak) bass(t, BEAT * 0.95, root - 12 + 12);
  for (let s = 0; s < 4; s++) {
    const note = triad[(beat * 4 + s) % 3] + (s === 3 ? 12 : 0);
    pluck(t + s * BEAT / 4, note, inBreak ? 0.05 : 0.08, s % 2 ? 0.45 : -0.45);
  }
}
for (let i = 0; i < 8; i++) clap(BREAK[0] + i * 0.125, 0.12 + i * 0.03);
riser(BREAK[0], BREAK[1] - BREAK[0], 0.28);

// Card flips on beats 8-11, then the hero.
[-0.5, 0.5, -0.25, 0.25].forEach((pan, i) => flick(b(Q.flips[i]), 0.3, pan));
impact(b(Q.hero), 1.1);
[81, 84, 88, 91].forEach((n, i) => bell(b(Q.hero) + i * 0.06, n, 0.1, i % 2 ? 0.4 : -0.4, 1.2));
add(b(Q.hero), 2.2, 0.12, 0, (t) => noise() * Math.exp(-t * 2.2));

// Collect whip, battle slam and hits.
whoosh(b(Q.collect) - 0.15, 0.45, 0.3, -0.2);
impact(b(Q.battle), 0.9);
punch(b(Q.hits[0]), 0.6, 0.3);
punch(b(Q.hits[1]), 0.6, -0.3);
punch(b(Q.hits[2]), 0.6, 0.3);
whoosh(b(Q.hits[3]), 0.25, 0.25, -0.3);
whoosh(b(Q.battleOut), 0.35, 0.25, 0.2);

// Rarity chips: one rising tick per tier.
[69, 72, 76, 79, 84].forEach((n, i) => bell(b(Q.rarity) + i * b(Q.rarityStep), n, 0.07, i % 2 ? 0.3 : -0.3, 3));

// Lockup: a chime on the logo, one pluck per word, a pop for the pill.
impact(b(Q.logoIn), 0.7);
[57, 64, 69, 73, 76].forEach((n, i) => bell(b(Q.logoIn) + i * 0.04, n + 12, 0.08, 0, 0.9));
Q.words.map(b).forEach((t, i) => pluck(t, [76, 79, 81][i], 0.12));
flick(b(Q.cta), 0.25);

master();
