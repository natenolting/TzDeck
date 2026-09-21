# TzDeck

A gamified discovery, collection, and battling layer over Tezos NFTs. This file is the glossary. It records what each term means and which near-synonyms not to reach for, so copy, code, and conversation stay in one language.

## Language

**Token**:
The on-chain Tezos NFT a collector owns. TzDeck reads tokens and never mints, sells, or transfers one.
_Avoid_: "asset", and bare "token" in player-facing copy, where it reads as a fungible coin.

**Card**:
TzDeck's derived view of a token, carrying a Power, an HP, and a rarity tier that exist nowhere on-chain. A card is what fights in a battle; a token is what a collector owns.
_Avoid_: using "card" and "token" interchangeably. Combat operates on cards, ownership on tokens.

**Deck**:
A view of the tokens a wallet already holds. It is loaded, searched, filtered, and sorted. It is never constructed.
_Avoid_: "build a deck", "deckbuilding", any phrasing implying a collector assembles or chooses one.

**Collection**:
The art a collector already owns. The player-facing word for their tokens, and the word used in the pitch.
_Avoid_: "holdings" in player-facing copy. `holdings` stays the code term.

**Rarity**:
A display classification TzDeck assigns from edition supply and current listing price. Not an on-chain trait, not a pull probability, and not a valuation.
_Avoid_: any phrasing that presents rarity as worth, price, or odds.

**Pull**:
One booster pack: five randomly selected active listings, revealed as cards. The only surface that needs no wallet.
_Avoid_: "drop", "mint", "roll".

**Battle**:
One wallet attacking another wallet's card, or a trainer. Defending is not a choice and does not count as battling.
_Avoid_: "match", "duel", "PvP" in player-facing copy.
