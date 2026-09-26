import { reject } from "./failures";
import { fetchBattleTokenMetadata } from "./holdings";
import { verifyOwnership, type OwnershipResult } from "./ownership";
import { parseCardKey } from "@/lib/cardKey";
import { levelForXp, type CandidateCard, type Combatant } from "./rules";
import { fetchProgress, type CandidatePoolRow } from "./store";

export interface Attacker extends Combatant {
  /** The progress row version the commit expects, or null for a card's first battle. */
  expectedVersion: string | null;
}

/** A fresh upstream check that this wallet holds this card right now. */
/** A card key the server stored or checked; one without a separator is a bug, not input. */
function tokenOf(key: string): { contractAddress: string; tokenId: string } {
  const token = parseCardKey(key);
  if (!token) throw new Error(`malformed card key: ${key}`);
  return token;
}

export function ownershipOf(card: Pick<Combatant, "wallet" | "cardKey">): Promise<OwnershipResult> {
  const { contractAddress, tokenId } = tokenOf(card.cardKey);
  return verifyOwnership(card.wallet, contractAddress, tokenId);
}

function requireHeld(ownership: OwnershipResult, side: "attacker" | "defender"): void {
  if (ownership.status === "not_held") reject(side === "attacker" ? "attacker_card_not_held" : "defender_card_not_held");
  if (ownership.status === "unverifiable") reject("ownership_unverifiable");
}

/**
 * The card a wallet is attacking with, checked fresh before any battle work:
 * still held, not recovering, and on its first battle, not self-minted.
 * Rejects the attempt otherwise.
 */
export async function resolveAttacker(wallet: string, cardKey: string): Promise<Attacker> {
  requireHeld(await ownershipOf({ wallet, cardKey }), "attacker");

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

  const { contractAddress, tokenId } = tokenOf(cardKey);
  const metadata = await fetchBattleTokenMetadata(wallet, contractAddress, tokenId);
  if (metadata.status === "self_minted") reject("attacker_card_self_minted");
  if (metadata.status !== "ok") reject("attacker_metadata_unavailable");
  return { wallet, cardKey, seed: metadata.metadata.seed, level: 1, expectedVersion: null };
}

export async function requireDefenderHeld(defender: Combatant): Promise<void> {
  requireHeld(await ownershipOf(defender), "defender");
}

/**
 * Both cards re-checked immediately before commit, since upstream calls and
 * re-rolls may have taken a while. The checks run together, but the attacker's
 * result is read first, so a failure names the same side it always did.
 */
export async function requireBothStillHeld(attacker: Combatant, defender: Combatant): Promise<void> {
  const [attackerOwnership, defenderOwnership] = await Promise.all([ownershipOf(attacker), ownershipOf(defender)]);
  requireHeld(attackerOwnership, "attacker");
  requireHeld(defenderOwnership, "defender");
}

export function toCandidateCard(row: CandidatePoolRow): CandidateCard {
  return {
    wallet: row.wallet,
    cardKey: row.card_key,
    seed: { editions: row.seed_editions, descriptionLength: row.seed_description_length },
    level: levelForXp(Number(row.xp)),
    recoveryUntil: row.recovery_until ? new Date(row.recovery_until) : null,
    defenseCount: row.defense_count,
    defenseResetAt: new Date(row.defense_reset_at),
    progressVersion: row.progress_version,
  };
}
