---
date: 2026-09-06
topic: battle-system
---

# Battle System

## Problem Frame

TzDeck currently treats OBJKT cards as static collectibles: pull them from packs, view them in My Deck, optionally wishlist them. Once a card is collected there's no ongoing reason to revisit it, and no feature makes use of the real market data (price, edition size, rarity) beyond the one-time grading label already shown on the About page.

The site is explicitly inspired by [wikigacha.com](https://wikigacha.com), which layers an automated battle system on top of its card data (ATK from page views, DEF from article length, both multiplied by rarity) to give collected cards an ongoing purpose. This brainstorm defines an analogous system for TzDeck: a wallet's held OBJKTs gain Level/Power/HP through PvP battles against other connected wallets' cards, turning static rarity data into a persistent strategy meta-game — without compromising the site's stated "purely a discovery layer" positioning (no wagering, no effect on real OBJKT ownership or listed price).

---

## Actors

- A1. Attacker: the connected wallet initiating a battle — selects an eligible card from My Deck, proves control of that wallet via a signed challenge, and starts a battle via random matchmaking or by challenging a specific wallet.
- A2. Defender: a wallet that has explicitly opted into the battle pool — one of its eligible cards, whichever best fits the searching attacker's power range, is battled against, regardless of whether that wallet is online at the time (see Key Decisions). Wallets that have never opted in, or that have since opted out, cannot be matched or directly challenged. A wallet's own address is never eligible to defend against its own attack.
- A3. Server: the battle authority — verifies the attacker's signed session, verifies both cards' current on-chain ownership, runs the damage-exchange simulation, and persists XP, level, and recovery state atomically for both cards.

---

## Key Flows

- F1. Random Battle
  - **Trigger:** Attacker selects an eligible (not-recovering) card from My Deck and starts a random battle.
  - **Actors:** A1, A2, A3
  - **Steps:** Attacker picks a card and authenticates the request via a signed challenge → server verifies the attacker currently holds that card → server reduces the opt-in battle pool (excluding the attacker's own wallet, and excluding wallets/cards that are recovering or over their defense cap) to one candidate per wallet — whichever of that wallet's eligible cards best fits the attacker's card's power range, not necessarily that wallet's strongest card — then selects among wallets with a fitting candidate within the current strength band, progressively widening the band up to a bound → if no candidate is found even at the widest band, the search fails with "No eligible opponent available" and consumes no battle allowance (though the search itself still costs server/database work — see Dependencies) → otherwise, server re-verifies the defender's card is still held by that wallet, re-rolling a different opponent if not → server runs the damage-exchange simulation using both cards' current Power/HP → server persists the result atomically: winner's card gains XP scaled by the loser's rarity/level and may level up, loser's card enters recovery, or — on mutual knockout — neither side gains XP nor enters recovery → result shown to the attacker.
  - **Outcome:** Battle outcome and any level-up are recorded against both wallets; the losing card (if any) is temporarily ineligible for further battles. A failed search costs the attacker no battle allowance.
  - **Covered by:** R2, R3, R4, R5, R6, R10, R13, R14, R15, R17, R18, R20

- F2. Challenge a Specific Wallet
  - **Trigger:** Attacker targets a specific opponent wallet address instead of random matchmaking.
  - **Actors:** A1, A2, A3
  - **Steps:** Attacker enters or selects an opponent wallet, which must differ from the attacker's own wallet → server rejects the challenge outright if that wallet hasn't opted into the battle pool (or has since opted out) or is currently over its defense cap → otherwise selects whichever of that wallet's eligible cards best fits the attacker's card's power range → server verifies both cards' current ownership, failing the challenge with a clear error if the target's card can't be verified (no re-roll, since the wallet was specifically named) → same resolution as F1.
  - **Outcome:** Same as F1, opponent-specific, or a rejected challenge if the target hasn't opted in (or has opted out), is over its defense cap, or its card fails verification.
  - **Covered by:** R2, R3, R4, R5, R6, R10, R13, R14, R16, R17, R18, R20

- F3. Card Levels Up
  - **Trigger:** A card accumulates enough XP from a win.
  - **Actors:** A3
  - **Steps:** Server totals XP after a win → compares against the level threshold(s) → increments Level once per threshold crossed (a single award can trigger more than one level-up), carrying leftover XP forward rather than discarding it → recalculates Power/HP at the new level → persists the new stats against that wallet+card pair.
  - **Outcome:** The card's battle stats are permanently higher for that wallet in all future battles.
  - **Covered by:** R10, R11

- F4. Card Recovers After Defeat
  - **Trigger:** A card loses a battle (not a draw).
  - **Actors:** A3
  - **Steps:** Server marks the card's wallet-scoped record with a recovery-until timestamp, using the shorter defensive-loss duration if the card was defending rather than attacking → any attempt to select or match that card before the timestamp elapses is rejected → once elapsed, the card is eligible again at its current level/stats.
  - **Outcome:** Temporarily narrows which cards a wallet can field, without affecting XP/level already earned.
  - **Covered by:** R3, R17

```mermaid
flowchart LR
    A["Ready at current level\n(new card starts Level 1)"] -->|battles| B{Round-by-round\nsimultaneous damage}
    B -->|Win| C["XP awarded\n(scaled by loser's rarity/level)"]
    C --> D{XP >= threshold?}
    D -->|Yes| E["Level up\nPower/HP increase"]
    D -->|No| A
    E --> A
    B -->|Lose| F["Recovery period\ncard ineligible"]
    F -->|elapsed| A
    B -->|Mutual knockout| G["Draw: no XP,\nno recovery"]
    G --> A
```

---

## Requirements

**Identity & authentication**
- R1. Initiating a battle requires a signed, server-verified proof of wallet control (a challenge signed via Beacon), not merely a connected client-side wallet session — the server currently has no way to confirm a submitted address is genuinely who it claims to be, since existing endpoints only ever serve public read data.

**Eligibility & deck**
- R2. Only NFTs currently held by the connected wallet (as already surfaced in My Deck) may be selected for battle.
- R3. A card in its recovery period (R17) cannot be selected to initiate a battle, nor matched as a defender.
- R4. Both the attacker's and the defender's card ownership are verified at battle time against current on-chain state, not solely against the cached response from `/api/deck` (which can be up to ~65 minutes stale under its `stale-while-revalidate` policy). A card that fails fresh verification is treated as ineligible, never resolved as a win.
- R5. A wallet only becomes eligible to be matched or directly challenged as a defender after explicitly opting into the battle pool, with a clear disclosure that opting in means its cards can be battled — and can earn XP, level up, or enter recovery — while the wallet is offline. Attacking never requires opting in; only being battled does. A wallet may opt out at any time: opting out stops it from being selected for any new defensive match, preserves all previously earned progress, and does not undo a battle that already resolved.
- R6. An attacker's own wallet is never eligible to be selected as its own defender, for either random matchmaking (R14) or direct challenge (R15).

**Stats & progression**
- R7. Progress (Level, Power, HP, XP) is tracked per wallet+card pair, not per token — required because OBJKT editions let multiple wallets hold the same `token_id` simultaneously (verified via `getCardKey` in `src/lib/objkt.ts`, which keys on `contract_address:token_id`).
- R8. A card not yet leveled by its current holding wallet starts at Level 1. Its base Power derives from a continuous function of edition scarcity (fewer editions → higher Power, not a flat per-tier value). Its base HP is its rarity tier's baseline plus a bounded, diminishing-returns modifier from its (length-normalized, not raw-character-count) description, capped, so description contributes modest variation rather than dominating survivability, with a guaranteed minimum HP regardless of description length or absence — this guards against a creator inflating a token's battle stats by simply writing an artificially long description, unlike Wikipedia's collaboratively-maintained article length that WikiGacha's DEF mirrors. Both signals are already-fetched per-token data (`editions`, `description` in `normalizeObjktToken`, `src/lib/objkt.ts:226-259`). `calculateSupplyRarity` (`src/lib/objkt.ts:193`) is separately extended to a full five-tier, edition-only scale and continues to serve as the categorical rarity label (used for XP-scaling in R10 and for My Deck's displayed badges/dots, which will also begin reaching epic/legendary for all wallet holdings) — but rarity tier is no longer the sole determinant of a card's exact Power/HP within that tier. Two different wallets each leveling a copy of the same edition-token to the same level will still have identical stats against each other, since base stats derive from token metadata, not the holding wallet. Pack-opening grading (`calculateRarity`/`RARITY_LEGEND`, which also uses price) remains untouched and separate.
- R9. If a wallet re-acquires a card it previously leveled up (having sold or otherwise lost it in between), its prior saved progress for that card is restored rather than restarting at Level 1.
- R10. Winning a battle awards the winning card XP scaled by the defeated card's rarity and level — defeating a stronger or higher-level opponent pays out more, defeating a much weaker one pays little, to discourage farming. The losing card gains no XP. A draw (R14) awards no XP to either side.
- R11. Sufficient accumulated XP levels up a card: excess XP beyond a level's threshold carries forward rather than being discarded, a single XP award can trigger more than one level-up if it crosses multiple thresholds, and Power/HP are recalculated at each level gained.

**Combat resolution**
- R12. A battle is 1v1 — one attacker-selected card against one defender card.
- R13. A battle resolves as an automated, simultaneous-damage exchange: each round, both sides' Power is applied as damage to the opponent's HP at the same time, until at least one side's HP reaches zero. No manual player input mid-battle. HP resets to each card's current max at the start of every battle — damage never carries over between battles. This mechanic does not guarantee draws are rare: simultaneous fixed damage ties whenever both sides' rounds-to-kill happen to match, which can occur between unequal stat pairs (not just identical ones) — see Outstanding Questions.
- R14. If both sides' HP reach zero in the same round, the battle is a draw: neither card gains XP, and neither enters recovery.
- R15. Random matchmaking: the attacker's card is matched against a candidate pool reduced to one eligible card per opted-in wallet (excluding the attacker's own wallet, R6) — whichever of that wallet's eligible cards best fits the attacker's card's power range, not necessarily that wallet's highest-level card — biased toward a similar power range (a strength band) with progressive, bounded widening when no match is found. If no candidate exists even at the widest band, the search fails with "No eligible opponent available" and consumes no battle allowance.
- R16. Direct challenge: the attacker may instead target a specific opponent wallet (which must differ from their own, R6); the server selects whichever of that wallet's eligible cards best fits the attacker's card's power range, rejecting the challenge if the target hasn't opted into the battle pool (R5) or is currently over its defense cap (R18).

**Pacing & integrity**
- R17. A card that loses a battle enters a recovery period during which it is ineligible (R3); other cards in the same wallet's deck remain usable in the meantime. A draw does not trigger recovery (R14). A card that loses while defending (an unsolicited match its owner didn't initiate) gets a shorter recovery period than a card that loses while attacking — softening the downtime cost of a loss the owner didn't choose to risk.
- R18. Each wallet is subject to two independent daily caps — an attack cap (battles it initiates) and a defense cap (battles where it is selected as defender) — tracked separately so that other players battling a wallet cannot exhaust that wallet's own ability to initiate battles. A wallet over its defense cap is not eligible to be selected as a defender (R15, R16) until that cap resets.
- R19. Each battle's result — XP award or draw, level-up, recovery, and cap usage — commits atomically as a single unit. A retried or duplicate request for the same battle attempt returns the original result rather than resolving twice, and concurrent requests cannot both claim the same card as available.
- R20. Repeatedly winning against the same opponent is throttled at the wallet-pair level: diminishing XP applies to repeated wins by one wallet against another wallet within a rolling window, aggregated across whichever cards either side fields and regardless of who initiated, resetting after enough time has passed. This bounds both a popular defender being farmed by many attackers and a self-controlled second wallet being used as a free-XP punching bag; it does not fully prevent farming via additional, unrelated wallets.

---

## Acceptance Examples

- AE1. **Covers R8, R9.** Given Wallet A has never held or leveled Card X, when Wallet A acquires Card X and battles with it for the first time, Card X starts at Level 1 with Power/HP derived from its own edition count and (bounded) description length — even if a different wallet previously leveled that same `token_id`.
- AE2. **Covers R9.** Given Wallet A leveled Card X to Level 5, then sold it, and later re-acquired the same Card X, when Wallet A battles with Card X again, its progress resumes at Level 5, not Level 1.
- AE3. **Covers R10.** Given a Level 1 Common card defeats a Level 10 Legendary card, the winner receives a large XP award; given a Level 10 Legendary card defeats a Level 1 Common card, the winner receives a small XP award.
- AE4. **Covers R3, R17.** Given Card X lost its most recent battle and its recovery period has not elapsed, when its owner attempts to select Card X for a new battle, the request is rejected; other eligible cards in the same wallet's deck remain selectable.
- AE5. **Covers R13, R14, R18.** Given both cards' HP reach zero in the same round, neither side gains XP nor enters recovery, and both cards remain eligible for another battle, subject to their wallets' daily caps.
- AE6. **Covers R4, R15.** Given a matched defender's card was sold to another wallet since the cache from `/api/deck` last refreshed, when the server re-verifies ownership at battle time, and it fails, the battle does not resolve as a win for the attacker — random matchmaking re-rolls a different opponent automatically (F1); a direct challenge instead fails with a clear error naming the reason (F2).
- AE7. **Covers R5.** Given a wallet has never opted into the battle pool, when another wallet tries to directly challenge it or matchmaking considers it as a candidate, that wallet is excluded from the pool and cannot be battled until it opts in.
- AE8. **Covers R15.** Given every other opted-in wallet's eligible cards are either recovering or over their defense cap, when an attacker starts random matchmaking, the search widens to its bound and then fails with "No eligible opponent available," consuming none of the attacker's daily allowance.
- AE9. **Covers R18.** Given Wallet A's daily defense cap is already reached purely from being battled by others, when Wallet A itself tries to initiate an attack, the attempt succeeds provided the selected card isn't recovering and Wallet A's own attack allowance remains — attack and defense allowances are tracked separately.
- AE10. **Covers R11.** Given a card is one XP short of its next level threshold, when it wins a battle that awards enough XP to cross two thresholds at once, the card gains both levels from that single award, with only the XP beyond the second threshold carried into its new total.
- AE11. **Covers R6.** Given Wallet A holds more than one eligible card, when Wallet A attempts to battle one of its own cards against another of its own cards (via direct challenge or by somehow matching into itself), the request is rejected.
- AE12. **Covers R5.** Given Wallet A previously opted into the battle pool and later opts out, when another wallet tries to challenge or match against Wallet A afterward, Wallet A is excluded from the pool, while its previously earned Level/XP for its cards remains unchanged.
- AE13. **Covers R15.** Given Wallet B holds both a Level 1 card and a Level 20 card, when a Level 1 attacker starts random matchmaking, Wallet B's Level 1 card — not its Level 20 card — is the candidate considered for that match.

---

## Success Criteria

- Connected-wallet users can pick a held card, fight another wallet's card (random or targeted), and see a clear win/lose/draw outcome with resulting XP/level changes reflected immediately in their deck.
- Card power growth is driven by battle activity and matchup outcomes (a per-card scarcity/content-derived seed + play), not solely by the underlying NFT's listed price — a wallet cannot dominate purely by owning the most expensive card, nor by writing an artificially long description.
- A new or common-tier card has a realistic path to earning its first win and first level-up, not just cards that already outrank same-tier opponents. Draw rate and this first-win accessibility are not assumed from the stat design alone — they must be validated by simulating representative matchups before committing to exact Power/HP/damage formulas, since distinct per-card stats reduce (but do not eliminate) draws: simultaneous fixed-damage combat still ties whenever both sides' rounds-to-kill happen to match, which happens between unequal stat pairs too, not only identical ones.
- No battle can be attributed to a wallet that didn't actually authorize it, no wallet is battled without having opted in, no wallet ever battles itself, and no battle can be resolved, retried, or double-counted in a way that awards XP, recovery, or cap usage more than once.
- A downstream planner can implement this without inventing eligibility rules, progression shape, matchmaking behavior, combat resolution, or persistence scope — those are fixed above; only exact numeric tuning (thresholds, recovery duration, per-round damage formula) is left open, and it's explicitly deferred below.

---

## Scope Boundaries

### Deferred for later

- Team battles (multiple cards per side, e.g. 5v5 as in WikiGacha) — this version is 1v1 only.
- PvE modes (raid bosses, solo challenges against system-generated opponents).
- Leaderboard or ranking UI beyond what's needed to support challenging a specific wallet.
- Cosmetic or reward systems beyond a card's own Level/Power/HP (titles, currency, badges).
- Letting a wallet mark a specific card as its "active defender" rather than always defending with whichever card best fits the attacker.

### Outside this product's identity

- Any mechanic where battling affects real OBJKT ownership, listing price, or requires spending Tezos/XTZ to participate. TzDeck's About page states it is "purely a discovery layer," with all acquisitions happening on OBJKT — the battle system must stay a simulated meta-game layered on top of real collection data, never a marketplace or wagering mechanic itself.
- Manual or skill-based combat input. This is scoped as fully automated, consistent with the WikiGacha inspiration; a live-action or turn-by-turn player-controlled system is a different, larger product bet (considered and rejected as "Approach C" during this brainstorm).

---

## Key Decisions

- **Wallet-bound, not token-bound, progression** — Rationale: OBJKT editions let multiple wallets hold the same `token_id`; token-bound progress would be shared and ambiguous across co-owners.
- **Progression-based power (Level/XP) rather than raw price/edition-derived power** — Rationale: keeps the strategy meta-game from collapsing into "richest wallet always wins," which would conflict with the site's discovery-layer, non-wagering positioning. Rarity still sets each card's *starting* line, but ongoing power comes from play.
- **1v1 single-card combat** rather than team battles — Rationale: smaller scope for a first version; team battles are explicitly deferred.
- **Recovery-on-defeat as the primary pacing mechanism** (not a flat cooldown regardless of outcome) — Rationale: explicit user preference; keeps winning cards available while naturally rate-limiting overall battle volume.
- **Matchmaking reduces the pool to one candidate per opted-in wallet — whichever of that wallet's eligible cards best fits the attacker, not necessarily that wallet's strongest card — with bounded progressive widening and a "no opponent available" failure state that costs nothing** — Rationale: always representing a wallet by its single highest-level card would let a veteran's low-level cards sit permanently unreachable behind their strongest one, starving beginners of suitable opponents as the community matures. Selecting the best-fitting card per wallet instead keeps genuinely matched opponents available regardless of who else that wallet has leveled up.
- **Defender participation requires explicit opt-in, with clear disclosure that offline defense can earn XP, level up, or trigger recovery; a wallet may opt out at any time without losing progress** — Rationale: without opt-in, any wallet with holdings could be battled without ever having agreed to participate, which conflicts with the site's "authorized" framing in Success Criteria.
- **A wallet can never be matched or challenged against itself** — Rationale: prevents trivial self-farmed XP and isn't genuine competition.
- **Attack and defense daily caps are tracked independently** rather than one shared cap — Rationale: a shared cap let other players exhaust a wallet's own ability to initiate battles simply by repeatedly challenging it; separate caps preserve a popular defender's exposure limit without letting anyone else control someone else's ability to play.
- **Combat is simultaneous-damage with full HP reset per battle and mutual knockout = draw** (assumption made to unblock planning) — Rationale: simplest mechanic that still uses HP meaningfully; avoids the complexity and fairness questions of a persistent "wounded between unrelated battles" state. This does not by itself bound how often draws occur — see Success Criteria and Outstanding Questions.
- **A draw pays no XP and triggers no recovery for either side** (assumption made to unblock planning) — Rationale: most conservative reading of "nothing decisive happened" — encourages a rematch rather than penalizing or rewarding either player.
- **Failed fresh-ownership verification re-rolls (random matchmaking) or rejects with an error (direct challenge)** (assumption made to unblock planning) — Rationale: keeps random battles resilient to a stale-cache false match, while a named challenge has no sensible substitute opponent to fall back to.
- **Deck-card grading is extended to a full five-tier, edition-only scale, and this same shared function feeds My Deck's displayed rarity badges** (not a separate battle-only calculation; pack-opening grading remains its own separate, price-inclusive system) — Rationale: one edition-only grading system shared by My Deck and battles is simpler to reason about than two diverging notions of a deck card's rarity; explicit trade-off accepted that existing My Deck badges will visibly change (some cards will newly show as epic/legendary) as a side effect of this feature.
- **Random matchmaking is strength-banded, progressively widening when no match is found within the band** — Rationale: gives weak/new cards a realistic path to their first win rather than relying solely on XP-scaling to make lopsided matchups worthwhile; progressive widening guarantees a battle still happens when the pool allows it, rather than failing outright just because the pool is thin.
- **The anti-farming throttle is keyed on the (winning wallet, losing wallet) pair, aggregated across all cards either side fields, regardless of who initiated** — Rationale: counting per-card would let a card-swap reset the throttle; counting globally against one card would unfairly penalize unrelated attackers who happen to face it. This limits simple card- or role-swapping exploits, though it doesn't stop farming via additional, separately-controlled wallets.
- **Power derives from a continuous edition-scarcity function; HP derives from a rarity-tier baseline plus a bounded, diminishing-returns modifier from normalized description length, with a guaranteed minimum** — Rationale: mirrors WikiGacha's ATK-from-views/DEF-from-length split, using data already fetched for every deck card. Bounding the description modifier (rather than a raw, uncapped length-to-HP mapping) prevents a creator from trivially maximizing HP by padding a description — unlike Wikipedia's collaboratively-maintained article length, an OBJKT description is fully creator-controlled. This reduces (but, per Success Criteria, does not eliminate) exact-tie collisions between cards that would otherwise share a per-tier stat bucket.
- **A defensive loss gets a shorter recovery period than an offensive loss** — Rationale: softens the "punished for a fight you didn't choose" feel of unsolicited defense, on top of the defense cap (R18) already bounding how often it can happen per day.

---

## Dependencies / Assumptions

- Requires a new persistent backend data store (wallet+card progress, battle history, opt-in status). Verified: the repo currently has no database/KV dependency (`package.json`, `src/`) and only two read-oriented API routes (`src/app/api/deck`, `src/app/api/random-pack`) — this is the first TzDeck feature to need real server-side write state.
- Requires new wallet-authentication infrastructure (R1). Verified: `src/app/api/deck/route.ts` currently accepts any `address` query parameter with no signature or session check — safe today because it only serves public on-chain reads, but not sufficient to authenticate an action attributed to a specific wallet. A signed-challenge mechanism via Beacon's message-signing capability is new work this feature requires, not something that already exists.
- Any new data store must respect the project's standing $20/month Vercel hosting ceiling. Vercel Marketplace database integrations vary in billing mechanics — some can route through Vercel's own invoice, others are billed independently by the provider with their own spend-control lifecycle. The specific chosen provider's spend controls need verifying against Vercel's current Marketplace billing documentation during planning, rather than assuming Hobby's "pause instead of charge" protection applies uniformly.
- Assumes each wallet's on-chain deck (as fetched via the existing `/api/deck` path) can be queried server-side for matchmaking, not only client-side, and that a fresher, non-cached ownership check is feasible at battle time without exceeding rate limits on the upstream OBJKT/Tezos data sources.
- Extending `calculateSupplyRarity` to five tiers changes existing, already-shipped My Deck rarity output, not just adding new battle-only behavior. The existing unit tests asserting today's three-tier thresholds (`src/lib/objkt.test.ts:77-81`) will need updating to match the new five-tier thresholds. The About page's existing explanation of deck grading may also need a copy update once the new thresholds are chosen.
- `editions` (fed by `token.supply`/`totalSupply` in `src/lib/objkt.ts:230,381`) is fetched live from OBJKT and can legitimately increase over time for open-edition drops — a card's stat seed is not necessarily stable if recomputed from current supply after a wallet has already started leveling it (see Outstanding Questions).
- A failed matchmaking search still performs real server/database work even though it consumes no battle allowance. Planning needs separate request-rate limiting (independent of the player-facing battle-allowance caps), bounded retry limits for ownership-check calls to upstream data sources, and defined behavior for when the backend's own resource limits — distinct from the daily battle caps — are exhausted.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R13, R14][Needs research] Combat is not guaranteed to be draw-free even with distinct per-card stats — simultaneous fixed damage ties whenever both sides' rounds-to-kill happen to match (verified: e.g. 10 Power/100 HP vs. 11 Power/95 HP both die on round 10). Before committing exact Power/HP/damage formulas, simulate representative matchups to measure draw rate and new/common-card first-win accessibility; if unacceptable, reconsider the combat or stat model rather than assuming the per-card stat change alone solved it.
- [Affects R8][Needs research] Exact function mapping edition count to base Power, and the exact bounded, diminishing-returns formula and text-normalization rules (whitespace collapsing, markup stripping, etc.) for the description-length HP modifier, plus its minimum-HP floor.
- [Affects R8][Needs research] Exact edition-count thresholds for the new epic/legendary tiers in the extended edition-only grading scale, and how they interact with the existing rare/uncommon/common breakpoints in `RARITY_THRESHOLDS`.
- [Affects R8][Needs research] Whether a card's base-stat seed (edition count, description length) is captured at first-leveling time or recomputed live on every subsequent fetch, given `editions` can grow for open-edition drops.
- [Affects R11][Needs research] Policy for retroactively adjusting already-saved Level/XP/Power when formulas or thresholds are rebalanced after launch.
- [Affects R17][Needs research] Exact recovery period durations for an offensive loss vs. the shorter defensive-loss recovery.
- [Affects R18][Needs research] Exact attack-cap and defense-cap values.
- [Affects Dependencies][Needs research] Which backend/database to use, and verification of its actual spend-control mechanics against the $20/month ceiling.
- [Affects R15][Needs research] Exact strength-band width and the widening step/schedule and outer bound used before failing the search.
- [Affects R20][Needs research] Exact XP-decay curve for repeated same-wallet-pair wins, and the rolling window's reset duration.
- [Affects R1][Needs research] Specific signed-challenge mechanism to use for server-side wallet authentication (e.g. a Tezos message-signing flow via Beacon) and how the resulting session is issued/verified.
- [Affects Dependencies][Needs research] Separate request-rate limits, bounded ownership-check retries, and behavior when the backend's own resource limits (distinct from player-facing daily caps) are exhausted for matchmaking searches, including failed ones.

---

## Next Steps

→ `/ce-plan` for structured implementation planning, after the combat/matchmaking simulation validates draw rate and first-win accessibility
