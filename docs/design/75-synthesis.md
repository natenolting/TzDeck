# Design: card deep links and link previews (#75)

Synthesis of two independent design packages, `75-alpha` (smallest surface) and `75-beta`
(design for the second unit), reconciled against measurements taken during synthesis.
Both source packages live on the throwaway branches `worktree-agent-afdf0c6b1ba69ad8a`
and `worktree-agent-a766c3f745bfd7e54`.

## What measurement changed

Both packages designed an IPFS fetch with gateway fallbacks, a timeout budget, and a size
ceiling. Alpha named its own weakest assumption as the unmeasured byte-size distribution of
OBJKT artwork. Beta's was whether `sharp` loads on Vercel. Measuring dissolved both questions
rather than answering them.

**OBJKT serves pre-resized derivatives from its own CDN.**
`https://assets.objkt.media/file/assets-003/<contract>/<tokenId>/thumb400`.
Measured over 300 active listings with `npm run sample:og-artwork`:

| | |
| --- | --- |
| Reachable | 300/300, no 404s |
| Size | p50 105KB, p90 446KB, p99 4.4MB, max 9MB |
| Latency | p50 491ms, p90 1.06s, p99 3.3s |
| Over a 320KB budget | 15.7% |

This replaces the entire IPFS path for previews. It removes the gateway fallback chain, the
four-attempt ladder, and the `sharp` dependency in one move. It also solves the video-token
constraint for free: `thumb400` for the fixture pack's `video/mp4` Legendary returns a
40KB JPEG poster. The second gateway in `IPFS_GATEWAYS`, `dweb.link`, answered a probe with
**429 rate limited** during measurement, which is its own argument against depending on it
in a crawler path.

The tail is entirely animated tokens. Animated GIF and WebP come back as animated WebP at
full size in *every* derivative, `thumb288` included (measured 1.03MB vs 1.74MB for the same
token). There is no smaller variant to fall back to, and satori cannot meaningfully rasterise
animated WebP anyway. These render the no-artwork card.

**The font budget is smaller than either package assumed.** `next/font/google` caches woff2
only, which satori cannot read. Google's `css2` endpoint serves EOT to a legacy MSIE agent,
and TrueType only to an old Android WebKit agent. Static-instance sizes: Oxanium any weight
about 24KB, **Inter Regular 325KB**. Alpha's Oxanium+Inter pairing is 349KB of a 500KB
ceiling that also has to hold the artwork; beta's three weights are 675KB and do not fit at
all. Resolved as **Oxanium Bold + Oxanium Regular, 49KB**, leaving roughly 450KB for artwork.
Oxanium is the brand face, so an all-Oxanium card is more on-brand than the mixed setting,
not a compromise.

## Decisions

| Question | Alpha | Beta | Chosen |
| --- | --- | --- | --- |
| Route | `/c/[contract]/[tokenId]` | `/card/[contract]/[tokenId]` | **`/c/`**. Both rejected the colon-joined `getCardKey` form for the same reason; `/c/` is shorter in a chat message. |
| Artwork source | IPFS, 4 attempts, 2500ms | IPFS + `sharp` re-encode | **OBJKT CDN `thumb400`**. Measured above. |
| Oversized artwork | fall back to `thumbnail_uri` | downscale with `sharp` | **Render the no-artwork card.** The fallback alpha proposed does not exist for the tokens that need it, and `sharp` buys nothing once the CDN is doing the resizing. |
| Cache | CDN only, conditional `Cache-Control` | Data Cache + `revalidate` + warm ping | **Both.** Alpha's conditional header is the sharpest idea in either package. Beta's warm ping is nearly free and closes the cold-crawl window. |
| Rarity basis | supply-only, labelled | `fetchCardsByKeys` price-if-listed | **Beta.** Reuses tested logic and makes the share route agree with the app instead of explaining why it disagrees. |
| Module shape | one `src/lib/share.ts` | `src/lib/share/*` plus `src/lib/og/kit.ts` | **Alpha.** The `og/kit.ts` seam exists to make a second shared unit cheap, and the second unit was just deferred to its own ticket. Build the seam when there is a second caller. |
| Arrival | dedicated page, links to `/` | dedicated page plus `?openCard=` into the SPA | **Alpha, for now.** `openCard` means mount-time resolution and a `router.replace` inside a client SPA, for a flow nobody has asked for. Recorded as a follow-up, not built. |
| Battle result | split | split | **Split.** Both agreed, for the same reason: migration 0014 sweeps `battle_log` at 30 days. |

## Shape

One new module, `src/lib/share.ts`, exporting `SITE_ORIGIN`, a branded `CardRef`,
`parseCardRef`, `loadSharedCard`, and `shareLink`. One addition to `src/components/rarityStyles.ts`,
`RARITY_HEX`, because satori resolves neither Tailwind classes nor `var(--rarity-*)`.
One route segment `src/app/c/[contract]/[tokenId]/` holding `page.tsx` and `opengraph-image.tsx`.
One button in `NFTDetailsModal`. Fonts vendored at `assets/og/`, read at module scope.

## Cache policy

Conditional on whether the artwork resolved, because an immutable header on a degraded
render pins a broken card in the CDN forever:

```
artwork resolved      public, max-age=31536000, s-maxage=31536000, immutable
artwork did not       public, max-age=0, s-maxage=60, stale-while-revalidate=60
```

`(contract, tokenId)` names one token forever and its artwork never changes, so the long
policy needs no invalidation story.

**Verification obligation.** `ImageResponse` documents `headers` as passed through, but the
metadata route wraps the handler and that passthrough is unconfirmed. Request the image URL
twice on a preview deployment and read `cache-control` and `x-vercel-cache`. If Next
overrides it, the fallback is an explicit Route Handler referenced from `openGraph.images`.
Do not build that speculatively.

## Known limitation, to document rather than fix

The vendored fonts are Latin static instances. A token whose name carries Persian, Cyrillic,
or CJK glyphs renders tofu, because satori has no system fallback. For a project whose pitch
is spotlighting artists worldwide, silently emitting a broken card is worse than emitting a
plain one. Detect unrenderable glyphs and drop to the name-free layout.
