# TzDeck

**Pull. Collect. Discover.**

TzDeck is a gamified discovery and collection viewer for Tezos NFTs. It turns artwork from [OBJKT](https://objkt.com/) into a trading-card experience where collectors can open virtual booster packs, inspect new finds, and browse the NFTs already held in their wallet as a personal deck.

## How it works

- **Open booster packs:** Pull five random active OBJKT listings and reveal each NFT through animated cards.
- **Discover Tezos art:** See the artist, collection, edition size, listed price, and a simulated rarity based on the token's supply and market listing.
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

The deck-only supply ladder is Rare for a 1 of 1, Uncommon for editions of 25 or fewer, and Common for larger editions.

These thresholds were calibrated against 500 active OBJKT listings sampled deterministically across the marketplace's listing-ID range. The measured distribution was 1.6% Legendary, 4.8% Epic, 24.0% Rare, 55.6% Uncommon, and 14.0% Common. Re-run `npm run calibrate:rarity` to verify the live catalogue remains within the design targets.

## Run locally

Install the dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The app includes public defaults for its OBJKT GraphQL endpoint and Tezos mainnet RPC. You can override them in `.env.local` when needed:

```bash
NEXT_PUBLIC_OBJKT_API_URL=https://data.objkt.com/v3/graphql
NEXT_PUBLIC_TEZOS_RPC_URL=https://mainnet.api.tez.ie
```

## Development commands

```bash
npm test                 # Run the automated test suite
npm run lint             # Check the code with ESLint
npm run calibrate:rarity # Verify rarity tiers against 500 live listings
npx tsc --noEmit         # Type-check without emitting files
npm run build -- --webpack
```

## Built with

- [Next.js](https://nextjs.org/) and React
- [Tailwind CSS](https://tailwindcss.com/) and Motion
- [Taquito](https://taquito.io/) and Beacon for Tezos wallet connectivity
- [OBJKT](https://objkt.com/) and [TzKT](https://tzkt.io/) for NFT and wallet data
- IPFS gateway fallbacks for decentralized media
