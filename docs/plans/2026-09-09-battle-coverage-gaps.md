# Battle system test-coverage gaps

Surfaced by a follow-up audit after resolving all six findings in
`2026-09-08-pvp-battle-review-follow-ups.md`, cross-checked against a real
`node --experimental-test-coverage` run over the battle test suite. Fix one
at a time, with one commit per fix, same as that doc.

## 1. HIGH — No render-level test proves BattleResultScreen actually mounts from BattlePanel

- [x] Resolved and verified. Added a render-level test to
  `BattlePanel.test.tsx` that renders the real `<BattlePanel>` under a
  `<WalletContext.Provider>` (exported `WalletContext` itself from
  `WalletContext.tsx` for exactly this purpose -- previously only the
  `useWallet()` hook and the real, Beacon-initializing `WalletProvider` were
  exported), drives `startBattle` through mocked `fetch`/`objktClient`
  responses for a winning battle, and asserts `BattleResultScreen` actually
  mounted with the right props (attacker card name, round-by-round log,
  "Victory"). Verified the test actually catches the regression it targets:
  temporarily reverted `BattlePanel`'s `panelState.kind === "result"` branch
  to never render (`if (false && ...)`), confirmed the new test fails, then
  reverted. Full suite: 207/207 pass.
- Location: `src/components/BattlePanel.tsx`, `src/components/BattlePanel.test.tsx`.
- `BattlePanel.test.tsx` only tests extracted pure helpers
  (`previewStatsForCard`, `recoveryCopy`, `resubmitWhilePending`); nothing
  renders the real `<BattlePanel>` component and drives it through a
  successful battle to confirm `panelState.kind === "result"` actually
  causes `BattleResultScreen` to mount with the right props.
  `BattleResultScreen.test.tsx` only covers that child in isolation.
- This is exactly the class of bug fixed earlier this session
  (`BattleResultScreen` was imported but never rendered, caught only by
  reading the diff, not by any test). A future wiring regression there would
  go undetected again.
- Regression coverage: render `<BattlePanel>`, drive `startBattle` through a
  mocked successful `fetch` response, and assert the result screen's content
  (e.g. the attacker card name, or an element unique to
  `BattleResultScreen`) appears in the DOM.

## 2. MEDIUM — commit_battle's R20 repeat-farming decay has no end-to-end proof

- [x] Resolved and verified. Added two tests to `commitBattle.test.ts`: two
  real `commitBattle` calls for the same attacker/defender wallet pair
  (different defender card the second time, so the first loss's recovery
  lock doesn't block it) assert the second win's `xpAwarded` is exactly
  `decayScaledAward(100, 1)` (50), not the undecayed 100. A second test
  seeds two fabricated `battle_log` rows for the exact same wallet pair --
  one just outside the 7-day window (7 days 1 hour ago) and one just inside
  it (6 days 23 hours ago) -- and asserts a real commit's decay reflects
  exactly one prior win, proving the SQL's `settled_at > ... - interval '7
  days'` filter is exclusive on the far side and inclusive on the near side,
  not just "roughly a week." Full suite: 209/209 pass.
- Location: `src/lib/battle/commitBattle.test.ts`, `commit_battle`
  (migrations, most recently 0010).
- Existing coverage only checks (a) SQL-vs-JS decay formula parity in
  isolation and (b) a single win's `decayCount = 0` case. No test actually
  battles the same attacker/defender pair twice through the real
  `commitBattle` and asserts the second win's `xpAwarded` is reduced.
- The SQL's 7-day window (`settled_at > v_settlement_time - interval '7
  days'`) is entirely untested -- a battle just outside vs. just inside that
  boundary could silently stop decaying (or decay when it shouldn't) with no
  test catching it.
- Regression coverage: two real `commitBattle` calls for the same
  winner/loser pair, asserting the second's `xpAwarded` is strictly less
  than the first's and matches `decayScaledAward`'s prediction; a battle
  logged just past the 7-day window must NOT count toward decay.

## 3. MEDIUM — findMatch's progressive band-widening is untested as a loop

- [x] Resolved and verified. Added a test to `rules.test.ts`: a level-4
  candidate (same seed as a level-1 attacker) sits at ~1.69x the attacker's
  strength -- past band 0.5's 1.5x upper bound, only reachable once
  widening reaches band 1.0's 2.0x upper bound -- with sanity assertions
  confirming the constructed strength actually lands in that gap before
  asserting `findMatch` still finds it. Verified the test actually catches
  a regression: temporarily truncating `BAND_WIDENING_STEPS` to
  `[0.1, 0.25, 0.5]` made it fail as expected, then reverted. Full suite:
  210/210 pass.
- Location: `src/lib/battle/rules.ts` (`findMatch`, `BAND_WIDENING_STEPS`),
  `src/lib/battle/rules.test.ts`.
- Existing tests cover "matched within some band" and "no match even at the
  widest band," but nothing proves a candidate outside the narrowest band
  actually gets picked up at a wider step. The widening loop itself (e.g. an
  off-by-one on which steps run, or a step skipped) could break without any
  test noticing.
- Regression coverage: a candidate whose Power x HP product only falls
  inside a WIDER band (not the narrowest) is still matched, and the band
  actually used is the narrowest one that contains it (not a wider one
  found "by accident").

## 4. MEDIUM — refresh/route.ts is missing most of its outcome-branch coverage

- [ ] Resolve and verify.
- Location: `src/app/api/battle/refresh/route.ts`,
  `src/app/api/battle/refresh/route.test.ts`.
- Verified directly against coverage output: `invalid_json_body` (400), the
  `in_progress`/`terminal`-replay switch cases, `rate_limited` (429),
  `holdings_unavailable` (503), `sync_superseded` (409), and the generic 500
  catch are ALL uncovered. `random`/`challenge`/`opt-in` all have this
  coverage (opt-in explicitly, per item 5 of the prior review-follow-ups
  doc); `refresh` shares the identical code shape and was skipped.
- Regression coverage: one test per uncovered branch, mirroring the
  existing pattern already used in `opt-in/route.test.ts` and
  `random/route.test.ts` for the same branch shapes.

## 5. LOW — status/route.ts is missing its own error-branch coverage

- [ ] Resolve and verify.
- Location: `src/app/api/battle/status/route.ts`,
  `src/app/api/battle/status/route.test.ts`.
- Verified directly against coverage output: `address_required` (400),
  `rate_limited` (429), and the generic 500 catch (`status_unavailable`) are
  all untested. `session/route.ts` (the other unauthenticated, IP-keyed
  route) already has the equivalent 429 test; `status` doesn't.
- Regression coverage: missing-`address` returns 400; an IP driven past its
  30-requests/60s budget returns 429 (mirroring
  `session/route.test.ts`'s existing pattern).

## Not flagged as gaps

`store.ts`'s attempt-lifecycle functions, `ownership.ts`, `rules.ts`'s
XP/leveling math, and `commit_participation`/`commit_holdings_refresh` all
have solid direct coverage already. `renewLease` is tested but is dead code
(never called from any route) -- a cleanup note, not a coverage gap.
