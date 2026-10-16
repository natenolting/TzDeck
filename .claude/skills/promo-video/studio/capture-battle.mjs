// node capture-battle.mjs  Captures the demo battle mid-fight into ./assets/battle.png.
// The film draws its own hit numbers, so the app's floating damage numbers and red hit
// flashes are hidden for the shot. A screenshot takes longer than one number's half-second
// fade, so waiting for a gap alone can still catch one; the shot's own stylesheet hides them.
import { launch } from './browser.mjs';

const DECORATION = '[data-testid$="-damage"], [data-testid$="-avatar"] .bg-danger';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto('https://tzdeck.xyz', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /Deck/ }).click().catch(() => page.getByText('My Deck').first().click());
await page.getByText('Watch a demo battle').click();
await page.waitForTimeout(2_500);

// Between hits, so neither avatar is mid-recoil. Both decorations stay mounted at opacity 0.
await page.waitForFunction((selector) => [...document.querySelectorAll(selector)]
  .every((el) => Number(getComputedStyle(el).opacity) < 0.02), DECORATION, { timeout: 10_000, polling: 50 });
await page.screenshot({ path: 'assets/battle.png', style: `${DECORATION} { visibility: hidden !important; }` });

await browser.close();
console.log('assets/battle.png: demo battle, app damage numbers hidden');
