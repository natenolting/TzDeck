// node capture-back.mjs  Captures one face-down card back into ./assets/back.png
import { launch } from './browser.mjs';
import { shotAlone } from './shot-alone.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto('https://tzdeck.xyz', { waitUntil: 'networkidle' });
await page.locator('button[aria-label="Open booster pack"]').click();
const back = page.locator('button[aria-label^="Reveal card"]').first();
await back.waitFor();
await page.waitForTimeout(1200);
await shotAlone(back, 'assets/back.png');
await browser.close();
