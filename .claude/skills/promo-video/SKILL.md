---
name: promo-video
description: Make a TzDeck promo video rendered from code with real captures of tzdeck.xyz. Use when asked for a TzDeck promo, launch video, trailer, showreel or social clip, or to update or re-cut the existing one.
---

# TzDeck promo video

`studio/` is a working 20-second vertical film: live captures of tzdeck.xyz, a canvas film where `window.seek(t)` paints any frame from `t` alone, and a synthesized score. It runs on the shared engine in `../demo-reel/engine/` (renderer, encoder, springs and text helpers, synthesizer). The `demo-reel` skill is the general version of this one, for any product. Every run starts from a copy of the engine and the studio, and changes the picks, the copy, and the cue sheet.

The studio's shape:

- `timeline.js` holds the format (`REEL`) and the cue sheet (`CUES`, in beats at 120 BPM). `film.js` (picture) and `music.mjs` (score) both read it, so a retime is one edit that moves picture and sound together.
- `docs/shotlist.md` is the current cut: shots, copy, and sound per beat range.
- `film.js` holds the card picks and `HERO` (the hero card's tier and credit) at the top of its assets section. The hero's tier drives the peak's label and color.

## Steps

1. **Scaffold.** Copy `../demo-reel/engine/` and then `studio/` into one work directory outside the repo (default `../tzdeck-promo` beside the checkout), then run `npm install` and `npx playwright install chromium` there. Done when both succeed.

2. **Capture.** Get the Tezos address of the artist whose work the promo shows: the person asking, or an artist who has agreed to it. Ask for it when the request doesn't name one. Run `npm run capture -- <address> [KT1 contract ...]` (the contracts limit it to chosen series), then `npm run capture:screens`. Capture loads every listed work and a sample of unlisted works into the capture browser's Wishlist, five at a time, and saves each card to `assets/cards/` with its grade and listing state in `assets/cards.json`. Screens adds the card back and the demo battle. Done when every picked work was captured or reported as skipped.

3. **Pick.** Look at every candidate card image before choosing it. A pack only deals listings, so the pack scene uses listed works only. The hero (`SRC.hero`) is the highest-graded listed work, and `HERO.tier` is its real grade. `FLIP_CARDS` are four listed works that build toward the hero's tier. `MARQUEE` holds about 24 more, alternating series. Set `HERO.credit` to the hero's title and artist, and make the pull copy fit the peak's tier. Choose art that reads at phone size. Done when every pick has been viewed and the hero's tier matches its card badge.

4. **Brief.** When the request changes the length, message or beats, rewrite `docs/shotlist.md`, then `timeline.js`, before touching scene code. Done when the shot list and cue sheet agree.

5. **Critique loop.** Render stills with `npm run stills -- 0.3,1.6,2.6,...`: at least one per shot and one inside each transition. Open `out/contact.png` and look at it as a harsh motion director. Score 1-10 on each of hook in the first 2 s, readability at 360 px wide, motion quality, variety (something new every 2-4 s), composition, and brand accuracy. Fix the 3 worst problems and re-render those stills. Log each round's scores and fixes in `docs/review_log.md`. Done when every score is 8 or higher.

6. **Render.** Run `npm run score`, then `npm run render` in the background (about 17 minutes for 20 s at 60 fps with 2 motion-blur subframes), then `npm run finish`. Done when `out/tzdeck-promo.mp4` is 1080x1920 at 60 fps with AAC audio near -14 LUFS (`ffmpeg -i out/tzdeck-promo.mp4 -af ebur128 -f null -`), and you have reviewed `out/contact-final.png` and `out/phone.png` from the encoded file.

7. **Deliver.** Hand over the MP4, contact sheet and poster paths, the hero card's artist credit, and what you would improve next.

## Rules

- Card art comes only from works by the artist who asked for the promo, or an artist who agreed to be featured. Credit the hero card's artist on screen.
- Everything on screen is a real capture of tzdeck.xyz or real brand material. Redraw nothing from imagination.
- Grades are the ones TzDeck gives. Show a peak at the tier the hero actually has, never a higher one.
- Brand: surface `#07080f`, accent `#6366f1`, rarity colors only on rarity moments, Oxanium for display type, Inter for small copy. The tokens live in `src/app/globals.css`.
- Rarity copy follows `CONTEXT.md`: a grade from edition size and listed price. Present rarity as a grade, never as worth, price or odds.
- Motion is springs, one per change of target (`track()` in the engine's `lib.js`). Randomness is seeded (`rng()`), and time comes only from `seek(t)`.
- Captions are at least 48 px on the 1080 px canvas, so they read on a 360 px phone.

## Gotchas

- A screenshot is a rectangle. Capture any rounded or shaped element (cards, the card back, the pack) with `shotAlone()` from `shot-alone.mjs`. It gives true alpha and clips to the element's own border radius, so neither the page background nor the rarity ring's corner arcs land in the corners.
- Canvas silently ignores a `globalAlpha` outside [0, 1] and keeps the previous value. Spring overshoot then makes a fading element snap back to full opacity. Route every alpha through `fade()`.
- A full-page screenshot at 3x takes about 0.7 s, longer than the app's half-second floating damage numbers. A capture timed between hits can still catch one, so `capture-battle.mjs` hides them with the screenshot's own `style` option. Any other transient app decoration the film replaces needs the same treatment.
- A card gives up on its artwork after a load timeout and shows "Media unavailable". A Wishlist of a hundred cards fetching from IPFS at once blows through it, so capture loads five at a time, like a pack, and retries any card that still failed.
- A Wishlist card shows a filled heart, since it is saved. That is the one visible difference from a card fresh out of a pack.
- A missing asset renders as a labeled placeholder in stills; `render.mjs` refuses a full render while any remain. Where `npx playwright install` can't download a browser, set `CHROMIUM_PATH` to an installed Chromium.
- The studio files are UTF-8 with characters like `·` and `ꜩ`. Windows PowerShell 5.1 reads them as ANSI and garbles them on write, so edit them with Node or the editor tools.
- The Windows `ffmpeg-static` build has no glob input. Stills are numbered `out/stills/%02d.png` for that reason.
- OBJKT and the site rate-limit bursts. Run capture once, not in parallel with other scrapers.
- A full render is slow, so iterate on stills and render once. `npm run fingerprint` hashes 30 frames and the score: two runs must match, and so must a refactor meant to change nothing, including a change to the shared engine.
