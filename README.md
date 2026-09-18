# TzDeck

**Pull. Collect. Battle.**

TzDeck is a gamified discovery, collection, and battling layer for Tezos NFTs. It turns artwork from [OBJKT](https://objkt.com/) into a trading-card experience where collectors can open virtual booster packs, inspect new finds, browse the NFTs already held in their wallet as a personal deck, and pit those cards against other collectors' for XP and levels.

## How it works

- **Open booster packs:** Pull five random active OBJKT listings and reveal each NFT through animated cards.
- **Discover Tezos art:** See the artist, collection, edition size, listed price, and a rarity graded from the token's supply and its market listing.
- **Inspect every card:** Open a larger artwork view with token metadata and a direct link to its OBJKT page.
- **Browse your deck:** Connect a Beacon-compatible Tezos wallet to load, search, filter, and sort the NFTs it owns.
- **Battle other collectors:** Pit a card you own against another opted-in wallet's card for XP and levels that persist across sessions.
- **Build a wishlist:** Save interesting pulls in your browser, back them up to a file, and return to them later.

TzDeck is a discovery layer, not a marketplace. It does not mint, sell, or transfer NFTs. Collection activity happens through OBJKT and its Tezos marketplace contracts.

### Booster pack filtering

Booster packs exclude tokens that OBJKT has flagged, tokens from collections that are no longer live, tokens with a flagged creator, and anything on TzDeck's own denylist. Roughly 99% of active listings pass, and every exclusion is recorded with the rule that caused it. See `docs/pull-filter-spec.md`.

The filter needs no database. Losing `DATABASE_URL` degrades it to the three OBJKT rules rather than failing a pack -- the denylist is a manual override on top, not the main protection.

Manage the denylist with `npm run denylist` against `DATABASE_URL`:

```bash
npm run denylist -- --list
npm run denylist -- --add KT1… [--token <id>] --reason "confirmed impersonation"
npm run denylist -- --remove KT1… [--token <id>]
```

Entries take effect within 60 seconds, across instances, without a deploy. A `--token` id denylists one token; omitting it denylists the whole contract.

## Rarity system

TzDeck rarity is a deterministic display classification, not an on-chain NFT trait or a weighted pull probability. After a card is selected, TzDeck assigns the first matching tier from highest to lowest using the token's total edition supply and current OBJKT listing price:

| Rarity | Deterministic rule |
| --- | --- |
| Legendary | Exactly 1 edition **and** at least 500 ꜩ |
| Epic | 5 or fewer editions **and** at least 180 ꜩ, **or** any supply at 500 ꜩ or more |
| Rare | Exactly 1 edition **or** at least 110 ꜩ |
| Uncommon | 25 or fewer editions **or** at least 5 ꜩ |
| Common | More than 25 editions **and** less than 5 ꜩ |

The top two tiers require market corroboration for scarcity; the lower tiers use an **OR** condition. Rules are evaluated from Legendary downward, so the first match wins.

Booster-pack contents are randomized from active OBJKT listings, but the rarity assigned to each selected card is deterministic. Cards in **My Deck** are classified by edition supply alone because wallet holdings do not include a listing price. As a result, the same NFT can have a different displayed rarity in a booster pack if its listing price raises it into a higher tier.

The deck-only supply ladder is Legendary for a 1 of 1, Epic for editions of 5 or fewer, Rare for editions of 10 or fewer, Uncommon for editions of 25 or fewer, and Common for larger editions -- the same five-tier scale used by My Deck's battle system (see below).

These thresholds were calibrated against 500 active OBJKT listings sampled deterministically across the marketplace's listing-ID range. The measured distribution was 1.6% Legendary, 4.8% Epic, 24.0% Rare, 55.6% Uncommon, and 14.0% Common. Re-run `npm run calibrate:rarity` to verify the live catalogue remains within the design targets.

## Wishlist backup

The wishlist lives in the browser's `localStorage` under `tzdeck_wishlist`, so clearing site data or switching browsers loses it. **Export** downloads the saved cards as a dated `tzdeck-wishlist-YYYY-MM-DD.json` file; **Import** reads one back, including from the empty-wishlist screen.

An import merges rather than replaces -- cards already saved keep their place, and new ones are appended. The file's own `contract_address` and `token_id` are the only identity TzDeck trusts from it: every card is re-resolved against OBJKT on import, so prices and rarities reflect the market now rather than whenever the file was written. A card OBJKT no longer lists keeps its artwork and loses its price, falling back to the supply-only rarity ladder; if OBJKT can't be reached at all, the import still succeeds on the file's stored values and says which cards may be out of date.

**Clear Wishlist** asks for confirmation before it wipes anything, naming how many cards are at stake; the prompt opens with focus on Cancel, and Escape or a click outside backs out.

Entries the file can't justify are dropped instead of failing the whole import: a card with no contract or token id, a repeat of one already read, or an image URL that isn't `https:` or `ipfs:`. The OBJKT link on each imported card is rebuilt from its contract and token id rather than taken from the file.

## Battle system

Connected wallets can pit an owned card against another wallet's card for XP and levels, using the same edition-based Power/HP derivation as the deck rarity ladder above. Battling needs a Postgres database (`DATABASE_URL`) and two additional env vars (`BATTLE_AUTH_SECRET`, `BATTLE_APP_ID`) in `.env.local`; run `npm run migrate` once against that database before battling locally (see [Database migrations](#database-migrations)).

Two scripts explore the combat math without a database or a running server:

```bash
npm run simulate -- 5000              # run 5000 battles between fresh random cards, report win/draw rates
npm run simulate -- --help            # see all flags: fixed matchups, variance, seed, CSV export
npm run validate:tiebreak             # the R14 overkill-tiebreak's own fixed acceptance run
```

`simulate` is the general-purpose tool for exploring balance: it defaults to rolling a new random card for each side every trial, or pins a specific matchup via `--a-editions`/`--a-desc`/`--a-level` (and `--b-*` for the defender). Pass `--seed=N` for a reproducible run or `--csv=path.csv` to export one row per trial.

### Frequently asked questions

**Does battling ever cost Tezos?** No. Every battle action -- matchmaking, direct challenges, opting in, refreshing holdings -- is authenticated by asking your wallet to sign a message (`wallet.client.requestSignPayload` in `WalletContext.tsx`), never by broadcasting an on-chain operation. Nothing is transferred and no gas or storage fee is paid.

**Can I battle an NPC instead of another wallet?** Yes -- five fixed "trainer" opponents, one per rarity tier, always available with no opt-in required on their side. Higher tiers unlock as your card levels up, you may still challenge any tier you've already unlocked, and trainer battles draw from their own separate daily allowance (`trainer_attack_count`/`trainer_attack_reset_at`) rather than the PvP one. A loss to a trainer still costs the normal recovery cooldown, just like a PvP loss.

**Does the daily attack limit reset at a specific time?** Yes, at midnight UTC. `commit_battle` resets a wallet's `attack_count` to 1 the first time it attacks after its `attack_reset_at` has passed, and sets the next reset to `date_trunc('day', now()) + interval '1 day'`. The reset is lazy (evaluated the next time that wallet attacks, not on a schedule) and shared across every card the wallet owns.

**Does the defense cap reset the same way?** Yes, identically -- same per-wallet `date_trunc('day', ...) + interval '1 day'` boundary, just evaluated when the wallet is picked as a defender instead of when it attacks.

**Does the recovery cooldown work the same way?** No. Recovery is a fixed duration counted from the moment a card loses, not aligned to midnight: `recovery_until = settled_at + interval`, with the interval hardcoded as 4 hours for an attacker's loss and 1 hour for a defender's loss. It is also per-card, not per-wallet.

**Is the recovery duration configurable anywhere?** No. It lives only as PL/pgSQL constants (`v_offensive_recovery`, `v_defensive_recovery`) inside the `commit_battle` function in `migrations/`. Changing it means shipping a new migration that redefines the function.

**Does the XP/leveling system have a similar cap?** Level itself is uncapped -- `levelForXp` in `rules.ts` keeps climbing against a quadratic XP threshold with no ceiling, and the Power/HP level multiplier scales with it forever. Three of the combat modifiers built on top of level do cap out, each a plain constant in `rules.ts`: critical-hit chance caps at 20% (level 39), critical-hit multiplier caps at 3.0x (level 31), and miss chance floors at 1% (also around level 31).

**Does the SQL side duplicate and test those caps?** No. `commit_battle` never recomputes combat stats -- it takes the client-computed `attackerStats`/`defenderStats`/`combat` as opaque input and only records them. The one server-side formula SQL *does* recompute independently (so a client can't lie about it) is the anti-farming XP decay, which is why it's the only one with a parity test (`commitBattle.test.ts`'s `"decay parity"` case).

**Does that anti-farming decay reset per opponent?** Per opponent *wallet pair*, and it's a rolling window rather than a hard reset: `commit_battle` counts your wins against that specific wallet in the trailing 7 days and scales the XP award down by `0.5 ^ count` (floored at 10%). Beating a different wallet starts back at full XP; wins against the same wallet older than 7 days simply age out of the count on their own.

**Does the win/loss battle log ever get pruned?** Yes -- `battle_log` rows older than 30 days are swept opportunistically inside `commit_battle`, the same pattern `check_rate_limit` uses for `rate_limits` (see [Database migrations](#database-migrations)). Nothing reads `battle_log` beyond that 7-day decay window in production, so 30 days is a comfortable margin, not a hard functional requirement.

## Database migrations

The battle system's schema lives in `migrations/` as numbered SQL files. Both commands read `DATABASE_URL`:

```bash
npm run migrate:status    # print the plan and exit, writing nothing
npm run migrate           # apply every migration that has not run yet
```

`migrate` records each applied filename and its checksum, so a second run is a no-op. `migrate:status` neither locks nor writes, so it is safe to point at any database, production included.

An applied migration is checksummed, so its file must never be edited afterward. An edited file makes the next run refuse to apply anything until the file matches what was recorded. Fix a mistake by adding a new numbered migration on top instead.

Production migrations run from `.github/workflows/migrate.yml`, which triggers once CI goes green on `main` and can also be started by hand from the Actions tab. Before it can work, the operator adds a `PRODUCTION_DATABASE_URL` secret to the repository's `production` environment under **Settings > Environments**. That environment is also where required reviewers go if a production migration should need human approval.

Give the secret the **direct**, non-pooled Neon connection string. A run holds a session-level advisory lock so two migrations cannot overlap, and a transaction-mode pooler can hand each statement a different backend, taking the lock on one connection and releasing it against another. The per-migration transactions themselves are fine through a pooler, which is why this fails silently rather than loudly, so applying through a `-pooler` host is refused outright. Reads never take the lock, so `migrate:status` works against either host. When the secret is empty the workflow fails with that instruction instead of connecting to nothing.

`PRODUCTION_DATABASE_URL` is a GitHub Actions secret, read only by the workflow. It has nothing to do with Vercel's environment variables, where the app reads `DATABASE_URL` at runtime. Vercel wants the pooled endpoint for that one; only migrations need the direct host.

GitHub only offers a workflow once it is on the default branch, so the first production migration has to be dispatched by hand after this lands on `main`.

The first production rollout is the one to sequence deliberately. Vercel ships the moment `main` moves and the deployed battle routes need their tables, so migrate immediately before or immediately after the merge.

## Run locally

Install the dependencies and start the development server:

```bash
npm install
npm run dev
```

Use npm, not pnpm or yarn -- the repo tracks `package-lock.json`, and `pnpm install` will fail on its build-script approval gate for transitive dependencies.

Open [http://localhost:3000](http://localhost:3000) in your browser.

The app includes public defaults for its OBJKT GraphQL endpoint and Tezos mainnet RPC. You can override them in `.env.local` when needed:

```bash
NEXT_PUBLIC_OBJKT_API_URL=https://data.objkt.com/v3/graphql
NEXT_PUBLIC_TEZOS_RPC_URL=https://mainnet.api.tez.ie
```

## Development commands

```bash
npm test                  # Run the automated test suite
npm run lint              # Check the code with ESLint
npm run calibrate:rarity  # Verify rarity tiers against 500 live listings
npm run check:diversity   # Verify packs draw from several artists
npm run migrate           # Apply battle-system database migrations
npm run migrate:status    # Print the migration plan without writing to the database
npm run denylist          # Manage the booster-pack denylist (--list, --add, --remove)
npm run simulate          # Run N ad-hoc battle simulations (see Battle system above)
npm run validate:tiebreak # The R14 tiebreak's own fixed acceptance run
npx tsc --noEmit          # Type-check without emitting files
npm run build             # Production build
```

## Built with

- [Next.js](https://nextjs.org/) and React
- [Tailwind CSS](https://tailwindcss.com/) and Motion
- [Taquito](https://taquito.io/) and Beacon for Tezos wallet connectivity
- [OBJKT](https://objkt.com/) and [TzKT](https://tzkt.io/) for NFT and wallet data
- IPFS gateway fallbacks for decentralized media
