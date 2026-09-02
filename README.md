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
npx tsc --noEmit         # Type-check without emitting files
npm run build -- --webpack
```

## Built with

- [Next.js](https://nextjs.org/) and React
- [Tailwind CSS](https://tailwindcss.com/) and Motion
- [Taquito](https://taquito.io/) and Beacon for Tezos wallet connectivity
- [OBJKT](https://objkt.com/) and [TzKT](https://tzkt.io/) for NFT and wallet data
- IPFS gateway fallbacks for decentralized media
