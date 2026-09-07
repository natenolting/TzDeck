---
title: PvP Battle System
type: feat
status: active
date: 2026-09-06
deepened: 2026-09-07
origin: docs/brainstorms/battle-system-requirements.md
---

# PvP Battle System

## Overview

Adds a WikiGacha-inspired PvP battle system to TzDeck: a wallet's held OBJKTs gain Level/Power/HP through 1v1 battles against other opted-in wallets' cards. This is the first TzDeck feature requiring real server-side write state and wallet-attributed authentication — today the app is a stateless proxy over OBJKT/Tezos read data with zero database, zero auth beyond client-side wallet connection, and zero persistence beyond browser `localStorage` (the wishlist).

Five new systems land together: (1) a Neon Postgres datastore, provisioned with no credit card so its own free-tier fail-closed behavior is the cost ceiling; (2) signed-challenge wallet authentication via Beacon, since nothing today lets the server confirm a client-submitted address is genuinely who it claims to be; (3) a combat/progression engine (per-card Power/HP derivation, round-by-round damage resolution with an overkill tiebreak, XP/leveling); (4) matchmaking on combined Power×HP similarity; (5) an extension of the existing 3-tier `calculateSupplyRarity` grading to 5 tiers, which also changes what My Deck's rarity badges display today.

---

## Problem Frame

TzDeck currently treats OBJKT cards as static collectibles with no ongoing reason to revisit them after collecting. The site is explicitly inspired by wikigacha.com, which gives collected cards an ongoing purpose via an automated battle system. `docs/brainstorms/battle-system-requirements.md` defines the full product behavior (20 requirements, 4 key flows, 13 acceptance examples) after an extensive simulation-driven brainstorm that resolved two initially-open product questions: the combat-resolution mechanic (simultaneous damage-with-variance, plus a new overkill-margin tiebreak on simultaneous knockouts) and the matchmaking similarity metric (combined Power×HP, chosen over Power-only and simulated win-probability after controlled testing). Both are documented with rationale in the origin's Key Decisions section, and both carry an explicit caveat: the tiebreak's real-world effect on draw rate is expected, not yet empirically confirmed — this plan's implementation should be the first place that gets validated.

This plan defines **how** to build what the origin already decided **what** to build. It does not revisit product decisions already made — where the origin left a technical gap (e.g., transaction boundaries, auth library choice, DB provider), those are resolved here with rationale, following the pattern the origin itself used (state the decision, cite the evidence, don't hide the residual uncertainty).

---

## Requirements Trace

**Identity & authentication**
- R1. Signed, server-verified proof of wallet control required to initiate a battle.

**Eligibility & deck**
- R2. Only NFTs currently held by the connected wallet may be selected.
- R3. A card in recovery cannot initiate or be matched as a defender.
- R4. Both attacker's and defender's ownership verified fresh at battle time, not from `/api/deck`'s cache.
- R5. Defender participation requires explicit opt-in; opt-out stops new defensive matches without losing progress.
- R6. A wallet can never be matched or challenged against itself.

**Stats & progression**
- R7. Progress tracked per wallet+card pair, not per token.
- R8. Base Power from edition scarcity, base HP from rarity-tier baseline + bounded description-length modifier; `calculateSupplyRarity` extended to 5 tiers.
- R9. Re-acquiring a previously-leveled card restores its saved progress.
- R10. XP scaled by defeated opponent's rarity/level; losers and draws get no XP.
- R11. XP carries over past a level threshold; a single award can cross multiple levels.

**Combat resolution**
- R12. 1v1, one card per side.
- R13. Automated simultaneous-damage exchange, no player input mid-battle.
- R14. Simultaneous knockouts resolve via an overkill-margin tiebreak; only an exact numeric coincidence remains a true draw.
- R15. Random matchmaking on combined Power×HP similarity, with band-widening and a no-opponent-found terminal state.
- R16. Direct challenge to a named wallet, same similarity metric.

**Pacing & integrity**
- R17. Recovery period on loss; shorter for a defensive loss than an offensive one.
- R18. Independent attack and defense daily caps per wallet.
- R19. Battle result commits atomically; retried/duplicate requests return the original result, not a re-resolution.
- R20. Anti-farming XP-decay throttle keyed on the (winner, loser) wallet pair.

**Origin actors:** A1 (Attacker), A2 (Defender), A3 (Server — battle authority)
**Origin flows:** F1 (Random Battle), F2 (Challenge a Specific Wallet), F3 (Card Levels Up), F4 (Card Recovers After Defeat)
**Origin acceptance examples:** AE1-AE13, all carried forward as constraints on the relevant implementation units below (see per-unit Requirements and Test scenarios).

---

## Scope Boundaries

### Deferred for later

- Team battles (multiple cards per side) — this version is 1v1 only.
- PvE modes (raid bosses, system-generated opponents).
- Leaderboard or ranking UI beyond what F2's direct-challenge needs.
- Cosmetic/reward systems beyond a card's own Level/Power/HP.
- Letting a wallet mark a specific card as its "active defender."
- Abstracted/contract-wallet participation in battles — auth (U2) verifies a Beacon message signature against an implicit account's public key only. A connected abstracted account has no `AccountInfo.publicKey` to verify against (security review finding); it sees a clear "wallet type not supported for battles" state rather than a confusing failure. Revisit if/when this matters to enough users.

### Outside this product's identity

- Any mechanic where battling affects real OBJKT ownership, listing price, or requires spending Tezos/XTZ. The battle system stays a simulated meta-game layered on real collection data.
- Manual or skill-based combat input. Fully automated only.

### Deferred to Follow-Up Work

- Exact numeric tuning values (Power/HP formula constants, XP-to-level curve, recovery durations, daily cap values, strength-band width, XP-decay curve, epic/legendary edition thresholds, nonce expiry) are chosen at implementation time against the shape this plan fixes per-unit (see Open Questions — Deferred to Implementation for the full list) — production values are expected to move after U5's validation pass (see below), and that's expected, not a plan defect.

Tiebreak validation is part of U5 acceptance before shipping; only subsequent tuning is follow-up work.

---

## Context & Research

### Relevant Code and Patterns

- `src/app/api/deck/route.ts`, `src/app/api/random-pack/route.ts` — the only two existing API routes; both are GET/POST-only, read-only external-data proxies. House style to match exactly: `try/catch` → `console.error(context, err)` → `NextResponse.json({ error }, { status })`; explicit `maxDuration` with a rationale comment; explicit `dynamic`/cache-control choice with a rationale comment. Neither has any persistence or auth today — every route this plan adds is a new pattern, not an extension of an existing one.
- `src/lib/objkt.ts` — single 576-line file holding all current domain logic. `calculateSupplyRarity` (lines 193-198, 3-tier), its two call sites (line 256 inside `normalizeObjktToken`, line 396 in the TzKT-fallback branch), `getCardKey` (lines 80-84, `` `${contract_address}:${token_id}` ``), `RARITY_THRESHOLDS`/`RARITY_LEGEND` (lines 9-54). No component calls `calculateSupplyRarity` directly — both call sites feed `NFTCard.rarity`, consumed by `DeckGrid.tsx`/`NFTCard.tsx` via that field. `rarityStyles.ts`'s `RARITY_CONFIG` and `page.tsx`'s `RARITY_DOT_CLASS` already define all 5 tiers cosmetically — only the grading function itself needs the extension.
- `src/lib/objkt.test.ts` (lines 77-81) — the exact 3-tier assertions that need updating alongside R8.
- `fetchUserHoldings` (`src/lib/objkt.ts:318-406`) returns `[]` when both the OBJKT and TzKT fallback calls fail — indistinguishable from "this wallet genuinely holds nothing." Not safe to reuse as-is for R4's fresh-ownership gate, which needs "not held" and "could not verify" to be different outcomes (an upstream outage must not read as every card being unowned). This plan adds a narrow, single-token ownership query instead — see U4b.
- `src/context/WalletContext.tsx`, `src/context/walletInitialization.ts` — `BeaconWallet` connection lifecycle (`requestPermissions()`, `getActiveAccount()`, `clearActiveAccount()`); the `runWalletInitialization({ initialize, isMounted, onReady, onError })` pattern for avoiding setState-after-unmount, with its own test file — mirror this shape for any new wallet-interaction hook.
- `README.md` (lines 17-35) — documents the 3-tier rarity system; needs a copy update alongside R8.
- Test convention (`src/lib/objkt.test.ts`, `src/context/walletInitialization.test.ts`, `src/app/api/random-pack/*.test.ts`): plain `node:test` + `node:assert/strict`, no mocking library, direct monkey-patching of module singletons restored in `finally`, seeded-PRNG substitution for `Math.random` when testing randomized logic (`objkt.test.ts` lines 135-186 for `shuffleArray`, 338-371 for `fetchRandomPack`) — the established, direct precedent for testing this plan's combat-variance and matchmaking-selection logic deterministically.
- `package.json`'s `test` script globs specific directories (`src/lib/*.test.ts src/context/*.test.ts src/hooks/*.test.ts src/components/*.test.tsx src/app/api/random-pack/*.test.ts`) — new server-side test files outside these globs need the script updated, not just written.

### Institutional Learnings

- No `docs/solutions/` exists in this repo (confirmed absent) — no prior institutional learning to draw on. This is flagged in the plan's Documentation / Operational Notes as a `/ce-compound` candidate once this feature ships, since it's establishing several first-of-their-kind patterns (persistence, auth, atomic writes) the next feature touching any of them shouldn't have to rediscover.
- Project memory (`tzdeck-vercel-cost-constraint.md`, `vercel-firewall-log-mode.md`): hard $20/month Vercel ceiling; Hobby plan; no middleware; a single WAF rate-limit rule already covers all of `/api` (IP-keyed, 60 req/60s), meaning this feature's own abuse protection must be application-layer, not an additional firewall rule (Hobby allows only one).

### External References

- **Vercel Marketplace DB billing** (vercel.com/docs/spend-management, vercel.com/docs/plans/hobby, vercel.com/docs/marketplace-storage; Neon and Upstash Vercel-integration docs; researched 2026-09-06): Spend Management explicitly does not cover Marketplace integrations, on Hobby *or* Pro — confirmed via Vercel's own docs text. Neither Hobby's pause-not-charge table nor Spend Management reaches Marketplace spend. The only real cost ceiling for a Marketplace DB is **not attaching a payment method to that resource** — both Neon and Upstash fail closed (suspend/rate-limit, no charge) with no card on file; Upstash explicitly auto-upgrades to metered billing the moment a card is attached, so this is a one-time provisioning choice with a durable warning to document.
- **Neon Postgres free tier** (neon.com/docs, researched 2026-09-06): 0.5 GB storage, 100 CU-hours/month compute, no card required, hard-stop-not-charge on breach (compute suspends until next period). Chosen over Upstash Redis: this feature's data (per-wallet-card progress, battle history, opt-in flags, rate-limit counters) is small, relational, and needs one atomic multi-field commit per battle plus an idempotency-key-conflict pattern — Postgres' native fit, versus hand-rolling both in Redis Lua scripts for no benefit at this scale.
- **Neon serverless driver + atomicity** (neon.com/docs, researched 2026-09-06): `@neondatabase/serverless` is HTTP-based, not a persistent connection — `sql.transaction()` exists but is non-interactive (can't branch mid-transaction on a just-read value). Given this feature's battle-commit logic (read XP → decide level-up → write) is expressible entirely in SQL (arithmetic, `CASE`), the chosen fit is a single call to a versioned Postgres function. Its nested error handling, explicit lock order, and normal structured failure returns are specified below.
- **Idempotency pattern**: unique `idempotency_key` column, `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`; empty return means a duplicate — re-`SELECT` by that key and return the original result. Current standard guidance (Stripe-style), not something this codebase has any precedent for (confirmed: zero `idempoten`/`atomic`/`ETag` hits anywhere in the repo).
- **Beacon signed-challenge** (docs.walletbeacon.io, taquito.io, researched 2026-09-06): `wallet.client` in this codebase is a `DAppClient` from `@ecadlabs/beacon-dapp` (confirmed via `.d.ts`), **not** `@airgap/beacon-sdk` despite that package being a direct dependency — pull `SigningType`/`RequestSignPayloadInput` from `@ecadlabs/beacon-types` to match, not `@airgap/beacon-types` (nominal-type mismatch risk otherwise). Sign with `SigningType.MICHELINE` (the recommended type for message-signing, not `RAW` or `OPERATION`), packing the challenge string via `packDataBytes` from `@taquito/michel-codec`. Verify server-side with `@taquito/utils`'s `verifySignature(bytes, publicKey, signature)` plus `getPkhfromPk(publicKey)` to independently re-derive the address — never trust a client-supplied address alone. All three packages (`@ecadlabs/beacon-types`, `@taquito/michel-codec`, `@taquito/utils`) resolve transitively today but need to become **direct** dependencies since new code imports them directly.
- **Next.js 16.3.4 Route Handler specifics** (`node_modules/next/dist/docs/`, this repo's exact installed version, researched 2026-09-06): Edge Runtime is deprecated in this version — do not set `runtime = 'edge'`; default (unset, same as both existing routes) resolves to Node.js. Vercel Hobby's `maxDuration` default and ceiling is now 300s via Fluid Compute (not the old 10s/60s some tooling still assumes) — pick a value reflecting real DB-write latency with a rationale comment, don't copy a stale assumption in either direction. Connection-pooling guidance for Fluid Compute specifically is genuinely unsettled across sources; sidestepping the ambiguity by using Neon's HTTP driver (no persistent pool to reason about) is the safer path already implied by the atomicity research above.

---

## Key Technical Decisions

These are the final design constraints. The implementation units below own their detailed contracts and tests.

- **Datastore:** Neon Postgres Free, with no payment method attached to the resource. Verify the integration's billing controls before provisioning. Exhausting its free allowance may suspend battles; existing deck and pack features must remain usable.
- **Atomic writes:** invoke a Postgres `plpgsql` function through the Neon HTTP driver. A nested exception block rolls back game writes on an expected business rejection; its handler records the attempt failure and returns a structured error normally. An uncaught error rolls back the entire invocation, including handler writes. Never claim that updating a failure status and then re-raising makes that status durable. **This durability guarantee depends on `commit_battle`/`fail_attempt`/`commit_participation` always being invoked as a standalone, unwrapped top-level statement over the HTTP driver — never batched with another statement or wrapped in `sql.transaction()`.** A future change that does either would silently reintroduce the exact non-durable-failure-write problem this design exists to avoid, with nothing else in this plan to catch it.
- **One lock order across all writers:** attempt row first; wallet rows in address order; progress rows in `(wallet, card_key)` order. Wallet rows precede progress rows so first-use initialization and foreign keys fit the same order. Battle commit, participation changes, materialization, and refresh promotion follow it. No network calls occur while these locks are held. The attacker-only first-use insert is safe from concurrent-INSERT races only because a defender/challenge-target's progress row always already exists via holdings promotion (U4c) before it's eligible to be selected — this invariant must hold for any future change to candidate-pool sourcing.
- **Exclusive attempts:** the nonce MAC identifies a `battle_attempts` row bound to wallet, action, and parameter hash. Each claim has a monotonically increasing `generation` and expiring lease. All completion, failure, renewal, and staging writes must match the current generation. The commit function checks the attempt under lock, not just at the route layer. U1b defines takeover and crash recovery.
- **Signature lifetime and result lifetime differ:** verify the envelope MAC, action-bound signature, and derived wallet on every request. Fresh nonces authorize initial claims; accepted attempts may resume only within their fixed retry deadline. Completed results remain retrievable with the original valid signature after nonce expiry, for a defined retention period. U2 specifies the order and cleanup boundaries.
- **Role-specific eligibility:** enforce only the attacker's attack cap and defender's defense cap, plus both recovery timers and the defender's current opt-in. Use effective current-UTC-day counts before checking eligibility, including in matchmaking and status reads. A successful battle increments the relevant counters and advances their reset timestamps atomically.
- **Concurrent card use:** check each card's expected `progress_version` and seed; increment versions on every committed battle, including draws. A stale resolution is rejected without game writes. Role assignment is separate from sorted lock acquisition.
- **Progress and seeds:** lifetime cumulative XP is stored; level and effective Power/HP are derived. Capture `base_seed` once when progress is first materialized. Before resolving a first-use attack, fetch authoritative token metadata server-side and prepare a provisional seed plus an explicit `absent` expectation. Commit inserts or validates precisely those inputs; it never invents different stats after combat. U8 defines initialization for wallets that never opted in.
- **Rolling XP decay:** count committed wins by the ordered `(winner_wallet, loser_wallet)` pair in `(settlement_time - window, settlement_time]`, using indexed `battle_log` events. Wallet locks serialize same-pair settlements across cards and roles. No separate lifetime counter or fixed-window reset is used; old wins leave the count individually. U8 applies the multiplier and records the next event in one transaction.
- **Participation:** sign an explicit desired `optedIn` boolean, not a toggle or empty parameter list. `commit_participation` saves the desired state and request result atomically using the same attempt fencing as battle commit. Opt-in and holdings refresh use complete, typed, paginated server snapshots; opt-out requires no upstream fetch.
- **Ownership and holdings:** `ownership.ts` answers fresh single-card eligibility with `held`, `not_held`, or `unverifiable`. `holdings.ts` supplies authoritative metadata and complete/resumable holdings snapshots. Progress survives a sale; a separate active-holdings set determines matchmaking membership. Upstream uncertainty never removes cards as if absence had been confirmed.
- **Matchmaking:** one best-fitting eligible card per wallet, selected using Power×HP; exclude self, widen within fixed bounds, and bound ownership re-rolls separately. Direct challenge names a wallet and lets the server select its card. A confirmed no-match response is recorded as a completed, zero-cost attempt so a retry returns the same result.
- **Module boundaries:** `rules.ts` contains pure stats, combat, progression, matching, and tuning; `store.ts` contains database access; `auth.ts` contains signature/envelope verification; `ownership.ts` and `holdings.ts` handle upstream reads. SQL decay/XP helpers must match shared test vectors and a versioned rules configuration; Postgres cannot call TypeScript functions directly.

---

## Output Structure

```text
src/lib/battle/
  rules.ts, rules.test.ts              # pure combat, stats, progression, matching
  store.ts, store.test.ts              # client, claims, commits, reads, staging
  auth.ts, auth.test.ts                # envelopes and action-bound verification
  ownership.ts, ownership.test.ts      # fresh single-card ownership
  holdings.ts, holdings.test.ts        # metadata and paginated holdings snapshots
<chosen migration directory>/          # schema, indexes, versioned SQL functions
src/app/api/battle/
  session/route.ts                     # stateless nonce issuance
  random/route.ts                      # F1; POST
  challenge/route.ts                   # F2; POST
  opt-in/route.ts                      # explicit participation state; POST
  refresh/route.ts                     # authenticated holdings refresh; POST
  status/route.ts                      # effective caps, stats, recovery; GET
  <each route>/route.test.ts
src/components/
  BattlePanel.tsx, BattlePanel.test.tsx
```

---

## High-Level Technical Design

### Attempt lifecycle

1. Validate bounded input, recompute the envelope MAC and signed bytes, verify the signature, and derive the wallet. Apply the identity checks to every existing-attempt state, including pending and failed.
2. A matching completed or terminal-failed attempt returns its stored response without new work, including after nonce expiry within retention. An unknown expired nonce cannot create work. Initial claims require a fresh nonce; retry/takeover of an existing attempt requires its fixed retry deadline to remain open.
3. Claim an absent attempt or atomically reclaim a retryable failure/expired lease, incrementing `generation`. A live pending lease returns `409 attempt_in_progress` with `Retry-After`. A caller only owns work after the claim returns its generation.
4. Perform bounded upstream reads and computation outside game locks. Renew the lease conditionally when needed. Stop if renewal fails. A lost worker is recoverable through lease expiry; catch handlers are not the only recovery mechanism.
5. Commit through the fenced function below. Retry after a lost response first reads the attempt; it must not assume a timeout means failure. An old generation can neither commit nor mark a newer generation failed.

### Battle commit and failure persistence

This is procedural pseudocode, not executable migration SQL. Implement and test the actual function against Postgres in U8.

```text
commit_battle(nonce, generation, request_identity, trusted_resolution):
  lock attempt row
  reject mismatched identity; return stored response if already terminal
  require pending, matching generation, live lease, open retry deadline

  BEGIN nested game-write block
    visit both wallet keys in address order:
      insert missing attacker wallet with opted_in=false and zero caps when its turn arrives
      lock wallet; require defender wallet already exists
    visit both progress keys in (wallet, card_key) order:
      insert missing attacker progress only for expected-absent inputs when its turn arrives
      lock progress; reject a conflicting first-use insertion as stale
    require both rows exist and match expected seed/version/XP inputs
    require rules_version still matches the SQL rules configuration

    settlement_time = database wall clock after lock waits
    recheck lease and retry deadline; require attacker != defender
    effective_attack = 0 if attack_reset_at <= settlement_time else attack_count
    effective_defense = 0 if defense_reset_at <= settlement_time else defense_count
    require effective_attack < attack_max and effective_defense < defense_max
    require defender opted in and neither card recovering at settlement_time
    require fresh ownership observations within the allowed age

    if decisive outcome:
      count prior pair wins in (settlement_time - decay_window, settlement_time]
      compute integer XP award from base award and that count in SQL
      add XP to winner; apply role-appropriate recovery to loser
    increment both progress versions (also on draw)
    write relevant caps as effective_count + 1; reset_at = next UTC midnight
    insert immutable battle log, including winner/loser only for decisive outcomes
    mark attempt completed with original response
  EXCEPTION expected business rejection:
    nested game writes have rolled back
    mark current attempt failed with stored response and retryable=false
    return structured failure normally  // do NOT re-raise
  END
  return stored successful response
```

The outer attempt lock remains held while the nested block handles expected failures. Catch only designated business errors there. Unexpected database errors abort the invocation; the prior pending claim remains recoverable through its lease. A separate `fail_attempt(nonce, generation, ...)` may record pre-commit upstream failures using a conditional update, but must never overwrite a completed result or another generation. Infrastructure errors may be retryable; business rejections and confirmed no-match outcomes are stable responses for that attempt.

`commit_participation` and refresh promotion use the same outer attempt fencing and nested rollback pattern. Their state change, any completed snapshot promotion, and saved result commit together. All writers acquire wallet locks before progress rows, including bulk materialization. Use bounded database lock/statement timeouts; report infrastructure failures honestly and recover via the attempt lifecycle.

### Freshness boundary

The ownership check is a fresh upstream read immediately before commit, not `/api/deck` cache data. Set a maximum observation age and reject/reverify if matchmaking or lock waits exceed it. Indexer lag and a transfer after the final check remain an accepted race; the database cannot make an external ownership read atomic with game state.

---

## Implementation Units

- U1. **Neon provisioning and schema**

**Goal:** Establish server-only persistence and migrations within the cost constraint.

**Requirements:** R5, R7, R18-R20. **Dependencies:** None.

**Files:** create `src/lib/battle/store.ts`, `store.test.ts`, schema/function migrations; update `package.json` with `@neondatabase/serverless` and both `src/lib/battle/*.test.ts` and every `src/app/api/battle/*/route.test.ts` in test discovery.

**Approach:**

- Provision Neon Free only after verifying the integration's no-payment-method cost controls. Keep credentials in a server-only environment variable. Invoke SQL functions through the HTTP driver; function definitions belong in migrations, not ad hoc runtime creation.
- `wallets`: address PK, `opted_in`, independent attack/defense count and reset-at columns, `holdings_generation`, `holdings_refreshed_at`. Initialize a new attacker with `opted_in=false`; attacking never implicitly opts a wallet into defense.
- `wallet_card_progress`: composite PK `(wallet, card_key)`, wallet FK, lifetime `xp`, immutable `base_seed` with metadata provenance, nullable `recovery_until`/`recovery_reason`, and `progress_version` (starts at zero). No separately stored level counter. Validate nonnegative XP/version, canonical card keys, and seed bounds.
- `battle_attempts`: nonce PK, immutable wallet/action/parameter hash, envelope issue time, first-claimed time, fixed `retry_until`, `status`, `generation`, `lease_expires_at`, `retryable`, structured response/status code, and completion/retention timestamps. A terminal response is immutable.
- `battle_log`: battle/attempt identity unique, both wallet/card identities, decisive winner/loser or null for draw, settlement timestamp, rules version, seed/stat/version inputs, RNG seed, outcome, XP award and resulting progression. Index `(winner_wallet, loser_wallet, settled_at)` for rolling decay. Do not add `wallet_pair_decay`; the indexed events are the source of truth.
- `wallet_holdings`: wallet/card membership for the last complete promoted snapshot, distinct from permanent progress. `holdings_syncs` and staging rows hold server-owned snapshot identity, source/checkpoint, cursor, captured wallet holdings generation, and deduplicated cards until promotion. Partial snapshots cannot change active membership or opt-in state.
- A versioned SQL rules configuration supplies cumulative XP thresholds and decay parameters. Store functions and TypeScript helpers use matching fixtures; a mismatched rules version rejects settlement instead of mixing deployments.
- Terminal attempt responses are retained for at least 30 days and never less than the accepted retry horizon. Retain audit events for at least the decay window and the documented audit policy. Bound abandoned staging cleanup without deleting a live worker's data.

**Tests / verification:** migrate an empty real Postgres database, verify constraints and indexes, exercise server-only connection errors and initialization, and confirm route tests are discovered. No database provisioning is performed merely by editing this plan.

---

- U1b. **Fenced attempt claims and recovery**

**Goal:** Prove exclusive ownership, idempotency, and crash recovery before building game commits.

**Requirements:** R19. **Dependencies:** U1.

**Files:** `src/lib/battle/store.ts`, `store.test.ts`.

**Approach:**

- Initial claim uses unique nonce insertion. On conflict, lock/read the row in a new statement if needed and validate the entire immutable identity before handling its status.
- Only an atomic update from a retryable failure or expired pending lease can reclaim work: check status, deadline, and identity; increment generation; set pending and a new lease; return the generation. Two simultaneous reclaimers cannot both succeed.
- Lease renewal requires matching generation, pending status, an unexpired lease, and open retry deadline. Never extend `retry_until`. An expired worker cannot revive its own lease.
- Initial values: nonce freshness 5 minutes, retry horizon 15 minutes from first claim, lease 60 seconds with renewal every 20 seconds during active work, terminal-result retention 30 days. These are operational starting values, subject to latency testing; their distinct meanings and ordering constraints are fixed. A commit must finish within configured bounded statement timeouts.
- `completed` returns the original response; it includes successful battles, participation changes, refresh results, and confirmed zero-cost no-match outcomes. `failed` stores an error response and whether retry is permitted. Business rejection is terminal; transient upstream failure can be reclaimed within the retry horizon. Expired nonterminal attempts return `410 attempt_expired` and require a newly signed action.
- A bounded sync slice may atomically save its checkpoint and set its pending lease expiry to the current database time, conditional on the current generation and live lease. This explicitly releases ownership for continuation without labeling successful partial work as a failure. The next request reclaims through the ordinary expired-lease path and increments generation.
- `fail_attempt`, `complete_no_match`, lease renewal, and staging writes all compare generation and state. Battle and participation functions independently lock/check the attempt before changing game state. Unexpected process death needs no failure callback: lease expiry enables takeover.
- Cleanup never deletes an attempt before its envelope freshness and accepted retry deadline have both expired; terminal responses additionally receive the retention guarantee. Expired nonterminal rows are treated as closed work even if physical cleanup has not run.
- Retrying after an ambiguous database timeout always looks up the attempt first. A stale worker's failure callback must not overwrite a result already completed by either worker.

**Tests:** first claim; identity mismatch in every state; concurrent initial claims; simultaneous failed-attempt reclaim; worker death; expired-lease takeover; renewal after expiry; old worker resuming after takeover; lost database response after successful commit; terminal no-match retry; retry deadline boundary; and cleanup leaving no route to replay expired work. Use a real database for concurrency and assert one effect, not merely one response.

---

- U2. **Signed wallet authentication and result retrieval**

**Goal:** Authenticate each wallet-attributed action and its retries without confusing signature freshness with result retention.

**Requirements:** R1, R19. **Dependencies:** U1b.

**Files:** create `auth.ts`, `auth.test.ts`, session route and tests; extend `WalletContext.tsx` with `signChallenge`; add direct dependencies `@ecadlabs/beacon-types`, `@taquito/michel-codec`, and `@taquito/utils`.

**Approach:**

- Issue `{timestamp, random, mac}` without database writes. Use cryptographically secure random bytes, HMAC-SHA256 with a server-only secret, explicit application/environment identity, and the same shared client/server byte encoder defined below for action parameters — not a separately-invented "unambiguous encoding," since a naive delimiter-free concatenation of variable-length `timestamp`/`random` fields is exactly the collision this plan already hardens the action encoder against. Validate field sizes and timestamp format and compare MAC bytes in constant time. **The secret itself, not just `appId`, must differ per deployment environment** — HMAC is symmetric, so a shared secret with only `appId` varying lets anyone holding one environment's secret (e.g. a less-hardened staging environment) mint fully valid envelopes for another.
- Define a shared client/server byte encoder: UTF-8 JSON arrays of strictly validated positional primitives, fixed action schema/version, canonical addresses and card keys, explicit booleans, no optional-field ambiguity or extra action fields. Hash the encoded action parameters; sign the encoded `[protocolVersion, appId, mac, action, paramHash]`. Never concatenate variable-length fields without framing or accept client-supplied signed bytes as authoritative. The envelope MAC above reuses this same encoder for its own inputs, rather than a second, independently-specified scheme.
- Pack as Micheline via `packDataBytes`, sign with Beacon `SigningType.MICHELINE`, and reconstruct exactly those packed bytes server-side for `verifySignature`. Derive the wallet using `getPkhfromPk(publicKey)` and compare it to the claimed address. Require a supported implicit-account public key; the client shows a distinct unsupported-wallet state otherwise.
- Every request first verifies envelope integrity and the action-bound signature, even for cached results. Then look up the attempt and enforce identity. A matching terminal result may be returned after nonce freshness expiry, within its retention period, without performing new writes or upstream work.
- An absent attempt requires a nonce no more than 5 minutes old (and not future-dated beyond allowed clock skew). An existing accepted attempt may be reclaimed only under U1b's fixed retry deadline and generation rules, even if its original nonce freshness has expired. An expired or purged old nonce cannot create a new attempt.
- Retain the envelope-verification key for the result-retention horizon if rotating keys, or provide an equivalent authenticated result-retrieval mechanism before retiring it. Never relax signature verification to support retries.
- This is per-action signing, not a bearer session. Replay identity is the nonce and action binding, not raw signature bytes. Reuse the wallet initialization lifecycle pattern to avoid state updates after unmount or a wallet switch.

**Verification order:**

```text
validate envelope and request -> verify MAC and action-bound signature -> derive wallet
lookup attempt and compare immutable identity
if terminal and retained: return original response
if absent: require nonce freshness before initial claim
if existing nonterminal: require accepted retry deadline before reclaim/lookup
atomically claim or report in-flight; return generation to the server worker
```

**Tests:** a real test-keypair issue/sign/verify round trip; wrong key, action, fields, boolean, app/environment, or malformed signature; future timestamp; duplicate identity mismatch; completed retry after nonce expiry; transient retry within the accepted horizon; expired retry horizon; purged nonce replay; and lost-response retrieval. Assert no new game work for completed retries. A live duplicate returns in-flight, not a false authentication failure.

---

- U3. **Extend rarity grading to 5 tiers**

**Goal:** `calculateSupplyRarity` reaches epic/legendary using edition count alone, since R8's Power/HP derivation and R10's XP-scaling both need the full 5-tier label, and this function is the one origin explicitly designates as shared with My Deck's display.

**Requirements:** R8 (rarity-label dependency); Dependencies section (My Deck badge side effect)

**Dependencies:** None

**Files:**

- Modify: `src/lib/objkt.ts` (`calculateSupplyRarity`, lines 193-198; `RARITY_THRESHOLDS` if new edition breakpoints are added)
- Modify: `src/lib/objkt.test.ts` (lines 77-81, the existing 3-tier assertions)
- Modify: `README.md` (lines 17-35, rarity table copy)

**Approach:**

- Add edition-count breakpoints for epic and legendary reachable without price data, consistent with the existing threshold style in `RARITY_THRESHOLDS`. Exact breakpoint values are a tuning question (Open Questions), not a structural one — the function's shape (ordered threshold checks, legendary→common) already exists and just needs two more tiers spliced in.
- No call-site changes needed in the UI layer (confirmed by repo research: `rarityStyles.ts` and `page.tsx`'s `RARITY_DOT_CLASS` already define all 5 tiers cosmetically) — this is purely a grading-function change.

**Patterns to follow:**

- The existing `calculateRarity` (5-tier, price-inclusive, lines 176-191) for the ordered-threshold-check shape — `calculateSupplyRarity` should mirror its structure using only edition-based conditions.

**Test scenarios:**

- Happy path: `Covers AE1.` an edition count at the new legendary breakpoint returns `"legendary"`; similarly for the new epic breakpoint.
- Edge case: the existing 3-tier boundary values (1, 25, 26) from the current test still resolve as expected wherever they don't fall inside a new tier's range — confirms the extension doesn't silently reclassify existing behavior beyond the intended new reachable tiers.
- Edge case: `undefined` editions still returns `"common"` (preserves existing behavior).

**Verification:**

- `calculateSupplyRarity` can return all 5 `CardRarity` values for some edition-count input.
- `npm test` passes with the updated assertions; My Deck (manually checked in a running instance) shows at least one card newly displaying as epic or legendary where it previously showed rare/uncommon.

---

- U4. **Card stat derivation: Power and HP**

**Goal:** Compute a card's base Power (continuous function of edition scarcity) and base HP (rarity-tier baseline + bounded description-length modifier + floor) per R8, as pure, seed-testable functions.

**Requirements:** R8

**Dependencies:** U3 (rarity tier as HP baseline input)

**Files:**

- Create: `src/lib/battle/rules.ts` (stats live here alongside combat/progression/matchmaking math — see Key Technical Decisions for why these were consolidated)
- Create: `src/lib/battle/rules.test.ts`

**Approach:**

- Functions here take a captured `base_seed` (edition count + normalized description length, recorded once at initial progress materialization per U1/U8/U10) as input, not live `editions`/`description` values fetched fresh each call — Power/HP are derived from the seed on every read, so a later formula rebalance changes output without touching stored data, and a card's stats don't drift mid-progression just because an open-edition drop's `editions` grew.
- Power: monotonically decreasing continuous function of the seed's edition count, floored at a minimum so it never approaches zero for very high edition counts — mirrors the prototype's validated shape (`docs/brainstorms/battle-system-combat-prototype.html`'s `powerFromEditions`), not a fresh design.
- HP: `tierBaseline(rarity) * (1 + boundedModifier(descriptionLength))`, modifier capped (e.g. an asymptotic function of normalized description length) and floored at a minimum HP regardless of description absence — mirrors the prototype's `hpFromTierAndDescription`.
- **Level scaling:** a card's *effective* Power/HP used in combat is `applyLevel(baseStats, level)` — mirroring the prototype's own `applyLevel` — layered on top of the `base_seed`-derived base stats from above, not a replacement for them. `base_seed` stays fixed per card; level (from U6) is the one input that changes turn-to-turn and is what actually makes progression matter in a fight.
- Text-normalization for description length (whitespace collapsing, markup stripping) per the origin's own deferred-to-planning item — implement as a small pure helper, tested independently of the HP formula itself; this is what actually gets captured into `base_seed` the first time a card's progress row is created (Key Technical Decisions).

**Patterns to follow:**

- `docs/brainstorms/battle-system-combat-prototype.html`'s `powerFromEditions`/`hpFromTierAndDescription` functions — already simulated and validated in the origin's Simulation Findings; this unit is porting validated logic into production code, not designing it fresh.
- Seeded-PRNG test pattern from `objkt.test.ts` if any randomization is introduced (not expected for this unit — both functions are deterministic).

**Test scenarios:**

- Happy path: `Covers AE1.` a card's Power and HP are derived correctly from a given edition count and description length.
- Edge case: zero-length/missing description still produces the floor HP, not zero or undefined.
- Edge case: an extremely long description doesn't exceed the modifier cap (verifies the bound holds, not just that it trends correctly).
- Edge case: an extremely high edition count doesn't push Power below its floor.
- Integration: `Covers AE1.` two wallets computing stats from the same captured seed and level get identical Power/HP; metadata captured at different times may legitimately produce different seeds.
- Integration: `Covers the level-scaling gap a follow-up review found.` the same card's effective Power/HP at Level 5 differs from Level 1 in the direction `applyLevel` intends, confirming leveling up has a real combat effect, not just a stored number.

**Verification:**

- Stat outputs for a handful of representative edition-count/description-length pairs match the prototype's already-validated numbers for the same inputs (a direct cross-check against Simulation Findings' cited examples).

---

- U4b. **Fresh ownership verification**

**Goal:** Verify a specific wallet/card pair immediately before settlement.

**Requirements:** R2, R4. **Dependencies:** None.

**Files:** `src/lib/battle/ownership.ts`, `ownership.test.ts`.

**Approach:**

- Query the exact contract/token/wallet with positive quantity; validate upstream responses and balance values. Query OBJKT with a narrow projection and use a validated TzKT fallback. Do not reuse the full-deck helper or interpret a historical zero balance as ownership.
- Return `held` with observation time/source, `not_held`, or `unverifiable`. Enforce timeouts and bounded retries. Bypass application caches and document the accepted indexer-lag limitation.
- Reverify both sides after candidate selection, immediately before settlement. An observation older than the configured maximum age cannot authorize commit. Confirmed absence permits bounded random re-selection; exhausted upstream uncertainty produces a retriable 503, not a false no-opponent result.

**Tests:** positive and zero balances; exact contract/token disambiguation; invalid/non-2xx responses; both providers unavailable; stale observations after lock waits; sold-card re-roll versus direct-challenge rejection; no game writes on unverifiable ownership.

---

- U4c. **Authoritative metadata and complete holdings snapshots**

**Goal:** Prepare trustworthy first-use stats and a complete defender membership set without changing existing deck API behavior.

**Requirements:** R2, R5, R7-R9. **Dependencies:** U1, U1b, U4.

**Files:** create `src/lib/battle/holdings.ts`, `holdings.test.ts`; extend staging/promotion helpers in `store.ts` and their tests.

**Approach:**

- Add separate `fetchBattleTokenMetadata` and `fetchBattleHoldingsPage` helpers. Never infer failure versus emptiness from `fetchUserHoldings`, which has already discarded that distinction. Validate HTTP/GraphQL errors, metadata shape, positive ownership, token identity, and edition values. Missing supply must follow an explicit conservative rule or produce an error; do not default unknown supply to a valuable 1-of-1 seed.
- Fetch metadata from the upstream on the server, never from client-supplied card stats. Normalize description length with U4. Record the source and observation time of each prepared seed.
- Return a typed page result: validated cards plus a server-owned next cursor/checkpoint, complete empty success, or a typed unavailable/invalid response. Page past the current deck helper's 250/200 limits using a stable source-supported ordering/cursor. Document and test the selected provider's pagination consistency; an incomplete page or provider switch cannot be presented as a complete snapshot.
- Stage pages under a sync id bound to wallet, attempt, and worker generation. Deduplicate by canonical card key. A bounded work slice saves its cursor and releases the attempt for continuation; the same authenticated request can atomically claim the next generation without restarting from page one. Lease takeover resumes the durable checkpoint. Source changes/inconsistent checkpoints restart staging explicitly rather than merging incompatible partial snapshots.
- Only a fully traversed snapshot can be promoted. Promotion locks the wallet, checks its captured `holdings_generation`, inserts missing progress without overwriting seeds/XP, replaces active `wallet_holdings`, increments holdings generation, and records the refresh time. Conflicting promotions reject as stale rather than resurrecting old membership.
- Trigger refresh on explicit opt-in, on reopening the battle panel when the last completed snapshot is stale, and through an authenticated refresh action. New cards become defenders after promotion; sold cards leave active membership while permanent progress remains. A fresh ownership failure may exclude a card from the current search without deleting progress. Until refresh completes, use the last complete membership plus fresh battle-time checks.
- Use bounded pages and resumable work so a large legitimate collection does not fail forever at an arbitrary page-size cutoff. If the fixed request retry horizon is exhausted, report expiry and require a new signed refresh; do not report partial success. Opt-out never waits for a sync.

**Tests:** empty success versus outage; multiple pages including >250 cards; exact page-size multiples; failure on a later page; crash/resume from cursor; duplicate records; provider switch; stale-generation writes; overlapping promotions; sold/new/reacquired cards; and rejection of forged seed metadata. Assert partial syncs leave membership, opt-in, and existing progress unchanged.

---

- U5. **Combat resolution: simultaneous damage and overkill tiebreak**

**Goal:** Resolve a 1v1 battle via round-by-round simultaneous damage exchange, with the R14 overkill-margin tiebreak on simultaneous knockouts, as a pure, seed-testable function.

**Requirements:** R12, R13, R14

**Dependencies:** U4 (Power/HP as combat inputs)

**Files:**

- Create: `src/lib/battle/rules.ts` (combat resolution alongside stats/progression/matchmaking math — see Key Technical Decisions)
- Create: `src/lib/battle/rules.test.ts`

**Approach:**

- Port the prototype's `resolveBattleWithVariance` (already extensively seeded-tested in `docs/brainstorms/battle-system-combat-prototype.html`) as the base mechanic, adding the new overkill-margin tiebreak on top (not yet present in the prototype — this is genuinely new code, not a port, and is the one piece of this plan without prior empirical validation; see this unit's Verification).
- Tiebreak: when both sides' HP reach ≤0 in the same round, compare that round's realized damage; higher damage wins. Only an exact numeric tie in that round's damage still resolves as a true draw. **Terminology note (a follow-up review flagged the naming as ambiguous):** "overkill margin" here means *that round's total realized damage per side*, per the origin document's own established definition — not damage dealt in excess of the killing blow (a stricter reading the same phrase could also suggest). The algorithm above is the origin's intended one; only the label risked being misread.
- Accept an injectable RNG (mirroring the prototype's `mulberry32` seeding) so tests are fully deterministic.

**Execution note:** Add characterization tests porting the prototype's already-validated deterministic (±0% variance) cases first, before layering in variance and the new tiebreak — this separates "did the port preserve known-good behavior" from "does the new tiebreak do what's expected."

**Technical design:**
```
resolveBattle(attackerStats, defenderStats, variance, rng) -> { outcome, rounds, finalHpA, finalHpB, roundDamageA, roundDamageB }
  loop rounds until either HP <= 0:
    damageA = attackerPower * (1 +/- variance via rng)
    damageB = defenderPower * (1 +/- variance via rng)
    apply simultaneously
  if both <= 0:
    if roundDamageA == roundDamageB: outcome = "draw"
    else: outcome = higher-damage side
  else: outcome = surviving side
```

**Patterns to follow:**

- `docs/brainstorms/battle-system-combat-prototype.html`'s `resolveBattleWithVariance` and `mulberry32` — port directly, don't redesign; the tiebreak is the only net-new logic.

**Test scenarios:**

- Happy path: `Covers AE5.` one side's HP reaches 0 first (no tie) → **the other, surviving side wins**, no tiebreak invoked.
- Edge case: `Covers AE5.` both sides reach 0 the same round with unequal round damage → higher-damage side wins (the new tiebreak).
- Edge case: `Covers AE5.` both sides reach 0 the same round with exactly equal round damage → true draw.
- Edge case: at 0% variance with identical stat inputs, behavior matches the prototype's already-published deterministic result for that exact pairing (regression check against Simulation Findings' cited numbers).
- Integration: seeded-RNG runs at a specific seed reproduce bit-identical results across repeated calls (determinism check, mirroring the prototype's own reproducibility fix).

**Verification:**

- A batch of seeded runs at the prototype's own previously-published seeds/pairs reproduces the same win/draw/loss distribution reported in Simulation Findings, confirming the port preserved validated behavior before the new tiebreak is layered in.
- Run seeded post-tiebreak simulations as U5 acceptance: measure random-population and near-identical draw rates, new-player first-win-within-5, and stronger-card advantage against all targets in the origin. Record seed, population, constants, sample count, and results. Investigate failures before shipping; the origin's near-identical residual-draw goal is qualitative, so report the measured value rather than inventing a numeric target.

---

- U6. **XP award and leveling**

**Goal:** Award XP scaled by the defeated opponent's rarity/level, and apply level-ups (with XP carryover and multi-level jumps) per R9-R11.

**Requirements:** R9, R10, R11

**Dependencies:** U3 (rarity label for XP scaling), U5 (battle outcome as trigger)

**Files:**

- Create: `src/lib/battle/rules.ts` (progression alongside stats/combat/matchmaking math — see Key Technical Decisions)
- Create: `src/lib/battle/rules.test.ts`

**Approach:**

- XP formula scaled by defeated opponent's rarity tier and level, discouraging farming of much-weaker opponents (per origin rationale) — exact curve is a tuning question (Open Questions), structure (scales with opponent strength, decreasing marginal reward for weaker opponents) is fixed. The R20 anti-farming decay multiplier is applied to this same award, but the multiplier's *input* (the current decay-window count) is read and applied atomically inside U8's commit function, not computed here from a value fetched ahead of time — this unit exposes `decayScaledAward(baseAward, decayCount)` as a pure reference; U8 implements equivalent SQL using shared rules configuration and parity fixtures against a count of recent committed win events, so a JS pre-read can't go stale under concurrent same-pair battles.
- **XP storage model (Key Technical Decisions):** `xp` is a lifetime cumulative total, never reset on level-up; `level` is derived from it via a threshold table, not stored as an independently-incremented value. Leveling: threshold comparison in a loop (not a single check) over the cumulative total, so one award can cross multiple thresholds — there's no separate "leftover XP" bookkeeping to get wrong, since the total itself is always the single source of truth.
- Level feeds back into combat via U4's `applyLevel` — this unit is what changes `level`; U4 is what turns the new `level` into a real combat-stat effect.
- Re-acquire restoration (R9) is a read/write concern on `wallet_card_progress`, not new logic here — this unit computes what progress *should* become; U1's schema is what persists it across a sell/re-buy.

**Test scenarios:**

- Happy path: `Covers AE3.` defeating a stronger/higher-level opponent yields more XP than defeating a much weaker one.
- Edge case: `Covers AE10.` an award crossing two level thresholds derives both level-ups without reducing lifetime XP; displayed within-level XP is total XP minus the new level's cumulative threshold.
- Edge case: a draw or loss yields zero XP (confirms R10's "losing card gains no XP" and R14's draw case both route through this correctly).
- Integration: `Covers AE2.` restoring a previously-saved Level 5 progress record (simulating R9's re-acquire case) and applying a subsequent win correctly continues from Level 5, not Level 1.

**Verification:**

- A sequence of simulated wins against opponents of varying rarity/level produces a monotonically-plausible level curve with no double-counted or dropped XP across level-up boundaries.

---

- U7. **Matchmaking: candidate pool and Power×HP band search**

**Goal:** Given an attacker's card, find a same-or-similar-strength opponent from the opt-in pool using combined Power×HP proximity, honoring self-exclusion, eligibility, and the re-roll/band-widening bounds.

**Requirements:** R6, R15, R16

**Dependencies:** U4 (Power×HP as the similarity metric), U4b (ownership re-check during re-roll), U10 (complete active holdings and progress materialization)

**Files:**

- Create: `src/lib/battle/rules.ts` (the pure similarity/band-search math lives here, alongside stats/combat/progression — see Key Technical Decisions)
- Modify: `src/lib/battle/store.ts` (the candidate-pool SQL query — deliberately separated from the pure math above: this file is the only one that knows Postgres exists)
- Create/modify corresponding `*.test.ts` files for both

**Approach:**

- Candidate pool joins active `wallet_holdings`, permanent `wallet_card_progress`, and opted-in `wallets`. Use effective current-day defense counts, not stale stored counts; include recovering cards only after recovery expires. Snapshot refresh controls membership; fresh verification still guards every selected card.
- Reduce the opt-in pool (excluding the attacker's own wallet, per R6) to one candidate per wallet — whichever of that wallet's eligible (not recovering, below the effective current-day defense cap) cards has the closest Power×HP product to the attacker's, not necessarily that wallet's strongest card. Since Power/HP are now derived from `base_seed` on read rather than stored as a sortable column (Key Technical Decisions), `store.ts`'s candidate-pool query cannot filter by product proximity in SQL — it returns the full eligible, opted-in pool, and all banding, widening, and sorting by the computed Power×HP product happens afterward in `rules.ts`. Acceptable at this project's expected pool size; not a partial SQL pre-filter, so no formula duplication in SQL is needed or intended.
- Search within a band on that product, widening progressively up to a bound; fail with "No eligible opponent available" if the widest band still has no candidate.
- Re-roll cap (Key Technical Decisions): a small fixed number of ownership-verification-failure re-rolls via U4b's `ownership.ts`, independent of band-widening steps, before falling back to the same terminal failure state. Exclude confirmed `not_held` candidates from this search and recompute the best remaining card per wallet. Bound attempts on `unverifiable` results separately; if uncertainty prevents completion, return a retriable 503 rather than confirmed no-match.
- F2 (direct challenge) reuses closest-card selection for a single named wallet. The client names only the wallet. Recheck ownership before commit and opt-in/effective defense cap inside commit.

**Patterns to follow:**

- `docs/brainstorms/battle-system-combat-prototype.html`'s `bestFittingCardByStrength`/`findMatchByStrength` — the validated selection logic to port; this unit is a direct application of already-simulated matching behavior, not new design.

**Test scenarios:**

- Happy path: `Covers AE13.` a wallet holding both a Level 1 and a Level 20 card is represented by whichever has the closer Power×HP product to the attacker's, not necessarily the lower-level one.
- Happy path: `Covers AE8.` no candidate within the widest band → fails with "No eligible opponent available," no allowance consumed.
- Edge case: `Covers AE11.` the attacker's own wallet is excluded from its own candidate pool even if it would otherwise be the closest match.
- Edge case: a wallet with zero eligible cards contributes no candidate; for sales not yet reflected in the last snapshot, fresh checks exclude those cards within the bounded search.
- Edge case: `Covers AE7.` a wallet that has never opted in (or has since opted out) never appears as a candidate.
- Edge case: re-roll cap is reached (repeated stale-ownership candidates) → fails with the same "No eligible opponent available" terminal state, not an unbounded loop.
- Integration: `Covers AE6.` a matched candidate that fails fresh ownership verification triggers a re-roll to a different candidate (F1), while a directly-challenged (F2) candidate failing the same check fails the whole request instead.

**Verification:**

- A representative pool (mixed levels/tiers, some recovering, some capped, some not opted in) run through the search produces a candidate consistent with the prototype's own validated matching behavior for an equivalent input shape.

---

- U8. **Atomic battle settlement**

**Goal:** Commit each resolved battle once, using the same stat inputs that were used to match and resolve it.

**Requirements:** R2-R4, R7, R9, R17-R20. **Dependencies:** U1, U1b, U4, U4b, U4c, U5-U7.

**Files:** versioned `commit_battle` and rules-helper migrations, `store.ts`, `store.test.ts`.

**Approach:**

- Before resolution, read existing attacker progress. If absent, fetch authoritative metadata via U4c and prepare `{expected: absent, seed, xp: 0}`. If present, use the saved seed, lifetime XP, and version. Prepare the defender from saved progress. Derive level, effective stats, and outcome from these inputs using the active rules version. Client parameters identify cards; they cannot supply seed, XP, outcome, or award.
- Follow High-Level Technical Design's attempt-first, wallets-then-progress lock order in every insertion/conflict path. Create an absent attacker wallet with opt-in false and zero effective caps before its progress row. Insert its prepared seed only if absence was expected. If another materialization created the row meanwhile, reject the stale resolution and require a fresh attempt; do not substitute its different seed after combat. Require all non-absent rows to match seed and progress version. Record new provenance only when a row is first inserted.
- Check the attempt generation/lease/deadline inside the function and again after lock waits. Keep sorted acquisition separate from attacker/defender roles. Verify distinct wallets, current defender opt-in, both recovery timers, trusted ownership-observation ages, and compatible rules version.
- Capture `settlement_time` from the database wall clock after locks. For each role, use zero as the effective count when its reset time is at or before settlement time; otherwise use the stored count. Check only effective attacker attack usage and effective defender defense usage. Write the incremented relevant counts and the next midnight in UTC in the same successful settlement. Matchmaking and status must use the identical effective-count rule without requiring a write to reset old counters.
- For a decisive outcome, count committed log events for the ordered winner/loser pair in `(settlement_time - decay_window, settlement_time]`. Both wallet locks serialize this read and the next event across different cards and reversed battle roles. Use READ COMMITTED and a VOLATILE function with a separate count query after wallet locks are obtained, so a settlement that waited for a previous commit sees that commit's win event. A first win sees count zero; expired wins leave individually; an opposite winner/loser direction has its own count. Draws create no win event and receive no decay award. No fixed `window_start` or ever-increasing counter is needed. See [PostgreSQL function snapshot visibility](https://www.postgresql.org/docs/current/xfunc-volatility.html).
- Apply the decay multiplier in SQL, round once according to shared rules fixtures, and add the resulting award to lifetime XP. Derive resulting level for the response; do not store it independently. Set recovery only on the losing card, based on its battle role, and increment both progress versions even on a draw.
- Persist audit inputs, versions, RNG seed, outcome, award, and resulting state with cap/progress changes and the terminal attempt response. The audit event is unique per battle attempt. Retries return that response byte-for-byte.
- Put game writes in the nested exception block described above. An expected rejection rolls back those writes, records a terminal failed response for the current attempt, and returns normally. Unexpected SQL errors abort the invocation; a conditional failure callback or lease takeover handles recovery. Never re-raise and claim the handler's status update survives.

**Tests / verification (real Postgres):**

- Win, loss, draw, multi-level XP award, and defensive/offensive recovery; assert complete write sets and both version increments.
- Rejection after initialization or another game write leaves all game tables unchanged while preserving the attempt's failed response. Unexpected errors roll back handler writes too and remain recoverable through the lease.
- Concurrent same-card requests; two-wallet reversed roles; three-wallet cycles; first-use insert races; opt-in/materialization overlapping battle commit; and old worker completion after takeover. Assert exactly-once effects and bounded error recovery.
- An attacker who never opted in initializes both rows and battles without becoming a defender. Concurrent first-use seed creation rejects stale provisional stats.
- Yesterday's exhausted attacker and defender are eligible at UTC midnight in candidate search, status, and settlement; exact equality at the boundary resets correctly; unrelated cap usage cannot block the other role.
- Pair wins just inside/outside the rolling boundary, first win, opposite direction, concurrent wins using different cards, and draws; assert the precise decay-scaled XP and one event per committed outcome.
- A timeout after successful commit returns the original result on retry, including after nonce freshness expiry. A stale generation cannot mutate game state or replace a newer response.

---

- U9. **Random battle and direct-challenge routes**

**Goal:** Wire authentication, authoritative preparation, matchmaking, combat, and settlement.

**Requirements:** R1-R6, R15-R16, R19; F1/F2. **Dependencies:** U2, U4b, U4c, U7, U8.

**Files:** create `random/route.ts`, `challenge/route.ts`, and their route tests.

**Approach:**

- Both mutation routes are POST-only. Validate bounded JSON and use U2's verify, lookup, and claim order. Canonical action parameters: random `[attackerCardKey]`; challenge `[attackerCardKey, defenderWallet]`. The server selects the defender card, so no client-supplied defenderCardKey participates in the contract.
- After authentication, enforce an atomic per-wallet request budget independently of battle caps, before upstream calls or expensive candidate queries. The small database operation implementing the rate limit is allowed; do not promise a persistent limiter can run before any database work. Cover claim/verification and U10's mutation/read workloads with suitable bounds as well.
- Prepare authoritative attacker stats before searching. Exclude ineligible wallets using effective current-day defense counts and active membership. Reverify both selected cards immediately before commit. Renew leases during bounded work; stop on lost ownership of the attempt.
- Confirmed no opponent is a completed zero-cost result recorded with `complete_no_match`, fenced by generation. Confirmed ineligibility is a terminal error. Upstream uncertainty is a retryable 503; it never turns into a false no-match result after re-roll exhaustion. All pre-commit outcomes use conditional attempt transitions.
- Use explicit timeouts, bounded upstream retries/backoff, search/re-roll budgets, and database statement timeouts. Keep per-request work bounded even if failed searches spend no battle allowance.
- Match existing structured JSON error/logging conventions, but use stable error codes to distinguish auth failure, live attempt, stale resolution, cap reached, upstream failure, and unavailable database. Leave Node runtime unset; use no-store responses and choose `maxDuration` based on measured work budgets.

**Tests / verification:** signed happy paths for both flows; missing/forged signatures; self challenge; current non-ownership/recovery/opt-out; upstream uncertainty; no-match replay; bounded retry exhaustion; rate limits before expensive work; crash/resume; and stored-result retrieval after expiry. Run typecheck, lint, tests, and build once implementation lands, including the existing route regressions.

---

- U10. **Participation, holdings refresh, and status routes**

**Goal:** Let wallets control defense participation, synchronize eligible holdings, and read progress without weakening request authentication or atomicity.

**Requirements:** R5, R7, R9, R18-R19. **Dependencies:** U1, U1b, U2, U4, U4c.

**Files:** create opt-in, refresh, and status routes/tests; add `commit_participation` and snapshot-promotion migrations plus `store.ts` helpers/tests.

**Approach:**

- Participation is POST with `{ optedIn: boolean }`. Sign the exact `[optedIn]` parameter array under its own action name; reject omitted/non-boolean/extra fields. This is a desired state, never a toggle. A signature for true must fail for false and vice versa.
- After verifying and claiming the attempt, desired true obtains a complete staged holdings snapshot through U4c. Bounded continuation returns an in-progress response and durably releases work for the next generation. Active opt-in/membership do not change until completion. Desired false skips all upstream calls and goes directly to commit.
- `commit_participation` locks/checks the current attempt generation, then locks the wallet before progress rows. For true, atomically promote the complete snapshot, insert only missing progress, set `opted_in=true`, and record the original response. For false, set `opted_in=false`, increment holdings generation to invalidate older in-flight snapshots, and complete the response in the same invocation. Preserve all XP/seeds/recovery. A first-ever false request may create the default opted-out wallet record.
- Concurrent opt-out invalidates a previously started opt-in/refresh snapshot: promotion checks the captured holdings generation and returns a stale-sync rejection. Retrying an old completed opt-in only returns its historical response and cannot re-enable a subsequently opted-out wallet.
- A separate POST refresh action signs `[]` because it has no desired-state parameter and cannot alter opt-in. It refreshes active membership using complete snapshot promotion, its own attempt generation, and wallet holdings-generation checks. Reopening a stale battle panel offers this signed refresh; no automatic unauthenticated write is hidden in a GET status request.
- GET status returns current opt-in, effective current-day cap usage and next reset, per-card lifetime XP/derived level/Power/HP, recovery reason/time, and last completed holdings refresh time. No-store; apply read budgets. Public wallet game status can be read without a write signature; internal attempt signatures, leases, and worker tokens are never returned there.
- Both write actions use the same terminal-response, retry-horizon, and exception handling contracts as U8. No rule restricts completing attempts to `commit_battle`: participation, refresh, no-match, and pre-commit failure have their own fenced helpers.

**Tests / verification:**

- Flipping the signed boolean or action fails verification. Simultaneous identical opt-in/out requests change state once; completed replay after signature expiry returns the old response without reapplying state.
- Complete opt-in exposes the correct eligible-card count, including collections larger than one page; empty success differs from outage. Partial/failed fetches never change participation or membership.
- Re-opt-in and reacquisition preserve existing XP, seed, version, and recovery. New holdings arrive via refresh; sales remove membership but preserve progress. Stale promotions cannot undo a newer opt-out.
- Kill a worker mid-sync; resume its checkpoint after lease takeover. A stale worker cannot stage or promote after takeover. Verify both desired-state update and attempt completion roll back together on failure.
- Status displays zero effective cap usage after UTC reset without requiring a battle or reset job, exposes derived progression, and remains distinct from an unavailable database response.

---

- U11. **My Deck battle UI**

**Goal:** Let a connected wallet see its battle-eligible cards, opt in/out, initiate a random or targeted battle, and see the result — the client surface for F1/F2/F3/F4.

**Requirements:** Success Criteria ("pick a held card, fight... see a clear win/lose/draw outcome")

**Dependencies:** U9, U10

**Files:**

- Create: `src/components/BattlePanel.tsx`
- Create: `src/components/BattlePanel.test.tsx`
- Modify: `src/components/DeckGrid.tsx` (surface eligible/recovering state per card, entry point into `BattlePanel`)

**Approach:**

- Reuse `WalletContext`'s new `signChallenge` (U2) for the auth step; no new wallet-connection logic needed. Battle initiation shows an explicit "awaiting wallet signature" state while the Beacon popup is open, and a distinct "signature declined" state if the user cancels/rejects it — both occur before any request reaches U9's routes, and neither should read as the app silently hanging or failing. The waiting state offers its own in-app cancel action (distinct from closing the Beacon popup) and auto-transitions to an "expired, try again" state if the nonce's freshness window elapses before the popup is resolved, rather than waiting indefinitely.
- F2 (direct challenge) lets the player enter or select a target wallet address; client-side pre-submission validation is limited to self-targeting (checkable locally, since it's just the connected wallet's own address) — whether the target is opted in is **not** pre-checked client-side, since `status` is scoped to the connected wallet's own game state and this plan does not add a cross-wallet status-lookup surface (a deliberate scope boundary, not an oversight — avoids introducing new cross-wallet observability beyond what this feature already needs). An invalid target (not opted in, over its defense cap) is instead surfaced as a clear, specific inline error from the server's existing rejection, not a generic failure.
- Recovery/cap state (from U10's status route, including `recovery_reason`) renders per-card, consistent with existing `DeckGrid` patterns for showing card metadata, with brief explanatory copy distinguishing the two reasons (e.g. "recovering from a defensive loss — shorter cooldown" vs. "recovering from an offensive loss") rather than a raw enum label. A wallet at its daily attack or defense cap sees a distinct "daily limit reached, resets at [time]" state rather than a generic error.
- `BattlePanel`/`DeckGrid` render a distinct "battles temporarily unavailable" state when status cannot be fetched, leaving browsing and existing features usable.
- The transient/async states this unit introduces (awaiting-signature, declined, limit-reached, battles-unavailable) are announced via an `aria-live="polite"` region as they change, so a screen-reader user gets the same state transitions a sighted user sees rather than silence during a focus-stealing external wallet popup.
- The panel distinguishes an in-flight attempt from failure, retains the signed request for bounded retries and lost-response retrieval, and shows holdings-sync progress, refresh age, and expiry requiring a new signature. Ignore responses for a wallet that has since disconnected or switched.
- Result display shows win/lose/draw plus any level-up, per Success Criteria's "clear win/lose/draw outcome with resulting XP/level changes reflected immediately" — a win decided by the R14 overkill tiebreak is labeled distinctly (e.g. "won by margin") rather than as an ordinary win, since the winning card also reached 0 HP that round.

**Test scenarios:**

- Happy path: initiating a battle from an eligible card shows a result and reflects updated Level/XP in the deck view afterward.
- Happy path: `Covers the F2 UI gap a follow-up review found.` initiating a direct challenge against a named, opted-in wallet shows the target-selection step, validates the target before submission, and shows a result.
- Edge case: a recovering card is visibly non-selectable, not just server-rejected, and shows its `recovery_reason` (offensive vs. defensive) alongside the countdown.
- Edge case: opt-in/opt-out toggle reflects immediately in the UI without a page reload.
- Edge case: a wallet at its daily attack or defense cap sees the distinct "limit reached" state, not a raw server error.
- Edge case: a win decided by the overkill tiebreak is visibly distinguished from an ordinary win.
- Edge case: `Covers Scope Boundaries (abstracted accounts).` a connected wallet with no `AccountInfo.publicKey` sees "wallet type not supported for battles" instead of a failed signing attempt.
- Edge case: the wallet-signing popup shows an explicit waiting state, and a declined/cancelled signature is shown distinctly from a server-side rejection.
- Error path: a failed matchmaking search ("No eligible opponent available") is shown clearly, not as a generic error.
- Error path: `Covers the degraded-mode gap System-Wide Impact flagged.` a simulated Neon outage (failed status fetch) shows the "battles temporarily unavailable" state, while the rest of the page (deck browsing, packs, wishlist) remains fully functional.

**Verification:**

- Manually exercised in a running dev instance: opt in, trigger a random battle, trigger a direct challenge, see results, confirm the deck view reflects any XP/level change, and confirm a simulated status-fetch failure shows the degraded-mode state without breaking the rest of the page — per this project's stated expectation that UI changes be verified in-browser, not just via tests.

---

## System-Wide Impact

- New persistent state is confined to battle tables and functions. Existing `/api/deck` and `/api/random-pack` contracts remain unchanged. The shared five-tier `calculateSupplyRarity` update is the intentional visible change outside battles; pack-opening `calculateRarity` remains separate.
- Failed pre-commit work consumes request-processing budget, never battle caps, XP, or recovery. Successful game mutations and their audit/result records commit together. Transient infrastructure failure can leave an attempt pending, which is recoverable through its bounded lease and generation contract.
- Fresh upstream ownership is a correctness input with a documented observation-age bound and indexer race. Full holdings synchronization is separate from fresh battle-time verification and preserves progress for absent cards.
- Neon outages disable battles while deck browsing, packs, and wishlist continue working. U11 renders a specific unavailable state. Rate limiting and bounded work reduce load; free-tier suspension remains an accepted availability trade-off.
- Cleanup is bounded and respects attempt retention, retry deadlines, live staging leases, and rolling-decay lookback. Removing an expired attempt must not make its old signed envelope usable as a fresh action. The battle log remains the audit source for progression and decay.
- Rules changes require versioned SQL/TypeScript agreement. U4/U6 derive stats and levels from stable saved inputs; U8 records rules versions and validates compatibility so an in-flight request cannot mix old combat rules with new settlement rules.

---

## Risks & Dependencies

| Risk | Mitigation / required evidence |
|------|--------------------------------|
| Neon integration billing or free-tier terms change | Reverify resource billing controls immediately before provisioning; preserve the no-payment-method requirement. |
| Free-tier exhaustion interrupts battles | Accepted availability limit; explicit degraded UI, request budgets, bounded sync/search work. |
| Novel database functions and attempt recovery | Prove U1b and U8 with real Postgres fault injection and concurrency tests before integrating the UI. |
| Worker crash, lost response, or delayed original worker | Expiring leases, generation fencing, atomic terminal responses, and authenticated retrieval after nonce expiry. |
| Lock-order inversions during materialization | Apply the same attempt → sorted wallets → sorted progress order to every writer and insert/conflict path; test mixed operations. |
| Upstream outage, pagination drift, or incomplete large collection | Typed page results, durable cursors/checkpoints, complete-only promotion, and fresh per-battle ownership checks. |
| Tiebreak performance does not meet the origin's proposed targets | U5 includes seeded empirical validation before shipping; record results and any tuning decisions. |
| Deployments disagree on XP/decay formulas | Version SQL rules and TypeScript fixtures together; reject mismatched in-flight settlements. |

---

## Documentation / Operational Notes

- Once this feature stabilizes, capture it via `/ce-compound` — this is the first feature in the repo establishing persistence, wallet-signature auth, and atomic/idempotent writes, none of which had any `docs/solutions/` precedent (confirmed absent). The next feature touching any of these three should not start from zero.
- README's rarity-system section (lines 17-35) needs a copy update alongside U3, per the origin's own Dependencies note.
- No CONTRIBUTING.md/PR template exists to align with beyond observed Conventional-Commit-style branch/PR naming (`feat/...`) — nothing further to add here.

---

## Open Questions

### Resolved During Planning

The final constraints are recorded once in Key Technical Decisions, with executable-work contracts in U1b (attempts), U2 (signatures and expiry), U4c (holdings), U8 (settlement), and U10 (participation). Daily caps use effective UTC-day counts; decay uses timestamped rolling-window win events. Expected failures return normally after nested rollback; unexpected failures recover through leases. No additional auth mechanism or database provider decision is pending.

### Deferred to Implementation

- Game tuning: edition thresholds, Power/HP constants, cumulative XP thresholds, level scaling, recovery durations, daily caps, match bands/re-roll budgets, decay window and multiplier curve. Choose values and validate in U5; SQL/TypeScript parity is required.
- Operational tuning: validate U1b's initial nonce/lease/retry/retention values against wallet signing and actual upstream latency. Choose request limits, bounded page/work sizes, refresh staleness interval, observation-age limit, clock-skew allowance, statement timeout, and route `maxDuration`. These values cannot remove the specified expiry, fencing, complete-snapshot, or bounded-work guarantees.
- Migration tooling and cleanup execution mechanism. SQL functions and configuration are versioned migrations. Attempt retention is at least 30 days and the retry horizon; audit retention must cover the decay window. Select a durable audit-retention policy before production cleanup is enabled.
- Verify and implement provider-specific pagination/checkpoint semantics in U4c. If consistent traversal cannot be completed, report an incomplete/unavailable sync and preserve the last complete state; never silently claim that a partial set is the entire deck.

---

## Sources & References

- **Origin document:** [docs/brainstorms/battle-system-requirements.md](../brainstorms/battle-system-requirements.md)
- **Combat/matchmaking prototype (validated simulation source):** [docs/brainstorms/battle-system-combat-prototype.html](../brainstorms/battle-system-combat-prototype.html)
- Related code: `src/lib/objkt.ts`, `src/app/api/deck/route.ts`, `src/app/api/random-pack/route.ts`, `src/context/WalletContext.tsx`
- Database semantics: [PostgreSQL exception blocks and rollback](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING), [PostgreSQL function volatility and snapshot visibility](https://www.postgresql.org/docs/current/xfunc-volatility.html).
- External docs: [Vercel Spend Management](https://vercel.com/docs/spend-management), [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel Marketplace Storage](https://vercel.com/docs/marketplace-storage), [Neon Vercel-Managed Integration](https://neon.com/docs/guides/vercel-managed-integration), [Neon free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas), [Beacon Sign Payload guide](https://docs.walletbeacon.io/guides/sign-payload/), [Taquito signing docs](https://taquito.io/docs/next/signing/), [Vercel Functions maxDuration](https://vercel.com/docs/functions/configuring-functions/duration)
