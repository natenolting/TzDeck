// TzDeck promo. window.seek(t) paints frame t; nothing depends on wall-clock time. The springs,
// text and image helpers come from lib.js in the demo-reel engine.
const C = {
  bg: '#07080f', s1: '#0d0f19', s2: '#141727', border: 'rgba(255,255,255,0.10)',
  text: '#f2f4fa', text2: '#a5abc2', text3: '#79809b', accent: '#6366f1', accent2: '#818cf8',
  common: '#64748b', uncommon: '#34d399', rare: '#22d3ee', epic: '#a78bfa', legendary: '#fbbf24',
};

const BRAND = { ...C, display: 'Oxanium', body: 'Inter' };

// ---------------------------------------------------------------- assets
// The picks change every run. Captured cards are named <last 6 of contract>-<token id>; their grades
// and listing state are in assets/cards.json. The hero is the highest tier among listed works, since
// a pack only deals listings, and its tier drives the peak's label and color.
const HERO = { tier: 'epic', credit: '1 of 1  ·  Sequentia #72 by Nate Nolting' };
const SRC = {
  pack: 'assets/pack.png',
  back: 'assets/back.png',
  battle: 'assets/battle.png',
  logo: 'assets/tzdeck-shield-gradient-on-dark.svg',
  hero: 'assets/cards/dTrRvr-34703.png',
};
const FLIP_CARDS = ['XjRJHY-175', 'uNgnVC-66', 's7RUR4-36', 'uNgnVC-8'].map((name) => `assets/cards/${name}.png`);
const MARQUEE = [
  'uNgnVC-77', 's7RUR4-123', 'dTrRvr-39865', 'XjRJHY-179', 'uNgnVC-72', 's7RUR4-94',
  'dTrRvr-171578', 'dTrRvr-119322', 'uNgnVC-70', 's7RUR4-78', 'dTrRvr-39862', 'dTrRvr-113396',
  'uNgnVC-61', 's7RUR4-116', 'dTrRvr-121104', 'XjRJHY-174', 'uNgnVC-59', 's7RUR4-27',
  'dTrRvr-35577', 'dTrRvr-112304', 'uNgnVC-69', 's7RUR4-21', 'dTrRvr-162136', 's7RUR4-77',
].map((name) => `assets/cards/${name}.png`);

const IMG = {};
async function loadAssets() {
  for (const [key, src] of Object.entries(SRC)) IMG[key] = await load(src);
  IMG.flips = await Promise.all(FLIP_CARDS.map(load));
  IMG.marquee = await Promise.all(MARQUEE.map(load));
}

// ---------------------------------------------------------------- drawing helpers
/** A card that flips from its back to `front`, starting at `tFlip`. */
function flipCard(front, cx, cy, w, t, tFlip, opts = {}) {
  const p = clamp(spring(t - tFlip, 300, 30));
  const sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * p)));
  const pop = 1 + 0.1 * Math.sin(Math.PI * p);
  const face = p > 0.5 ? front : IMG.back;
  drawImg(face, cx, cy, w, { ...opts, sx, scale: (opts.scale ?? 1) * pop });
}

// ---------------------------------------------------------------- scenes
function hook(t) {
  const out = spring(t - b(Q.tear), 200, 24);
  riseText('PULL.', W / 2, 520, t, b(Q.pull), { size: 330, tracking: 6 }, b(Q.tear));

  const pw = 600, ph = pw * IMG.pack.height / IMG.pack.width;
  const drop = spring(t - b(Q.slam), 320, 22);
  const cy = lerp(-ph, 1130, drop) + 900 * spring(t - b(Q.burst), 90, 20);
  const rot = wobble(t, Q.wobble.map(b), 0.05) + 0.3 * spring(t - b(Q.burst), 90, 20);
  if (t < b(Q.tear)) {
    drawImg(IMG.pack, W / 2, cy, pw, { rot });
  } else {
    // The tear: the top strip flies off, the body drops away.
    const tear = 0.17;
    const topFly = spring(t - b(Q.tear), 140, 16);
    g.save();
    g.translate(W / 2 + 420 * topFly, cy - ph / 2 - 700 * topFly);
    g.rotate(rot + 0.9 * topFly);
    g.drawImage(IMG.pack, 0, 0, IMG.pack.width, IMG.pack.height * tear, -pw / 2, 0, pw, ph * tear);
    g.restore();
    g.save();
    g.translate(W / 2, cy);
    g.rotate(rot);
    g.drawImage(IMG.pack, 0, IMG.pack.height * tear, IMG.pack.width, IMG.pack.height * (1 - tear),
      -pw / 2, -ph / 2 + ph * tear, pw, ph * (1 - tear));
    g.restore();
    const slit = clamp((t - b(Q.tear)) / 0.25) * (1 - clamp((t - b(Q.burst)) / 0.3));
    if (slit > 0) {
      g.save();
      g.shadowColor = '#fff'; g.shadowBlur = 80;
      g.fillStyle = hexA('#ffffff', slit);
      g.fillRect(W / 2 - pw * 0.55 * slit, cy - ph / 2 + ph * tear - 5, pw * 1.1 * slit, 10);
      g.restore();
    }
  }
  riseText('5 random works listed on OBJKT right now', W / 2, 1790, t, b(Q.slam + 1),
    { size: 48, weight: 600, family: 'Inter', color: C.text2 }, b(Q.tear));
  const flash = clamp(1 - (t - b(Q.burst)) / 0.3) * (t >= b(Q.burst) ? 1 : 0);
  if (flash > 0) {
    const fy = 1130 - ph / 2 + ph * 0.17;
    const burst = g.createRadialGradient(W / 2, fy, 0, W / 2, fy, 900);
    burst.addColorStop(0, hexA('#ffffff', 0.45 * flash));
    burst.addColorStop(1, hexA(C.accent2, 0));
    g.fillStyle = burst; g.fillRect(0, 0, W, H);
  }
  return out;
}

const FAN = [0, 1, 2, 3, 4].map((i) => ({
  x: W / 2 + (i - 2) * 190, y: 1050 + Math.abs(i - 2) * 46, rot: (i - 2) * 0.075,
}));
const FLIP_AT = { 0: b(Q.flips[0]), 4: b(Q.flips[1]), 1: b(Q.flips[2]), 3: b(Q.flips[3]) };
const FLIP_FRONT = { 0: 0, 4: 1, 1: 2, 3: 3 };
const HERO_FLIP = b(Q.hero);

function pull(t) {
  riseText('Five cards.', W / 2, 330, t, b(Q.fan), { size: 120 }, b(Q.hero - 1));
  riseText('Every one graded.', W / 2, 420, t, b(Q.fan + 1), { size: 48, weight: 600, family: 'Inter', color: C.text2 }, b(Q.hero - 1));
  const tension = clamp((t - b(Q.breakdown)) / (HERO_FLIP - b(Q.breakdown)));
  const push = 1 + 0.1 * clamp((t - b(Q.fan)) / (HERO_FLIP - b(Q.fan))) - 0.1 * spring(t - HERO_FLIP, 150, 20);
  g.save();
  g.translate(W / 2, 1050); g.scale(push, push); g.translate(-W / 2, -1050);
  for (const i of [0, 4, 1, 3, 2]) {
    const f = FAN[i];
    const deal = spring(t - b(Q.fan) - Math.abs(i - 2) * 0.06, 230, 24);
    const scatter = spring(t - HERO_FLIP - 0.15, 150, 22);
    const outX = (i - 2) * 900;
    const x = lerp(W / 2, f.x, deal) + outX * scatter;
    const y = lerp(1250, f.y, deal) + 300 * scatter - (FLIP_AT[i] ? 26 * spring(t - FLIP_AT[i], 200, 20) : 0);
    const w = 300;
    const dim = i === 2 ? 1 : 1 - 0.45 * tension;
    if (i === 2) {
      const lift = spring(t - b(Q.breakdown), 120, 18);
      const shake = t < HERO_FLIP ? Math.sin(t * 70) * 5 * tension : 0;
      const grow = spring(t - HERO_FLIP, 150, 20);
      const cx = x + shake, cy = lerp(f.y - 70 * lift, 1040, grow);
      const cw = lerp(w * (1 + 0.12 * lift), 720, grow) * (1 + 0.07 * clamp((t - HERO_FLIP - 0.6) / 2.4));
      const glow = tension > 0 ? hexA(C[HERO.tier], 0.9 * tension + 0.1 * grow) : null;
      flipCard(IMG.hero, cx, cy, cw, t, HERO_FLIP, { rot: f.rot * (1 - grow) + 0.02 * Math.sin(Math.max(0, t - HERO_FLIP - 0.6) * 1.8) * grow, glow, glowBlur: 60 + 80 * tension });
      if (t > HERO_FLIP) heroFx(t, cx, cy, cw);
    } else {
      flipCard(IMG.flips[FLIP_FRONT[i]], x, y, w, t, FLIP_AT[i], { rot: f.rot, alpha: dim * clamp(deal) * clamp(1 - scatter) });
    }
  }
  g.restore();
}

function heroFx(t, cx, cy, cw) {
  for (const [start, width] of [[HERO_FLIP, 14], [HERO_FLIP + 0.25, 6]]) {
    const p = clamp((t - start) / 1.1);
    if (p <= 0 || p >= 1) continue;
    g.save();
    g.strokeStyle = hexA(C[HERO.tier], 0.8 * (1 - p));
    g.lineWidth = width * (1 - p) + 1;
    g.beginPath();
    g.arc(cx, cy, 200 + 1200 * (1 - Math.pow(1 - p, 3)), 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  for (const start of [0.6, 1.9]) {
  const sweep = (t - HERO_FLIP - start) / 0.9;
  if (sweep > 0 && sweep < 1) {
    const ch = cw * IMG.hero.height / IMG.hero.width;
    g.save();
    roundRect(cx - cw / 2, cy - ch / 2, cw, ch, 44);
    g.clip();
    const sx = lerp(cx - cw, cx + cw, sweep);
    const grad = g.createLinearGradient(sx - 160, cy - ch / 2, sx + 160, cy + ch / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = grad;
    g.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
    g.restore();
  }
  }
  riseText(HERO.tier.toUpperCase(), W / 2, 300, t, HERO_FLIP + 0.35, { size: 150, color: C[HERO.tier], tracking: 10 }, b(Q.collect - 0.5));
  riseText(HERO.credit, W / 2, 1720, t, HERO_FLIP + 0.85,
    { size: 48, weight: 600, family: 'Inter', color: C.text2 }, b(Q.collect - 0.5));
}

function collect(t) {
  const off = whip(t, b(Q.collect), b(Q.battle));
  if (Math.abs(off) >= H) return;
  g.save();
  g.translate(0, off);
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.12);
  g.scale(1.18, 1.18);
  const cw = 320, ch = cw * 1623 / 1074, gap = 34;
  for (let col = 0; col < 3; col++) {
    const dir = col === 1 ? -1 : 1;
    const speed = 170 + col * 40;
    const shift = dir * speed * (t - b(Q.collect)) + col * 190;
    for (let row = -4; row < 5; row++) {
      const idx = ((col * 8 + row) % IMG.marquee.length + IMG.marquee.length) % IMG.marquee.length;
      const y = row * (ch + gap) + (shift % (ch + gap));
      g.drawImage(IMG.marquee[idx], (col - 1) * (cw + gap) - cw / 2, y - ch / 2, cw, ch);
    }
  }
  g.restore();
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, hexA(C.bg, 0.9));
  shade.addColorStop(0.3, hexA(C.bg, 0.15));
  shade.addColorStop(0.7, hexA(C.bg, 0.15));
  shade.addColorStop(1, hexA(C.bg, 0.95));
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const band = spring(t - b(Q.collect + 0.5), 220, 26);
  g.fillStyle = hexA(C.bg, 0.88);
  g.fillRect(0, 780, W * band, 370);
  riseText('COLLECT.', W / 2, 1010, t, b(Q.collect + 1), { size: 210, tracking: 6 });
  riseText('Save your pulls. Browse your wallet as a deck.', W / 2, 1100, t, b(Q.collect + 2),
    { size: 48, weight: 600, family: 'Inter', color: C.text2 });
  g.restore();
}

const HITS = [
  { t: b(Q.hits[0]), n: '-51', side: 1 }, { t: b(Q.hits[1]), n: '-42', side: 0 },
  { t: b(Q.hits[2]), n: '-49', side: 1 }, { t: b(Q.hits[3]), n: 'MISS', side: 0 },
];

function battle(t) {
  if (t < b(Q.battle) - 0.3 || t > b(Q.rarity + 1)) return;
  const enter = spring(t - b(Q.battle), 260, 22);
  const exit = clamp((t - b(Q.battleOut)) / 0.3);
  const shake = HITS.reduce((v, h) => v + wobble(t, [h.t], 10, 45, 12), 0);
  g.save();
  g.translate(W / 2 + shake, 1040);
  const s = lerp(0.82, 1, enter) * (1 + 0.2 * exit) * (1 + 0.06 * clamp((t - b(Q.battle)) / 3));
  g.scale(s, s);
  fade(clamp(enter * 1.4) * clamp(1 - exit));
  const sy = 250, sh = 960, pw = 980, ph = pw * sh / IMG.battle.width;
  roundRect(-pw / 2, -ph / 2, pw, ph, 44);
  g.fillStyle = C.s1; g.fill();
  g.save(); g.clip();
  g.drawImage(IMG.battle, 0, sy, IMG.battle.width, sh, -pw / 2, -ph / 2, pw, ph);
  g.restore();
  g.lineWidth = 3; g.strokeStyle = C.border; roundRect(-pw / 2, -ph / 2, pw, ph, 44); g.stroke();
  for (const h of HITS) {
    const p = spring(t - h.t, 380, 18);
    const life = clamp(1 - (t - h.t - 0.35) / 0.2);
    if (t < h.t || life <= 0) continue;
    const x = h.side ? 260 : -250, y = -150 - 120 * clamp((t - h.t) / 0.55);
    text(h.n, x, y, { size: 130 * p, color: h.n === 'MISS' ? C.text2 : '#f87171', alpha: life });
  }
  g.restore();
  g.save();
  fade(clamp(1 - exit));
  riseText('BATTLE.', W / 2, 470, t, b(Q.battle), { size: 210, tracking: 6 });
  riseText('Fight other collectors.', W / 2, 1640, t, b(Q.battle + 1.5),
    { size: 48, weight: 600, family: 'Inter', color: C.text2 });
  riseText('Gain XP & level up.', W / 2, 1710, t, b(Q.battle + 2),
    { size: 48, weight: 600, family: 'Inter', color: C.text2 });
  g.restore();
}

const TIERS = [
  ['Common', C.common], ['Uncommon', C.uncommon], ['Rare', C.rare], ['Epic', C.epic], ['Legendary', C.legendary],
];

function rarity(t) {
  if (t < b(Q.rarity)) return;
  const collapse = spring(t - b(Q.logo), 260, 26);
  for (let i = 0; i < TIERS.length; i++) {
    const [label, color] = TIERS[i];
    const p = spring(t - b(Q.rarity) - i * b(Q.rarityStep), 300, 24);
    const cw = 640, chh = 132, y = 1300 - i * 160;
    const x = W / 2 + (1 - p) * (i % 2 ? 700 : -700);
    const s = 1 - collapse;
    if (s <= 0.01) continue;
    g.save();
    g.translate(lerp(x, W / 2, collapse), lerp(y, 820, collapse));
    g.scale(s, s);
    if (label.toLowerCase() === HERO.tier) { g.shadowColor = hexA(color, 0.8 * clamp((t - b(Q.rarity + 2)) / 0.3)); g.shadowBlur = 70; }
    roundRect(-cw / 2, -chh / 2, cw, chh, 66);
    g.fillStyle = C.s2; g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3; g.strokeStyle = hexA(color, 0.55); g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(-cw / 2 + 70, 0, 18, 0, Math.PI * 2); g.fill();
    text(label, -cw / 2 + 120, 22, { size: 64, weight: 700, align: 'left' });
    g.restore();
  }
}

function lockup(t) {
  if (t < b(Q.logo)) return;
  const p = spring(t - b(Q.logoIn), 200, 18);
  const lw = 300, lh = lw * 643.03 / 500.73;
  drawImg(IMG.logo, W / 2, 800, lw, { scale: p, glow: hexA(C.accent, 0.6), glowBlur: 70 });
  riseText('TzDeck', W / 2, 1200, t, b(Q.name), { size: 160 });
  const words = [['Pull.', -250], ['Collect.', 0], ['Battle.', 260]];
  words.forEach(([w, dx], i) => riseText(w, W / 2 + dx, 1300, t, b(Q.words[i]),
    { size: 56, weight: 600, family: 'Inter', color: C.text2 }));
  const pill = spring(t - b(Q.cta), 260, 22);
  if (pill > 0) {
    g.save();
    g.translate(W / 2, 1500);
    g.scale(pill, pill);
    roundRect(-290, -70, 580, 140, 70);
    g.fillStyle = C.accent; g.fill();
    text('tzdeck.xyz', 0, 24, { size: 68, weight: 700 });
    g.restore();
  }
  riseText('Free. No wallet needed.', W / 2, 1670, t, b(Q.footnote), { size: 48, weight: 600, family: 'Inter', color: C.text3 });
}

// ---------------------------------------------------------------- frame
function draw(t) {
  const heroGlow = clamp((t - HERO_FLIP) / 0.4) * (1 - clamp((t - b(Q.collect)) / 0.4));
  background(t, heroGlow > 0.02 ? C[HERO.tier] : C.accent, 0.2 + 0.1 * heroGlow);
  if (t < b(Q.fan)) hook(t);
  if (t >= b(Q.fan) && t < b(Q.collect) + 0.6) {
    g.save();
    g.translate(0, -H * spring(t - b(Q.collect), 190, 26));
    pull(t);
    g.restore();
  }
  if (t >= b(Q.collect) - 0.1 && t < b(Q.battle) + 0.8) collect(t);
  battle(t);
  rarity(t);
  lockup(t);
  filmGrain(t);
}

run(draw, loadAssets, [
  '800 100px Oxanium', '700 100px Oxanium', '600 100px Oxanium',
  '400 40px Inter', '500 40px Inter', '600 40px Inter',
]);
