import { cache } from "react";

import { RARITY_CONFIG } from "@/components/rarityStyles";
import { verifyBattleShare, type BattleShare } from "@/lib/battle/shareToken";
import { calculateSupplyRarity, type CardRarity, type NFTCard } from "@/lib/objkt";
import type { CardRef } from "@/lib/share";
import { loadSharedCard } from "@/lib/shareServer";
import { loadDenylist } from "@/lib/pullStore";

/**
 * Everything a battle result's page and preview need, resolved once per render.
 *
 * A card is null when it can't be shown: OBJKT has no token for it, OBJKT is
 * unreachable, or it is on the denylist. The battle itself never depends on
 * OBJKT, because the token carries every number, so a missing card degrades
 * the picture, never the result. The denylist is checked at render time so an
 * artist's opt-out reaches links shared before it.
 */
export interface ResolvedBattleShare {
  share: BattleShare;
  winnerCard: NFTCard | null;
  /** Null for a trainer, and for a card that can't be shown. */
  opponentCard: NFTCard | null;
  /** The opponent as a battle tier: its supply rarity, or the trainer's tier. */
  opponentRarity: CardRarity | null;
  /** How the result names the opponent without naming anyone: "a Rare card", "the Common Trainer". */
  opponentPhrase: string;
}

async function showableCard(ref: CardRef, denied: (ref: CardRef) => boolean): Promise<NFTCard | null> {
  if (denied(ref)) return null;
  try {
    return await loadSharedCard(ref);
  } catch {
    return null;
  }
}

/** Battle stats use the supply ladder, so the result names cards by their battle tier. */
function battleRarity(card: NFTCard): CardRarity {
  return calculateSupplyRarity(card.editions);
}

function withArticle(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

export const loadBattleShare = cache(async (token: string): Promise<ResolvedBattleShare | null> => {
  const share = verifyBattleShare(token);
  if (!share) return null;

  const denylist = await loadDenylist();
  const denied = (ref: CardRef) => denylist.has(ref.contract, ref.tokenId);

  const [winnerCard, opponentCard] = await Promise.all([
    showableCard(share.winner, denied),
    share.opponent.kind === "card" ? showableCard(share.opponent.card, denied) : Promise.resolve(null),
  ]);

  if (share.opponent.kind === "trainer") {
    const tier = share.opponent.tier;
    return {
      share,
      winnerCard,
      opponentCard: null,
      opponentRarity: tier,
      opponentPhrase: `the ${RARITY_CONFIG[tier].label} Trainer`,
    };
  }

  const opponentRarity = opponentCard ? battleRarity(opponentCard) : null;
  return {
    share,
    winnerCard,
    opponentCard,
    opponentRarity,
    opponentPhrase: opponentRarity ? `${withArticle(RARITY_CONFIG[opponentRarity].label)} card` : "another collector's card",
  };
});

/** "Beat a Rare card in 5 rounds with 15 HP left." Names no wallet and no opponent card. */
export function battleSummary(resolved: ResolvedBattleShare): string {
  const { rounds, winnerSide } = resolved.share;
  const roundText = rounds === 1 ? "1 round" : `${rounds} rounds`;
  return `Beat ${resolved.opponentPhrase} in ${roundText} with ${winnerSide.finalHp} HP left.`;
}
