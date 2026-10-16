// node capture.mjs <tz address> [KT1 contract ...]
// Captures the sealed pack, the logo, and TzDeck cards of one artist's own works into ./assets.
// Card art comes only from the artist who asked for the promo: their created tokens are
// imported into this browser's Wishlist, which renders them with the same card component
// packs use and grades them live against OBJKT. Nothing touches anyone's real wishlist.
import { launch } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shotAlone } from './shot-alone.mjs';

const SITE = 'https://tzdeck.xyz';
const [address, ...contracts] = process.argv.slice(2);
const UNLISTED_PER_SERIES = 8;
// A pack loads five cards. A card gives up on its artwork after a load timeout, and a
// hundred cards fetching from IPFS at once blow through it, so cards load five at a time.
const BATCH = 5;
const ATTEMPTS = 3;
if (!/^tz[1-3]\w{33}$/.test(address ?? '')) throw new Error('usage: node capture.mjs <tz address> [KT1 contract ...]');
mkdirSync('assets/cards', { recursive: true });

const logo = await fetch(`${SITE}/tzdeck-shield-gradient-on-dark.svg`);
if (!logo.ok) throw new Error(`logo: HTTP ${logo.status}`);
writeFileSync('assets/tzdeck-shield-gradient-on-dark.svg', await logo.text());

async function createdTokens() {
  const tokens = [];
  for (let offset = 0; ; offset += 250) {
    const res = await fetch('https://data.objkt.com/v3/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query Created($address: String!, $offset: Int!) {
          token(
            where: { creators: { creator_address: { _eq: $address } }, display_uri: { _is_null: false }, supply: { _gt: 0 } }
            order_by: { timestamp: desc }, limit: 250, offset: $offset
          ) { fa_contract token_id listings_active(limit: 1) { price } }
        }`,
        variables: { address, offset },
      }),
    });
    const { data, errors } = await res.json();
    if (errors) throw new Error(JSON.stringify(errors));
    tokens.push(...data.token);
    if (data.token.length < 250) return tokens;
  }
}

// Every listed work (the only kind a pack can deal), plus a sample of unlisted works per series.
const unlistedSeen = new Map();
const picks = (await createdTokens())
  .filter((t) => contracts.length === 0 || contracts.includes(t.fa_contract))
  .filter((t) => {
    if (t.listings_active.length > 0) return true;
    const n = unlistedSeen.get(t.fa_contract) ?? 0;
    unlistedSeen.set(t.fa_contract, n + 1);
    return n < UNLISTED_PER_SERIES;
  })
  .map((t) => ({ contract: t.fa_contract, tokenId: t.token_id, listed: t.listings_active.length > 0 }));
console.log(`${picks.length} works picked (${picks.filter((p) => p.listed).length} listed)`);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto(SITE, { waitUntil: 'networkidle' });
await shotAlone(page.locator('button[aria-label="Open booster pack"]'), 'assets/pack.png');

const roots = page.locator('button[aria-label^="View details for"]')
  .locator('xpath=ancestor::div[contains(@class,"group") and contains(@class,"rounded-2xl")][1]');

/** Loads `batch` into an otherwise empty Wishlist and captures every card whose artwork loaded. */
async function captureBatch(batch) {
  await page.evaluate(() => localStorage.removeItem('tzdeck_wishlist'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Wishlist/ }).click();
  writeFileSync('assets/wishlist-import.json', JSON.stringify({
    version: 1,
    cards: batch.map((p) => ({ contract_address: p.contract, token_id: p.tokenId })),
  }));
  await page.locator('input[type="file"]').setInputFiles(resolve('assets/wishlist-import.json'));
  await page.getByText(/Added \d+ cards?\./).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const captured = [];
  for (let i = 0; i < await roots.count(); i += 1) {
    const root = roots.nth(i);
    const lines = (await root.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.includes('Media unavailable')) continue;
    const href = await root.locator('a[href*="objkt.com/asset/"]').first().getAttribute('href');
    const [contract, tokenId] = href.split('/asset/')[1].split('/');
    const pick = batch.find((p) => p.contract === contract && p.tokenId === tokenId);
    const file = `assets/cards/${contract.slice(-6)}-${tokenId}.png`;
    await root.scrollIntoViewIfNeeded();
    await shotAlone(root, file);
    captured.push({ file, contract, tokenId, rarity: lines[0]?.toLowerCase(), listed: pick?.listed ?? false, lines: lines.slice(0, 8) });
  }
  return captured;
}

const cards = [];
let pending = picks;
for (let attempt = 1; attempt <= ATTEMPTS && pending.length > 0; attempt += 1) {
  const retry = [];
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const got = await captureBatch(batch);
    cards.push(...got);
    retry.push(...batch.filter((p) => !got.some((c) => c.contract === p.contract && c.tokenId === p.tokenId)));
  }
  pending = retry;
  if (pending.length > 0) console.log(`  attempt ${attempt}: ${pending.length} cards' artwork did not load, retrying`);
}
writeFileSync('assets/cards.json', JSON.stringify(cards, null, 1));
await browser.close();

const tally = {};
for (const c of cards) {
  const key = c.listed ? c.rarity : `${c.rarity} (unlisted)`;
  tally[key] = (tally[key] ?? 0) + 1;
}
console.log(`captured ${cards.length} cards:`, tally);
if (pending.length > 0) console.log(`skipped ${pending.length} whose artwork never loaded:`, pending.map((p) => `${p.contract}/${p.tokenId}`).join(' '));
