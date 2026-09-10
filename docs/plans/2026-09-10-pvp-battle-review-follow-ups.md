# PvP battle reliability and UI follow-up spec

Status: planned; no implementation changes made.

Source: September 10, 2026 code review of `feat/pvp-battle-system` against
`origin/main`, reviewed at `b9c8257`. All five findings are P2. Recheck the
current implementation before starting each item.

The review ran 69 existing component and battle-rule tests successfully.
Database integration tests were not run. That baseline does not cover the
failure scenarios below.

## 1. Preserve signed requests after an uncertain response

- [x] Implemented and verified together with item 2. `startBattle` now
  splits `signChallenge` into its own try/catch (`declined`/
  `unsupported_wallet` are reachable ONLY from a signing failure) from the
  POST phase, which never throws in a way that reaches that catch --
  `resubmitBattleAttempt`/`classifyBattleResponse` (new, `BattlePanel.tsx`)
  swallow network failures and malformed JSON as retryable. The exact
  signed body/endpoint/wallet is retained in `pendingAttempt` state
  (`PendingBattleAttempt`) and resubmitted verbatim by both automatic
  retries and a manual "Retry" action -- neither ever calls `signChallenge`
  again. `RETRYABLE_BATTLE_ERRORS` encodes the real route/commit_battle.sql
  contract (attempt_in_progress, rate_limited, ownership_unverifiable,
  attacker_metadata_unavailable, attempt_expired, and BT012's
  conflicting_first_use_materialization) -- every other non-2xx, including
  other 409s like attack_cap_reached/self_challenge/attacker_card_not_held,
  is terminal, not retried. `nonce_expired` gets its own `expired` state
  requiring a fresh signature. Retry-After is honored; otherwise a fixed
  2s/5-attempt bound applies, exhausting to an `uncertain` state (Retry
  button, same stored body) rather than any success/failure claim.
  `attemptIdRef` plus a wallet-identity check drop stale resolutions from a
  superseded or wallet-switched attempt.
- Location: `src/components/BattlePanel.tsx`, `startBattle` and error handling.
- Problem: a POST can settle successfully while its response is lost. The
  catch currently reports that the signature was declined and nothing was
  sent, then discards the signed request. Clicking again signs a new nonce
  and can initiate another battle instead of retrieving the first result.

### Required behavior and implementation

- Separate wallet-signing errors from errors after submission. Only a wallet
  rejection or cancellation may display the signature-declined message.
- Retain the exact signed body, endpoint, wallet identity, and attacker card
  for the active attempt. Retry and result retrieval must resubmit that body
  without requesting another signature or changing action parameters.
- Use bounded retry/backoff for network failures and the server's
  `attempt_in_progress` response; honor `Retry-After` where provided.
- Distinguish terminal business errors from retryable failures according to
  the existing route/attempt contract. Do not treat every 409 as retryable.
- After automatic retries are exhausted, show an uncertain-result state with
  a way to retry the retained attempt. Do not imply that no battle occurred.
  Require a new signature when the server reports the attempt has expired.
- Scope asynchronous responses to the initiating wallet and attempt so a
  disconnected or switched wallet cannot receive the previous attempt's UI.

### Acceptance checks

- Simulate settlement followed by a lost response. Retrying sends identical
  signed bytes, calls the signer once, and displays the original result.
- An in-progress response followed by success resolves through bounded
  retries; a terminal business rejection does not loop.
- A rejected signature sends no POST and displays the cancellation message.
- A failed POST or invalid response never displays “nothing was sent.”
- Retry exhaustion and expiry have distinct, usable recovery paths.

## 2. Keep battle controls disabled until settlement finishes

- [x] Implemented and verified together with item 1. `startBattle` no
  longer sets `panelState` back to `idle` after signing -- it goes straight
  to a new `submitting` state (button reads "Battling…") that lasts through
  the whole retry lifecycle, not just the first POST. Both the Battle
  button and the opt-in toggle button are disabled during
  `awaiting_signature`/`submitting`/`syncing`, and both handlers
  (`startBattle`, `toggleOptIn`) also guard themselves at entry against
  duplicate invocation, independent of the disabled attribute. A dedicated
  render-level test ("Battle and opt-in controls stay disabled while a
  battle submission is in flight") holds a fetch response pending, asserts
  both buttons disabled and the button label reads "Battling…", then
  resolves and confirms they re-enable once a terminal state is reached.
- Location: `src/components/BattlePanel.tsx`, immediately after
  `signChallenge` and in the action controls.
- Problem: setting the panel to idle after signing re-enables Battle while
  its POST is running. Additional clicks can create separate attempts and
  competing responses, potentially consuming another allowance or replacing
  a successful result with an error.

### Required behavior and implementation

- Add an explicit submitting state and keep the attempt busy through
  settlement, retries, and the resulting status refresh.
- Guard the handler against duplicate invocation as well as disabling the
  button. Display progress while awaiting settlement.
- Prevent conflicting participation actions while a battle is pending.
- Only the active attempt may update the result or release the busy state.
  Coordinate this state with item 1 so retries never create new attempts.

### Acceptance checks

- Hold the POST response pending and click Battle repeatedly: one signature
  and one initial POST occur, with controls disabled throughout.
- Hold the post-settlement status fetch pending: another battle cannot start
  using the old cap or recovery state.
- Success, terminal failure, and retry exhaustion transition to the intended
  result or recovery UI without leaving an unexplained disabled control.

## 3. Resolve battle stats for the actively displayed card

- [x] Implemented and verified. Replaced the single resolved `battleStats`
  prop with `battleStatsByCardKey?: Map<string, BattleCardStats>`, threaded
  unchanged through `DeckGrid` -> `NFTCard` -> `NFTDetailsModal`.
  `NFTDetailsModal` now resolves `battleStatsByCardKey.get(activeKey) ?? null`
  on every render (not just at open), so it re-resolves whenever prev/next
  navigation changes `activeCard`. A card missing from the map (never
  battled) still gets the estimated Level 1 preview; the section is still
  omitted entirely when the prop itself is `undefined` (outside My Deck).
  New regression test in `NFTCard.test.tsx`: navigate opening card (real,
  Level 5) -> unbattled card (estimate, and asserts "Level 5" does NOT leak
  through) -> another real-progress card (Level 8) -> back through both,
  confirming each card's own values follow in both directions. Full
  component suite: 28/28 pass (was 27; DeckGrid/NFTCard/WishlistGrid/
  PackOpening all still green).
- Locations: `src/components/DeckGrid.tsx`, `src/components/NFTCard.tsx`,
  `src/components/NFTDetailsModal.tsx`.
- Problem: modal navigation changes `activeCard`, but the single
  `battleStats` prop still describes the card that opened the modal.

### Required behavior and implementation

- Pass a map or lookup of battle stats through the deck/card/modal boundary
  and resolve the displayed stats by `activeKey`.
- Preserve the distinction between a context that does not show battle
  stats and a battle-aware context where a card has no progress row.
- Previous/next navigation must update XP, level, Power, HP, and the
  never-battled preview together with the card identity.

### Acceptance checks

- Navigate between two cards with different saved progress and verify each
  card's own values in both directions.
- Navigate from a leveled card to one without progress, then back: only the
  card without progress displays the estimated Level 1 preview.
- Contexts outside My Deck continue to omit battle stats, and the Battle
  action still selects the actively displayed card.

## 4. Expose the authenticated holdings refresh

- [ ] Implement and verify.
- Location: `src/components/BattlePanel.tsx`; reuse
  `src/app/api/battle/refresh/route.ts`.
- Problem: panel opening only reads status, and no client calls the refresh
  endpoint. Newly acquired cards remain outside an opted-in wallet's
  defender pool until the user opts out and back in.

### Required behavior and implementation

- Show the last completed holdings refresh and provide an explicit refresh
  action. Offer refresh when that timestamp is missing or stale; define and
  document a named staleness interval as a UI policy.
- Sign the existing `refresh` action with `[]` and POST the signed body to
  `/api/battle/refresh`. Keep status GET read-only.
- Reuse bounded continuation and rate-limit handling with the same signed
  body, show sync progress, and refresh status after promotion succeeds.
- Preserve opt-in state throughout refresh. Do not require opting out to
  update defender membership.

### Acceptance checks

- An opted-in wallet can refresh newly acquired cards into the defender
  pool without changing its participation state.
- Multi-page 202 responses and retryable 429 responses reuse one signature
  and reach completion; failure never claims that holdings were refreshed.
- Opening a stale panel offers refresh but performs no unsigned write.
- Sold cards leave active membership after successful refresh while saved
  progress remains intact; verify with the database-backed refresh tests.

## 5. Bound holdings sync by elapsed time

- [x] Implemented and verified. New `src/lib/battle/holdingsSync.ts`
  (`runBoundedHoldingsSync`, shared by both routes so their budget policy
  can't drift) tracks a deadline set at route entry
  (`Date.now() + INVOCATION_DEADLINE_MS`, 18s -- 2s under the routes'
  `maxDuration = 20`), before another page is started requires enough
  remaining budget for its worst case (`PAGE_WORK_RESERVE_MS` = the real
  8s upstream timeout + 1.5s for staging/lease-release/response), and
  separately requires `PROMOTION_RESERVE_MS` (2s) before attempting the
  final commit once staging completes -- a fully staged sync that runs out
  of budget still returns a resumable 202 rather than racing the deadline,
  and the next invocation sees status "complete" and promotes with a fresh
  budget. `opt-in/route.ts` and `refresh/route.ts` both now call this
  instead of their own inline page loops. Four new tests in
  `holdingsSync.test.ts`, using a real claimed attempt (via
  `authenticateAndClaim` directly, no HTTP layer) and an injectable clock
  (no real sleeps): a fast collection completes in one invocation; slow
  successful pages (simulated 7s/page) stop after 2 pages rather than
  risking a 3rd, preserving staged progress; a fully staged sync with too
  little time left to promote releases for continuation instead of racing
  it; and resuming (via a real `reclaimAttempt` generation bump, matching
  what a resubmitted request goes through) picks up from the exact saved
  cursor and completes. Verified all three time-budget tests actually
  catch the regression: temporarily short-circuited both deadline checks
  (`if (false && ...)`), confirmed those exact 3 tests fail, reverted.
  Full suite: 250/252 pass (the 2 failures are the pre-existing, unrelated
  DB-contamination issues noted elsewhere in this session, not from this
  change) -- includes both routes' pre-existing "collection larger than one
  page" tests unchanged and still green. `npx tsc --noEmit` and
  `npm run build` both clean.
- Locations: `src/app/api/battle/opt-in/route.ts`,
  `src/app/api/battle/refresh/route.ts`, and supporting holdings/store helpers
  as needed.
- Problem: both routes allow four sequential holdings requests, each with
  an eight-second timeout, inside a 20-second route limit. Four successful
  seven-second pages exceed that limit before database overhead, preventing
  a continuation or completion response.

### Required behavior and implementation

- Track an invocation deadline from route entry, including authentication
  and database work, in addition to the existing page-count bound.
- Before starting another page, require enough remaining time for its
  upstream timeout, staging, lease release, and the HTTP response. Otherwise
  release the lease and return 202 with the saved cursor resumable.
- Reserve time for final promotion and completion too. A fully staged sync
  may return continuation and promote on the next invocation.
- Bound database operations consistently with the invocation budget; a
  page-count check alone cannot bound database waits.
- Apply the same budget policy to opt-in and refresh while preserving
  generation fencing and complete-snapshot-only promotion.

### Acceptance checks

- Use a controlled clock and slow successful page responses to demonstrate
  continuation before the 20-second limit in both routes, without real sleeps.
- Resume using the identical signed body and confirm the saved cursor is
  used, all cards are eventually promoted, and no partial snapshot is exposed.
- Exercise limited time after authentication and after the final staging
  write; no new work starts without the required reserve.
- Existing stale-worker, lease, and participation fencing tests still pass.

## Delivery and validation

Implement items 1 and 2 together or consecutively because they share the
attempt lifecycle. Complete item 5 before validating item 4 with slow,
multi-page holdings. Item 3 is independent.

Read the relevant installed Next.js guides before implementation, as required
by `AGENTS.md`. Use npm, matching this repository's scripts.

- [ ] Add the targeted regression coverage specified above.
- [ ] Run the affected component tests and database-backed route tests against
  an isolated test database with current migrations.
- [ ] Run the repository type check, lint, full test suite, and build.
- [ ] Verify modal navigation, pending battle controls, uncertain-response
  recovery, and signed holdings refresh in the UI.
- [ ] Record implementation and validation evidence under each completed item.
