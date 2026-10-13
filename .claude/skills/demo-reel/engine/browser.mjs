// Launches the Chromium every engine and capture script shares. CHROMIUM_PATH points it at a
// preinstalled browser when `npx playwright install` can't download one (a locked-down machine,
// or a cached browser from another Playwright version).
import { chromium } from 'playwright';

export const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** Opens index.html at the film's own size and waits for its assets and fonts. */
export async function openFilm(browser) {
  const page = await browser.newPage({ viewport: { width: REEL.width, height: REEL.height }, deviceScaleFactor: 1 });
  await page.goto('file://' + process.cwd().replace(/\\/g, '/') + '/index.html');
  await page.evaluate(() => { document.body.classList.add('render'); return window.ready; });
  return page;
}
