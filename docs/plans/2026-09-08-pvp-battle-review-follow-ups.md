# PvP battle review follow-ups

Saved from the September 8, 2026 review of `feat/pvp-battle-system` before pushing.
These findings describe the reviewed state; recheck subsequent changes before
implementing. Fix one at a time, with one commit per fix, as requested.

## 1. P1 — Fence staging against the current attempt owner

- [x] Resolved and verified. `migrations/0011_stage_holdings_page_attempt_fencing.sql`:
  `stage_holdings_page` now locks and checks `battle_attempts` (current
  generation, pending status, live lease, retry deadline) before ever
  touching the sync row, instead of trusting the sync's own cached
  `worker_generation`. Regression coverage added in
  `src/lib/battle/holdingsPromotion.test.ts`: a takeover before the new
  worker stages any page, an expired lease with no takeover, and a stale
  worker trying to mark the sync complete. Full suite: 193/195 pass: the two
  failures are pre-existing dev-database test pollution (stray rows from
  earlier interrupted runs), unrelated to this change and reproduced in
  isolation before this fix too.
- Location: `migrations/0006_holdings_sync_fencing.sql`, `stage_holdings_page`.
- The staging function checks the sync's `worker_generation`, but reclaim
  advances the attempt's generation without advancing the sync's generation.
  An old worker can therefore write after takeover, before the new worker stages
  its first page.
- Reproduced in a rolled-back database transaction: after advancing the attempt
  from generation 0 to 1, generation 0 completed staging successfully; generation
  1 was then rejected because the sync was already complete.
- Check the attempt's current generation, pending status, live lease, and retry
  deadline atomically with the staging write, respecting lock order.
- Regression coverage: takeover before the new worker stages any page; expired
  lease without takeover; stale worker attempting to complete the sync.

## 2. P2 — Honor the accepted retry horizon after nonce freshness expires

- [x] Resolved and verified. `src/lib/battle/requestAuth.ts`'s expired-envelope
  branch now looks up the existing attempt and, if it matches identity and
  isn't terminal, checks its own `retry_until` and attempts `reclaimAttempt`
  (the same continuation path the fresh-envelope flow uses) instead of
  rejecting outright -- envelope freshness now gates only creating a brand
  new attempt. Regression coverage in `requestAuth.test.ts`: a pending
  attempt with an expired lease is reclaimed past freshness; a retryable
  failure is reclaimed past freshness; rejection once the retry horizon
  itself has also closed; an expired envelope for an absent nonce still
  cannot create one. Updated the existing test that expected a flat
  rejection to expect reclaim instead. Full suite: 196/198 pass, same two
  pre-existing dev-database pollution failures as before, unrelated.
- Location: `src/lib/battle/requestAuth.ts`, expired-envelope handling.
- Expired envelopes currently retrieve only terminal results. Pending attempts
  and retryable failures are rejected after five minutes even though an accepted
  attempt has a 15-minute retry horizon.
- Reproduced with a real test signature: a retryable failure resubmitted at six
  minutes returned `401 nonce_expired` inside its accepted retry horizon.
- After verifying the signature and identity, use the existing attempt's
  `retry_until` and lease/generation rules for continuation. Require envelope
  freshness only when creating an absent attempt.
- Regression coverage: retryable failure and expired-lease continuation after
  nonce freshness expires; rejection after the retry deadline; expired absent
  nonce cannot create an attempt. Update the existing test that expects pending
  attempts to be rejected solely because their envelope expired.

## 3. P2 — Give stale holdings snapshots a recovery path

- [ ] Resolve and verify.
- Locations: `migrations/0009_participation_retry_fencing.sql` and
  `src/lib/battle/store.ts`, `startOrResumeHoldingsSync`.
- Participation and refresh commits mark `stale_holdings_generation` retryable,
  but resuming returns the same completed sync with its obsolete captured
  holdings generation. Reclaiming the attempt cannot repair that snapshot.
- Reproduced in a rolled-back database transaction: the initial commit and the
  reclaimed commit both returned `409 stale_holdings_generation`.
- Either restart staging under the current holdings generation with appropriate
  fencing, or make this terminal and require a new signed attempt. Preserve the
  intended protection against an older opt-in overriding a later opt-out.
- Regression coverage: perform the actual retry for both opt-in and refresh;
  asserting only that `retryable` is true does not demonstrate recovery.

## 4. P2 — Preserve large-wallet sync progress across rate limiting

- [ ] Resolve and verify.
- Locations: `src/components/BattlePanel.tsx`, opt-in continuation loop, and
  `src/app/api/battle/opt-in/route.ts`, request budget.
- The UI resubmits on `202`, but abandons the signed request on `429`. The server
  allows 20 opt-in requests per minute, each staging at most 400 holdings. A
  collection needing more than 20 requests can hit that limit when responses
  are fast enough. Clicking again signs a new nonce and restarts staging.
- Preserve the signed request and resume after suitable backoff within its
  accepted retry deadline. Provide a clear restart path when that deadline ends.
- Regression coverage: a `202 → 429 → 202 → 200` sequence reuses the same signed
  body and completes without another signature or restarting the snapshot.

---

Items 5-6 below are test-coverage gaps identified in a separate session,
not part of the review above; the "Verification at review time" section
still describes only that review's own findings and checks.

## 5. P2 — No route-level coverage proving wallet-keyed rate limits actually fire

- [ ] Resolve and verify.
- Locations: `src/app/api/battle/random/route.test.ts`,
  `src/app/api/battle/challenge/route.test.ts`,
  `src/app/api/battle/opt-in/route.test.ts`.
- `checkRateLimit` is unit-tested in `store.test.ts`, and `session`/`status`
  (both IP-keyed) each have a route-level test proving a 429 fires past
  budget. `random`, `challenge`, and `opt-in` (all wallet-keyed) have no
  equivalent — nothing confirms the limiter is actually wired into those
  routes at the position it needs to be (after auth, before upstream work),
  only that the underlying primitive works in isolation.
- Regression coverage: for each of the three routes, a test driving the
  wallet past its per-route budget and asserting the next request returns
  429 with `rate_limited`, persisted on the attempt as `retryable: true`,
  without exhausting a shared wallet's budget for other tests in the same
  file (see the existing per-file rate-limit bucket cleanup pattern in
  `opt-in/route.test.ts`'s `cleanupWallet`).

## 6. P2 — Missing regression coverage for the ownership-reverify and unverifiable-exclusion fixes

- [ ] Resolve and verify.
- Location: `src/app/api/battle/random/route.test.ts`.
- Two fixes from an earlier review pass have no route-level test: the final
  ownership reverify immediately before `commitBattle` (both attacker and
  defender), and treating a pool exhausted by unverifiable-ownership
  exclusions as a retryable 503 rather than a false `no_match`. Both are
  correct by inspection and covered by the reasoning in code comments, but
  neither has a test that would catch a future regression reverting them.
- Regression coverage: a test where ownership is confirmed at the initial
  check but reports `not_held`/`unverifiable` on the pre-commit reverify
  (attacker and defender, separately), asserting the existing
  `attacker_card_not_held`/`defender_card_not_held`/`ownership_unverifiable`
  responses fire from that second check, not just the first; and a test
  where every candidate in the matchmaking pool is excluded for unverifiable
  reasons (never `not_held`), asserting a `503 ownership_unverifiable`
  response instead of a `200 no_match`.

## Verification at review time

- All 175 tests passed against an isolated local Postgres review database.
- Type checking (`npx tsc --noEmit`) and lint (`npm run lint`) passed.
- Migrations through `0009` applied successfully to that review database.
- Findings 1–3 were directly reproduced; finding 4 was identified by tracing
  the UI continuation loop and server request budget.
- The review made no repository changes and pushed nothing. This document saves
  the outstanding findings; it does not mark any fix complete.
