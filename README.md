# TzDeck

**Pull. Collect. Discover.**

TzDeck is a gamified discovery and collection viewer for Tezos NFTs. It turns artwork from [OBJKT](https://objkt.com/) into a trading-card experience where collectors can open virtual booster packs, inspect new finds, and browse the NFTs already held in their wallet as a personal deck.

## How it works

- **Open booster packs:** Pull five random active OBJKT listings and reveal each NFT through animated cards.
- **Discover Tezos art:** See the artist, collection, edition size, listed price, and a rarity graded from the token's supply and its market listing.
- **Inspect every card:** Open a larger artwork view with token metadata and a direct link to its OBJKT page.
- **Browse your deck:** Connect a Beacon-compatible Tezos wallet to load, search, filter, and sort the NFTs it owns.
- **Build a wishlist:** Save interesting pulls in your browser and return to them later.

TzDeck is a discovery layer, not a marketplace. It does not mint, sell, or transfer NFTs. Collection activity happens through OBJKT and its Tezos marketplace contracts.

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

## Battle system

Connected wallets can pit an owned card against another wallet's card for XP and levels, using the same edition-based Power/HP derivation as the deck rarity ladder above. Battling needs a Postgres database (`DATABASE_URL`) and two additional env vars (`BATTLE_AUTH_SECRET`, `BATTLE_APP_ID`) in `.env.local`; run `npm run migrate` once against that database before battling locally (see [Database migrations](#database-migrations)).

Two scripts explore the combat math without a database or a running server:

```bash
npm run simulate -- 5000              # run 5000 battles between fresh random cards, report win/draw rates
npm run simulate -- --help            # see all flags: fixed matchups, variance, seed, CSV export
npm run validate:tiebreak             # the R14 overkill-tiebreak's own fixed acceptance run
```

`simulate` is the general-purpose tool for exploring balance: it defaults to rolling a new random card for each side every trial, or pins a specific matchup via `--a-editions`/`--a-desc`/`--a-level` (and `--b-*` for the defender). Pass `--seed=N` for a reproducible run or `--csv=path.csv` to export one row per trial.

## Database migrations

The battle system's schema lives in `migrations/` as numbered SQL files. Both commands read `DATABASE_URL`:

```bash
npm run migrate:status    # print the plan and exit, writing nothing
npm run migrate           # apply every migration that has not run yet
```

`migrate` records each applied filename and its checksum, so a second run is a no-op. `migrate:status` neither locks nor writes, so it is safe to point at any database, production included.

An applied migration is checksummed, so its file must never be edited afterwards. An edited file makes the next run refuse to apply anything until the file matches what was recorded. Fix a mistake by adding a new numbered migration on top instead.

Production migrations run from [`.github/workflows/migrate.yml`](.github/workflows/migrate.yml), which triggers once CI goes green on `main` and can also be started by hand from the Actions tab. Before it can work, the operator adds a `PRODUCTION_DATABASE_URL` secret to the repository's `production` environment under **Settings > Environments**. That environment is also where required reviewers go if a production migration should need human approval.

Give the secret the **direct**, non-pooled Neon connection string rather than the pooled one. Each migration runs inside a transaction, and the pooler handles transactional DDL badly. When the secret is empty the workflow fails with that instruction instead of connecting to nothing.

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
npm run migrate:status    # Print the migration plan without touching the database
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
