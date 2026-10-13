// node render.mjs --stills 0.3,1,2.2       one PNG per time into out/stills, plus out/contact.png
// node render.mjs --fps 60 --sub 2          full render to out/silent.mp4
import './timeline.js';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import { launch, openFilm } from './browser.mjs';

const flag = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const FPS = Number(flag('fps') ?? 60), SUB = Number(flag('sub') ?? 2), DUR = Number(flag('dur') ?? REEL.duration);
const FROM = Number(flag('from') ?? 0);
const stills = flag('stills');

mkdirSync('out', { recursive: true });
const browser = await launch();
const page = await openFilm(browser);
const canvas = page.locator('#c');
const missing = await page.evaluate(() => window.missing);
if (missing.length > 0) {
  console.warn(`placeholders stand in for ${missing.length} missing assets: ${missing.join(' ')}`);
  if (!stills) { await browser.close(); throw new Error('capture the missing assets before a full render'); }
}

if (stills) {
  rmSync('out/stills', { recursive: true, force: true });
  mkdirSync('out/stills', { recursive: true });
  const times = stills.split(',').map(Number);
  for (const [i, t] of times.entries()) {
    await page.evaluate((t) => window.seek(t), t);
    await canvas.screenshot({ path: `out/stills/${String(i).padStart(2, '0')}.png` });
  }
  const cols = Math.min(6, times.length), rows = Math.ceil(times.length / cols);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'out/stills/%02d.png',
    '-vf', `scale=270:-1,tile=${cols}x${rows}:padding=6:color=0x222222`, '-frames:v', '1', 'out/contact.png'],
    { stdio: 'inherit' });
  console.log(`${times.length} stills -> out/contact.png`);
} else {
  const vf = `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`;
  const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', 'out/silent.mp4'],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round(DUR * FPS * SUB);
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.seek(t), FROM + i / (FPS * SUB));
    const png = await canvas.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % (FPS * SUB) === 0) console.log(`rendered ${i / (FPS * SUB)}s / ${DUR}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
}
await browser.close();
