import type { BattleFailureCode } from "./failures";
import type { AuthRejection } from "./requestAuth";
import type { RequestFailureCode } from "./signedRoute";

/** What the SQL commit functions raise, as their RAISE EXCEPTION messages spell it. */
type CommitFailureCode =
  | "attack_cap_reached"
  | "defense_cap_reached"
  | "trainer_attack_cap_reached"
  | "attacker_recovering"
  | "defender_recovering"
  | "defender_opted_out"
  | "defender_wallet_not_found"
  | "self_challenge"
  | "progress_row_missing"
  | "stale_attacker_version"
  | "stale_defender_version"
  | "conflicting_first_use_materialization"
  | "attempt_expired"
  | "attempt_not_claimable"
  | "identity_mismatch"
  | "invalid_holdings_sync"
  | "stale_holdings_generation";

/** Every code a battle, opt-in, or refresh request can come back with. */
export type BattleErrorCode = BattleFailureCode | AuthRejection | RequestFailureCode | CommitFailureCode;

/** A code without copy here is a type error, so no code reaches a player as itself. */
const BATTLE_ERROR_MESSAGES: Record<BattleErrorCode, string> = {
  attacker_card_self_minted: "You can't battle with a card you minted yourself while you still hold it.",
  attacker_card_not_held: "That card is no longer in your wallet, so you can't battle with it.",
  attacker_recovering: "That card is still recovering from its last battle, so it can't start another one yet.",
  self_challenge: "You can't challenge your own wallet to a battle.",
  target_not_eligible: "That wallet has no card available to defend right now.",
  defender_card_not_held: "Your opponent no longer holds that card, so the battle can't go ahead.",
  internal_error: "Something went wrong on our end, so please try that again.",
  trainer_tier_locked: "You haven't reached the level needed to challenge that trainer yet.",
  trainer_attack_cap_reached: "You've used up today's trainer battles. Come back after the daily reset.",
  ownership_unverifiable: "We couldn't confirm who holds that card right now, so please try again in a moment.",
  attacker_metadata_unavailable: "We couldn't load that card's details right now, so please try again in a moment.",
  attempt_in_progress: "That battle is still being settled, so give it a moment.",
  attempt_expired: "That battle took too long to settle. Start it again with a fresh signature.",
  attempt_not_claimable: "That battle request can't be resumed. Start it again with a fresh signature.",
  nonce_expired: "That signature has expired. Start the battle again to sign a fresh one.",
  stale_attacker_version: "Your card's stats changed while this battle was starting, so please try again.",
  stale_defender_version: "Your opponent's card changed while this battle was starting, so please try again.",
  attack_cap_reached: "You've used up today's battles. Come back after the daily reset.",
  defense_cap_reached: "That wallet has defended as often as it can today. Try another opponent.",
  defender_opted_out: "That wallet stopped defending before the battle could start.",
  defender_recovering: "Your opponent's card is still recovering from its last battle.",
  defender_wallet_not_found: "That wallet isn't set up for battles, so it can't be challenged.",
  conflicting_first_use_materialization: "Your card's first battle was already being set up, so please try again.",
  progress_row_missing: "We couldn't find your card's battle record, so please refresh your holdings and try again.",
  holdings_unavailable: "We couldn't read your collection from OBJKT right now, so please try again in a moment.",
  sync_superseded: "Another sync of your collection took over this one, so please try again.",
  collection_too_large: "Your collection is larger than battles can take in right now, so it can't be synced.",
  invalid_holdings_sync: "Your collection sync didn't finish cleanly, so please start it again.",
  stale_holdings_generation: "Your collection changed while it was syncing, so please sync it again.",
  rate_limited: "You're sending battles faster than we can take them, so wait a minute and try again.",
  unsupported_wallet_type: "This wallet type can't sign battles. Try a wallet with a tz1, tz2, or tz3 address.",
  signature_invalid: "Your wallet's signature didn't check out, so nothing was sent. Please try again.",
  address_mismatch: "That signature came from a different wallet than the one connected. Reconnect and try again.",
  identity_mismatch: "That signature was for a different battle. Start again with a fresh signature.",
  envelope_invalid: "That battle session wasn't valid. Start again with a fresh signature.",
  malformed: "That battle request couldn't be read. Start again with a fresh signature.",
  invalid_json_body: "That battle request couldn't be read. Please try again.",
  missing_required_fields: "That battle request was missing something. Please try again.",
};

/** For a code no server version sends yet, such as one from a newer deploy mid-rollout. */
const UNKNOWN_ERROR_MESSAGE = "Something went wrong with that battle, so please try again.";

export function battleErrorMessage(code: string): string {
  return Object.hasOwn(BATTLE_ERROR_MESSAGES, code)
    ? BATTLE_ERROR_MESSAGES[code as BattleErrorCode]
    : UNKNOWN_ERROR_MESSAGE;
}
