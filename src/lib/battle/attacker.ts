import { reject } from "./failures";
import { fetchBattleTokenMetadata } from "./holdings";
import { verifyOwnership } from "./ownership";
import { splitCardKey } from "./requestAuth";
import { levelForXp, type BaseSeed } from "./rules";
import { fetchProgress } from "./store";

export interface Attacker {
  wallet: string;
  cardKey: string;
  seed: BaseSeed;
  level: number;
  /** The progress row version the commit expects, or null for a card's first battle. */
  expectedVersion: string | null;
}

/**
 * The card a wallet is attacking with, checked fresh before any battle work:
 * still held, not recovering, and on its first battle, not self-minted.
 * Rejects the attempt otherwise.
 */
export async function resolveAttacker(wallet: string, cardKey: string): Promise<Attacker> {
  const { contractAddress, tokenId } = splitCardKey(cardKey);

  const ownership = await verifyOwnership(wallet, contractAddress, tokenId);
  if (ownership.status === "not_held") reject("attacker_card_not_held");
  if (ownership.status === "unverifiable") reject("ownership_unverifiable");

  const progress = await fetchProgress(wallet, cardKey);
  if (progress?.recovery_until && new Date(progress.recovery_until) > new Date()) reject("attacker_recovering");

  if (progress) {
    return {
      wallet,
      cardKey,
      seed: { editions: progress.seed_editions, descriptionLength: progress.seed_description_length },
      level: levelForXp(Number(progress.xp)),
      expectedVersion: progress.progress_version,
    };
  }

  const metadata = await fetchBattleTokenMetadata(wallet, contractAddress, tokenId);
  if (metadata.status === "self_minted") reject("attacker_card_self_minted");
  if (metadata.status !== "ok") reject("attacker_metadata_unavailable");
  return { wallet, cardKey, seed: metadata.metadata.seed, level: 1, expectedVersion: null };
}
