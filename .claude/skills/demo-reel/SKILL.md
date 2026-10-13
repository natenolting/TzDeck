---
name: demo-reel
description: Make a short demo reel, promo or launch video for any web product, rendered from code with real captures of the live site and a synthesized score. Use when asked for a demo reel, product video, promo, trailer, showreel, launch video or social clip for a site or app.
---

# Demo reel

A demo reel here is a 10-30 second film built in code: real screenshots of the product, animated on a canvas where `window.seek(t)` paints any frame from `t` alone, scored by a synthesizer locked to the same cue sheet, and rendered by Playwright and ffmpeg into an MP4 ready to post.

The skill has two parts:

- `engine/` is shared, and you never edit it per project. It holds the renderer (`render.mjs`), the encode and review sheets (`finish.mjs`), the determinism check (`fingerprint.mjs`), the browser launcher (`browser.mjs`), the element screenshot (`shot-alone.mjs`), the film toolkit (`lib.js`: springs, text, images, grain, placeholders) and the synthesizer (`synth.mjs`).
- `template/` is a starting studio with its own files. `timeline.js` holds the format (`REEL`) and the cue sheet (`CUES`, in beats). `film.js` holds the brand, copy, assets and scenes. `music.mjs` is the arrangement, `capture.mjs` and `shots.json` drive the screenshots, and `docs/shotlist.md` is the cut.

A product can keep its own studio in place of the template. The TzDeck one is `../promo-video/studio/`, a worked example of a full custom cut built on this engine.

## Steps

1. **Brief.** Get from the person, or from the product's own site, README and CSS: the product URL; who the reel is for and where it will run (format: 1080x1920 for Reels, Shorts and TikTok, 1080x1080 for feeds, 1920x1080 for a site or YouTube); length; the 3-5 moments that show the product at its best, including the one signature moment the film builds to; the brand colors and fonts (from the product's CSS tokens, never guessed); the call to action. Ask only for what you can't find. Done when each of those is written down.

2. **Scaffold.** Copy `engine/` and then `template/` (or the product's own studio) into one flat work directory outside any repo, by default `../<product>-reel` beside the current checkout. Run `npm install`, then `npx playwright install chromium`. Install the brand's fonts with `npm install @fontsource/<font>` and list them in `index.html`. Done when the installs succeed and `npm run stills -- 1` writes `out/contact.png`. Missing captures appear as placeholders at this point.

3. **Shot list.** Rewrite `docs/shotlist.md` for this product: time, beats, shot, on-screen copy and sound per row. Then set `REEL` and `CUES` in `timeline.js` to match. Moments land on beats (at 120 BPM a beat is 0.5 s). Done when the shot list and cue sheet agree.

4. **Capture.** List every screen, element and logo the shot list needs in `shots.json`; the format is in `capture.mjs`'s header. Set up each state with `steps`, hide anything transient (cookie banners, toasts, live counters) with `hide`, and use `alone` for rounded elements such as cards, buttons and modals. Run `npm run capture`. Open every file in `assets/` and look at it. A page that loaded without its CSS, a spinner, an error page or a cookie wall is a failed capture, even when the script exited cleanly. Done when every shot is a clean, real screen.

5. **Build.** In `film.js`, set `BRAND` from the product's tokens, `COPY` from its own words, and `SRC` to the captures. Rewrite the scenes so the film builds to the signature moment. The template's three equal feature scenes are a blocking pass, not a finished cut. Rewrite `music.mjs` alongside, so every cut and landing has a sound and the groove drops out before the peak. Done when stills of every shot render without placeholders.

6. **Critique loop.** Render stills with `npm run stills -- 0.3,1.6,2.6,...`: at least one per shot and one inside each transition. Open `out/contact.png` and look at it as a harsh motion director. Score 1-10 on each of: hook in the first 2 s, readability at phone size, motion quality, variety (something new every 2-4 s), composition, and brand accuracy. Fix the 3 worst problems and re-render those stills. Log each round's scores and fixes in `docs/review_log.md`. Done when every score is 8 or higher.

7. **Render.** Set `REEL.poster` to the strongest frame. Run `npm run score`, then `npm run render` in the background (roughly 50 s of wall time per second of film at 60 fps with 2 motion-blur subframes), then `npm run finish`. Done when `out/<REEL.name>.mp4` has the format's size at 60 fps, with AAC audio near -14 LUFS (`ffmpeg -i out/<name>.mp4 -af ebur128 -f null -`), and you have reviewed `out/contact-final.png` and `out/phone.png` from the encoded file.

8. **Deliver.** Hand over the MP4, contact sheet and poster paths, and say what you would improve next.

## Rules

- Everything on screen is a real capture of the product, or its real brand material. Never draw a UI from imagination. Animate the capture; don't redraw it.
- Claims and numbers in the copy come from the product's own site or docs. Ask before using a customer's name, logo or data.
- Brand colors and fonts come from the product's CSS or brand guide.
- Motion is springs, one per change of target (`track()` in `lib.js`). Randomness is seeded (`rng()`), and time comes only from `seek(t)`.
- Captions are at least 48 px on the short side of a 1080 px canvas (`48 * U` in the template), so they read on a 360 px phone.
- Keep the engine shared. A change one film needs goes in that film's studio. A fix every film needs goes in `engine/`, followed by a fingerprint check of an existing studio.

## Gotchas

- A screenshot is a rectangle. Capture any rounded or shaped element with `shotAlone()` (`"alone": true` in `shots.json`). It gives true alpha and clips to the element's own border radius, so the page background and any outer ring or glow stay out of the corners.
- Canvas silently ignores a `globalAlpha` outside [0, 1] and keeps the previous value. Spring overshoot then makes a fading element snap back to full opacity. Route every alpha through `fade()`.
- A full-page screenshot at 3x takes most of a second. Anything that animates on its own (toasts, counters, floating numbers) can land in it mid-frame. Hide it with the shot's `hide` selector and animate it in the film instead.
- A page that polls or holds a socket open never goes network-idle. Capture waits for `load`, then up to 10 s for idle. For content that arrives later, add a `waitFor` step.
- Sites rate-limit bursts. Capture runs shots one at a time and retries each once. Don't run it in parallel with other scrapers.
- Where `npx playwright install` can't download a browser, set `CHROMIUM_PATH` to an installed Chromium and every script uses that instead.
- A missing asset renders as a labeled placeholder in stills, so you can block out timing before capture. `render.mjs` refuses a full render while any placeholder remains.
- The studio files are UTF-8. Windows PowerShell 5.1 reads them as ANSI and garbles characters such as `·` on write, so edit them with Node or the editor tools. The Windows `ffmpeg-static` build has no glob input, which is why stills are numbered `out/stills/%02d.png`.
- A full render is slow, so iterate on stills and render once. `npm run fingerprint` hashes 30 frames and the score: two runs must match, and so must a refactor meant to change nothing.
