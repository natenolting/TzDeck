// Demo reel. window.seek(t) paints frame t; nothing depends on wall-clock time. The springs, text
// and image helpers come from lib.js. This is a starting cut (hook, one scene per feature, lockup);
// rewrite the scenes around the product's own signature moment rather than keeping them as is.

// ---------------------------------------------------------------- brand
// From the product's own CSS tokens or brand guide, never guessed. text() and background() read BRAND.
const BRAND = {
  bg: '#0b0c10', surface: '#15171e', border: 'rgba(255,255,255,0.12)',
  text: '#f4f5f8', text2: '#a9adbb', text3: '#7c8091', accent: '#5b6cff',
  display: 'Inter', body: 'Inter',
};

// ---------------------------------------------------------------- copy
// Every line is a placeholder. Write it from the product's own site and docs.
const COPY = {
  hook: 'PRODUCT.',
  hookLine: 'One line on what it does for you.',
  features: [
    { title: 'FIRST.', line: 'The first thing it does well.', screen: 'feature1' },
    { title: 'SECOND.', line: 'The second thing it does well.', screen: 'feature2' },
    { title: 'THIRD.', line: 'The third thing it does well.', screen: 'feature3' },
  ],
  name: 'Product',
  words: ['Verb.', 'Verb.', 'Verb.'],
  url: 'product.com',
  footnote: 'Free to start.',
};

// ---------------------------------------------------------------- assets
// Captured by capture.mjs from shots.json. A missing file renders as a labeled placeholder in stills.
const SRC = {
  logo: 'assets/logo.svg',
  hero: 'assets/hero.png',
  feature1: 'assets/feature-1.png',
  feature2: 'assets/feature-2.png',
  feature3: 'assets/feature-3.png',
};
const IMG = {};
async function loadAssets() {
  for (const [key, src] of Object.entries(SRC)) IMG[key] = await load(src);
}

// ---------------------------------------------------------------- layout
// Sizes scale with the short side, so a caption is 48 px on a 1080 px canvas whatever the shape.
const PORTRAIT = H >= W;
const U = Math.min(W, H) / 1080;
const CAPTION = { size: 48 * U, weight: 600, family: BRAND.body, color: BRAND.text2 };
// Portrait and square stack the screen under the copy; landscape sets it beside the copy.
const LAYOUT = (() => {
  if (!PORTRAIT) return { title: [W * 0.07, H * 0.47], line: [W * 0.07, H * 0.47 + 100 * U], align: 'left', stage: [W * 0.72, H / 2, W * 0.44, H * 0.84], copyW: W * 0.38 };
  const ty = H * (H / W > 1.5 ? 0.2 : 0.17), top = ty + 170 * U, bottom = H * 0.94;
  return { title: [W / 2, ty], line: [W / 2, ty + 100 * U], align: 'center', stage: [W / 2, (top + bottom) / 2, W * 0.8, bottom - top], copyW: W * 0.9 };
})();

/** A captured screen fitted inside a w x h box at (cx, cy), framed like a device, with a soft accent glow. */
function screen(img, cx, cy, w, h, { scale = 1, rot = 0, alpha = 1 } = {}) {
  if (alpha <= 0 || scale <= 0) return;
  const fit = Math.min(w / img.width, h / img.height);
  const sw = img.width * fit, sh = img.height * fit, r = 40 * U;
  g.save();
  fade(alpha);
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(scale, scale);
  g.shadowColor = hexA(BRAND.accent, 0.45);
  g.shadowBlur = 90 * U;
  roundRect(-sw / 2, -sh / 2, sw, sh, r);
  g.fillStyle = BRAND.surface; g.fill();
  g.shadowBlur = 0;
  g.save(); g.clip();
  g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  g.restore();
  g.lineWidth = 3 * U; g.strokeStyle = BRAND.border; roundRect(-sw / 2, -sh / 2, sw, sh, r); g.stroke();
  g.restore();
}

/** A headline and its caption, rising in at tIn and dropping out at tOut. */
function headline(t, title, line, tIn, tOut, size = 210) {
  const [tx, ty] = LAYOUT.title, [lx, ly] = LAYOUT.line;
  const s = fitSize(title, size * U, LAYOUT.copyW, { tracking: 4 * U });
  riseText(title, tx, ty, t, tIn, { size: s, tracking: 4 * U, align: LAYOUT.align }, tOut);
  riseText(line, lx, ly, t, tIn + b(1), { ...CAPTION, size: fitSize(line, CAPTION.size, LAYOUT.copyW, CAPTION), align: LAYOUT.align }, tOut);
}

// ---------------------------------------------------------------- scenes
function hook(t) {
  const out = b(Q.features[0]);
  if (t >= out + 0.6) return;
  headline(t, COPY.hook, COPY.hookLine, b(Q.hook), out - b(0.5), 260);
  const [cx, cy, w, h] = LAYOUT.stage;
  const drop = spring(t - b(Q.slam), 320, 22);
  const y = lerp(H + h, cy, drop) - H * spring(t - out, 190, 26);
  const push = 1 + 0.05 * clamp((t - b(Q.slam)) / (out - b(Q.slam)));
  screen(IMG.hero, cx, y, w, h, { scale: push, rot: wobble(t, Q.wobble.map(b), 0.03) });
}

function feature(t, i) {
  const tIn = b(Q.features[i]), tOut = b(Q.features[i + 1] ?? Q.logo);
  if (t < tIn - 0.3 || t > tOut + 0.8) return;
  const f = COPY.features[i];
  const off = whip(t, tIn, tOut);
  g.save();
  g.translate(0, off);
  const [cx, cy, w, h] = LAYOUT.stage;
  const drift = clamp((t - tIn) / (tOut - tIn));
  const side = i % 2 ? -1 : 1;
  screen(IMG[f.screen], cx, cy, w, h, { scale: 0.96 + 0.08 * drift, rot: side * (0.03 - 0.03 * drift) });
  g.restore();
  headline(t, f.title, f.line, tIn + b(0.5), tOut - b(0.5));
}

function lockup(t) {
  if (t < b(Q.logo)) return;
  // The stack (logo, name, words, URL, footnote) is centered, and tighter on a landscape canvas.
  const L = U * (PORTRAIT ? 1 : 0.78);
  const lw = 260 * L, lh = lw * IMG.logo.height / IMG.logo.width;
  const logoY = H / 2 - 330 * L, nameY = logoY + lh / 2 + 190 * L;
  const p = spring(t - b(Q.logoIn), 200, 18);
  drawImg(IMG.logo, W / 2, logoY, lw, { scale: p, glow: hexA(BRAND.accent, 0.6), glowBlur: 70 * L });
  riseText(COPY.name, W / 2, nameY, t, b(Q.name), { size: fitSize(COPY.name, 160 * L, W * 0.9) });
  COPY.words.forEach((word, i) => riseText(word, W / 2 + (i - (COPY.words.length - 1) / 2) * 260 * L, nameY + 110 * L, t,
    b(Q.words[i]), { ...CAPTION, size: 56 * L }));
  const pill = spring(t - b(Q.cta), 260, 22);
  if (pill > 0) {
    const size = 68 * L;
    g.save();
    g.font = `700 ${size}px ${BRAND.display}`;
    const pw = g.measureText(COPY.url).width + 140 * L, ph = 140 * L;
    g.translate(W / 2, nameY + 300 * L);
    g.scale(pill, pill);
    roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    g.fillStyle = BRAND.accent; g.fill();
    text(COPY.url, 0, size * 0.35, { size, weight: 700 });
    g.restore();
  }
  riseText(COPY.footnote, W / 2, nameY + 470 * L, t, b(Q.footnote), { ...CAPTION, size: Math.max(48 * U, CAPTION.size * L), color: BRAND.text3 });
}

// ---------------------------------------------------------------- frame
function draw(t) {
  background(t);
  hook(t);
  COPY.features.forEach((_, i) => feature(t, i));
  lockup(t);
  filmGrain(t);
}

run(draw, loadAssets, ['800 100px Inter', '700 100px Inter', '600 40px Inter', '500 40px Inter']);
