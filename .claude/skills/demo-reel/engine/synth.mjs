// The score's synthesizer: a stereo buffer the length of the film, a set of instruments that add
// voices into it, and master() to limit, normalize and write out/score.wav. music.mjs holds the
// arrangement and calls these in order. The noise source is seeded, so the same calls give the
// same file, byte for byte.
import { writeFileSync, mkdirSync } from 'node:fs';
import './timeline.js';

export const SR = 48000, DUR = REEL.duration, BEAT = 60 / CUES.bpm;
export const b = (n) => n * BEAT;
const N = Math.round(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);

let seed = 7;
export const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
export const TAU = Math.PI * 2;
export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Adds a voice rendered sample by sample. fn(t, dt) returns a mono sample; pan is -1..1. */
export function add(start, len, gain, pan, fn) {
  const s0 = Math.floor(start * SR), n = Math.floor(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < N; i++) {
    if (s0 + i < 0) continue;
    const v = fn(i / SR);
    L[s0 + i] += v * gl;
    R[s0 + i] += v * gr;
  }
}

/** One-pole lowpass whose cutoff can move over time. */
export function lowpass() {
  let y = 0;
  return (x, cutoff) => { const a = 1 - Math.exp(-TAU * cutoff / SR); y += a * (x - y); return y; };
}

// ---------------------------------------------------------------- instruments
export function kick(t0, gain = 0.9) {
  let phase = 0;
  add(t0, 0.5, gain, 0, (t) => {
    phase += TAU * (45 + 110 * Math.exp(-t * 30)) / SR;
    return Math.sin(phase) * Math.exp(-t * 7) + (t < 0.004 ? noise() * 0.4 : 0);
  });
}

export function clap(t0, gain = 0.35) {
  const lp = lowpass();
  add(t0, 0.25, gain, 0.1, (t) => {
    const env = [0, 0.011, 0.022].reduce((v, o) => v + (t >= o ? Math.exp(-(t - o) * (o === 0.022 ? 18 : 90)) : 0), 0);
    const x = noise();
    return (x - lp(x, 1200)) * env;
  });
}

export function hat(t0, gain = 0.1, pan = 0.35) {
  const lp = lowpass();
  add(t0, 0.06, gain, pan, (t) => { const x = noise(); return (x - lp(x, 7000)) * Math.exp(-t * 70); });
}

export function bass(t0, len, note, gain = 0.32) {
  const f = midi(note), lp = lowpass();
  add(t0, len, gain, 0, (t) => {
    const saw = [1, 2, 3, 4, 5].reduce((v, h) => v + Math.sin(TAU * f * h * t) / h, 0);
    const pump = 1 - Math.exp(-t * 14);
    return lp(saw, 380 + 600 * Math.exp(-t * 6)) * pump * Math.exp(-t * 1.2);
  });
}

export function pluck(t0, note, gain = 0.12, pan = 0) {
  const f = midi(note);
  add(t0, 0.5, gain, pan, (t) =>
    (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t) + 0.12 * Math.sin(TAU * 3 * f * t)) * Math.exp(-t * 9));
}

export function bell(t0, note, gain = 0.14, pan = 0, decay = 1.6) {
  const f = midi(note);
  add(t0, 2.5, gain, pan, (t) =>
    [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]].reduce((v, [p, a]) => v + a * Math.sin(TAU * f * p * t) * Math.exp(-t * decay * p * 0.6), 0));
}

export function riser(t0, len, gain = 0.22) {
  const lp = lowpass();
  add(t0, len, gain, 0, (t) => { const p = t / len; return lp(noise(), 300 + 9000 * p * p) * p * p; });
}

export function whoosh(t0, len = 0.45, gain = 0.3, pan = 0) {
  const lp = lowpass();
  add(t0, len, gain, pan, (t) => { const p = t / len; return lp(noise(), 400 + 5000 * Math.sin(Math.PI * p)) * Math.sin(Math.PI * p); });
}

export function rip(t0, gain = 0.4) {
  const lp = lowpass();
  add(t0, 0.4, gain, -0.1, (t) => {
    const crackle = Math.abs(Math.sin(t * 900 + Math.sin(t * 130) * 4)) > 0.7 ? 1 : 0.25;
    const x = noise();
    return (x - lp(x, 1500)) * crackle * Math.exp(-t * 5);
  });
}

export function impact(t0, gain = 1) {
  kick(t0, 0.9 * gain);
  const lp = lowpass();
  add(t0, 1.2, 0.35 * gain, 0, (t) => lp(noise(), 900) * Math.exp(-t * 4));
  add(t0, 1.2, 0.35 * gain, 0, (t) => Math.sin(TAU * 36 * t) * Math.exp(-t * 3));
}

export function punch(t0, gain = 0.6, pan = 0) {
  kick(t0, 0.5 * gain);
  const lp = lowpass();
  add(t0, 0.18, gain, pan, (t) => { const x = noise(); return (x - lp(x, 800)) * Math.exp(-t * 28); });
}

export function flick(t0, gain = 0.28, pan = 0) {
  add(t0, 0.08, gain, pan, (t) => Math.sin(TAU * (2600 - 9000 * t) * t) * Math.exp(-t * 60) + noise() * 0.3 * Math.exp(-t * 90));
}

// ---------------------------------------------------------------- master
/** Soft-clips, fades the last 0.8 s, peak-normalizes and writes out/score.wav. finish.mjs sets loudness. */
export function master() {
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const fadeOut = Math.min(1, (N - i) / (SR * 0.8));
    L[i] = Math.tanh(L[i] * 1.1) * fadeOut;
    R[i] = Math.tanh(R[i] * 1.1) * fadeOut;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const scale = 0.89 / peak;

  const out = Buffer.alloc(44 + N * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    out.writeInt16LE(Math.round(L[i] * scale * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(R[i] * scale * 32767), 46 + i * 4);
  }
  mkdirSync('out', { recursive: true });
  writeFileSync('out/score.wav', out);
  console.log(`out/score.wav: ${DUR}s stereo, peak normalized from ${peak.toFixed(2)}`);
}
