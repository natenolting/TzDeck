// node fingerprint.mjs > fp.txt  Hashes 30 rendered stills and out/score.wav. Two runs with no code
// change must match (the render is deterministic); a refactor that changes nothing must match too.
import './timeline.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { launch, openFilm } from './browser.mjs';

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const browser = await launch();
const page = await openFilm(browser);
const span = REEL.duration - 0.1;
for (let i = 0; i < 30; i++) {
  const t = 0.05 + i * (span / 30);
  await page.evaluate((t) => window.seek(t), t);
  console.log(t.toFixed(3), md5(await page.locator('#c').screenshot()));
}
await browser.close();
console.log('score', md5(readFileSync('out/score.wav')));
