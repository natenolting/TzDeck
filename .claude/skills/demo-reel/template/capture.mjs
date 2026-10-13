// node capture.mjs [shots.json]  Captures every shot in shots.json from the live product into ./assets.
//
// shots.json: { site, viewport: { width, height, scale, colorScheme }, shots: [...] }. Each shot is
//   { name, download: "/logo.svg" }    fetch a file as is (a logo, an icon) to assets/<name><ext>
//   { name, path: "/pricing", ... }    open the page and screenshot it to assets/<name>.png, with
//     steps:   [{ click | hover | waitFor | scroll: selector }, { fill: [selector, text] },
//               { press: "Enter" }, { wait: ms }]   run in order before the shot
//     element: selector   shoot that element instead of the viewport
//     alone:   true       with element: true alpha, clipped to its rounded border (shot-alone.mjs)
//     fullPage: true      the whole scrolling page instead of the viewport
//     hide:    selector   hidden for the shot only (cookie banners, toasts, live timers)
//     viewport: {...}     this shot's own viewport, over the default
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { launch } from './browser.mjs';
import { shotAlone } from './shot-alone.mjs';

const config = JSON.parse(readFileSync(process.argv[2] ?? 'shots.json', 'utf8'));
const url = (path) => new URL(path, config.site).href;
mkdirSync('assets', { recursive: true });

const browser = await launch();

async function capture(shot) {
  if (shot.download) {
    const res = await fetch(url(shot.download));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = `assets/${shot.name}${extname(new URL(url(shot.download)).pathname) || '.png'}`;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
  const vp = { ...config.viewport, ...shot.viewport };
  const page = await browser.newPage({
    viewport: { width: vp.width ?? 390, height: vp.height ?? 844 },
    deviceScaleFactor: vp.scale ?? 3,
    colorScheme: vp.colorScheme ?? 'dark',
  });
  try {
    // A page that polls or holds a socket open never goes network-idle, so idle is waited for, not required.
    const res = await page.goto(url(shot.path ?? '/'), { waitUntil: 'load' });
    if (res && !res.ok()) throw new Error(`HTTP ${res.status()}`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    for (const step of shot.steps ?? []) {
      if (step.click) await page.locator(step.click).first().click();
      if (step.hover) await page.locator(step.hover).first().hover();
      if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1]);
      if (step.press) await page.keyboard.press(step.press);
      if (step.waitFor) await page.locator(step.waitFor).first().waitFor();
      if (step.scroll) await page.locator(step.scroll).first().scrollIntoViewIfNeeded();
      if (step.wait) await page.waitForTimeout(step.wait);
    }
    // Images still decoding, and the first frame of any entrance animation, would land in the shot.
    await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const file = `assets/${shot.name}.png`;
    const style = shot.hide ? `${shot.hide} { visibility: hidden !important; }` : undefined;
    if (shot.element && shot.alone) await shotAlone(page.locator(shot.element).first(), file);
    else if (shot.element) await page.locator(shot.element).first().screenshot({ path: file, style });
    else await page.screenshot({ path: file, fullPage: shot.fullPage ?? false, style });
    return file;
  } finally {
    await page.close();
  }
}

// Shots run one at a time: sites rate-limit bursts. A shot that fails gets one more try.
const failed = [];
for (const shot of config.shots) {
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(await capture(shot));
      break;
    } catch (err) {
      console.error(`${shot.name}: ${err.message.split('\n')[0]}${attempt < 2 ? ', retrying' : ''}`);
      if (attempt >= 2) { failed.push(shot.name); break; }
    }
  }
}
await browser.close();
if (failed.length > 0) {
  console.error(`${failed.length} shots failed: ${failed.join(' ')}`);
  process.exitCode = 1;
}
