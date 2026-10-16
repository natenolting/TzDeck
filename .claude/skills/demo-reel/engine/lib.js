// The film's toolkit, loaded as a plain script after timeline.js and before film.js, so film.js
// sees everything here as globals. film.js declares BRAND ({ bg, text, accent, display, body }),
// which the helpers below read when called. Nothing here reads wall-clock time: a frame is a
// function of t alone, which is what lets render.mjs paint any frame in any order.
const W = REEL.width, H = REEL.height, DUR = REEL.duration, BEAT = 60 / CUES.bpm;
const b = (n) => n * BEAT;
const Q = globalThis.CUES;

const cv = document.getElementById('c');
cv.width = W;
cv.height = H;
const g = cv.getContext('2d');
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, z, p) => a + (z - a) * p;
/** Canvas silently ignores a globalAlpha outside [0, 1], so every write goes through here. */
const fade = (a) => { g.globalAlpha = clamp(g.globalAlpha * a); };

function spring(t, k = 170, d = 26) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k), z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** A value with several targets: one spring per change, so any frame renders on its own. */
function track(t, keys, k, d) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
  return v;
}

/** A decaying wobble started at each time in `hits`. */
function wobble(t, hits, amp, freq = 28, decay = 7) {
  let v = 0;
  for (const h of hits) if (t > h) v += amp * Math.exp(-decay * (t - h)) * Math.sin(freq * (t - h));
  return v;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
    x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- assets
/** Assets that failed to load. render.mjs allows stills with placeholders, never a full render. */
window.missing = [];

/** Loads an image. A missing file becomes a labeled placeholder, so stills can block out timing before capture. */
const load = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => {
    window.missing.push(src);
    const ph = document.createElement('canvas');
    ph.width = 900; ph.height = 1200;
    const pc = ph.getContext('2d');
    pc.fillStyle = '#2a2d3a'; pc.fillRect(0, 0, ph.width, ph.height);
    pc.strokeStyle = '#ff3b8d'; pc.lineWidth = 12; pc.strokeRect(6, 6, ph.width - 12, ph.height - 12);
    pc.fillStyle = '#ff3b8d'; pc.font = '600 44px sans-serif'; pc.textAlign = 'center';
    pc.fillText('MISSING', ph.width / 2, ph.height / 2 - 20);
    pc.fillText(src.split('/').pop(), ph.width / 2, ph.height / 2 + 40);
    resolve(ph);
  };
  img.src = src;
});

let grain = null;
function buildGrain() {
  grain = document.createElement('canvas');
  grain.width = grain.height = 256;
  const gc = grain.getContext('2d');
  const data = gc.createImageData(256, 256);
  const r = rng(11);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = r() * 255;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  gc.putImageData(data, 0, 0);
}

/**
 * Starts the film: awaits `loadAssets()` and `fonts` (CSS font shorthands such as '800 100px Oxanium'),
 * then exposes window.seek(t) for the renderer. Opened in a normal browser, it also plays on a loop.
 */
function run(draw, loadAssets, fonts) {
  window.ready = (async () => {
    await loadAssets();
    await Promise.all(fonts.map((font) => document.fonts.load(font)));
    buildGrain();
    return true;
  })();
  window.seek = (t) => { draw(t); return true; };
  if (!navigator.webdriver) {
    window.ready.then(() => {
      const t0 = performance.now();
      (function loop() {
        draw(((performance.now() - t0) / 1000) % DUR);
        requestAnimationFrame(loop);
      })();
    });
  }
}

// ---------------------------------------------------------------- drawing helpers
function text(str, x, y, { size = 100, weight = 800, family = BRAND.display, color = BRAND.text, align = 'center', tracking = 0, alpha = 1 } = {}) {
  if (alpha <= 0) return;
  g.save();
  fade(alpha);
  g.font = `${weight} ${size}px ${family}`;
  g.letterSpacing = `${tracking}px`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillStyle = color;
  g.fillText(str, x, y);
  g.restore();
}

/** The largest size up to `size` at which `str` fits in `maxW`, for copy whose length isn't known up front. */
function fitSize(str, size, maxW, { weight = 800, family = BRAND.display, tracking = 0 } = {}) {
  g.save();
  g.font = `${weight} ${size}px ${family}`;
  g.letterSpacing = `${tracking}px`;
  const w = g.measureText(str).width;
  g.restore();
  return w > maxW ? size * maxW / w : size;
}

/** Text that rises out of a mask line on a spring, and drops back out when `tOut` passes. */
function riseText(str, x, y, t, tIn, opts = {}, tOut = Infinity) {
  const size = opts.size ?? 100;
  const p = spring(t - tIn, 240, 24) - spring(t - tOut, 260, 26);
  if (p <= 0.001 && t > tIn) return;
  if (t < tIn) return;
  const dir = t > tOut ? -1 : 1;
  g.save();
  g.beginPath();
  g.rect(0, y - size * 1.0, W, size * 1.3);
  g.clip();
  text(str, x, y + dir * (1 - p) * size * 1.15, opts);
  g.restore();
}

function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function drawImg(img, cx, cy, w, { rot = 0, sx = 1, scale = 1, alpha = 1, glow = null, glowBlur = 90 } = {}) {
  if (alpha <= 0 || scale <= 0) return;
  const h = w * img.height / img.width;
  g.save();
  fade(alpha);
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(sx * scale, scale);
  if (glow) { g.shadowColor = glow; g.shadowBlur = glowBlur; }
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
}

/** The brand surface with a slow drifting glow that pulses on every beat. */
function background(t, glow = BRAND.accent, glowAlpha = 0.22) {
  g.fillStyle = BRAND.bg;
  g.fillRect(0, 0, W, H);
  const gx = W / 2 + Math.sin(t * 0.6) * 160, gy = H * 0.42 + Math.cos(t * 0.45) * 120;
  const pulse = 1 + 0.08 * Math.exp(-6 * ((t % BEAT)));
  const grad = g.createRadialGradient(gx, gy, 0, gx, gy, 900 * pulse);
  grad.addColorStop(0, hexA(glow, glowAlpha));
  grad.addColorStop(1, hexA(glow, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function filmGrain(t) {
  const frame = Math.floor(t * 24);
  const r = rng(frame + 1);
  g.save();
  g.globalAlpha = 0.05;
  g.globalCompositeOperation = 'overlay';
  const ox = Math.floor(r() * 256), oy = Math.floor(r() * 256);
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) g.drawImage(grain, x, y);
  g.restore();
}

/** Vertical offset for a scene that enters from below at tIn and leaves upward at tOut. */
function whip(t, tIn, tOut) {
  return H * (1 - spring(t - tIn, 190, 26)) - H * spring(t - tOut, 190, 26);
}
