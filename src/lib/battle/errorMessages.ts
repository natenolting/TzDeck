export const BATTLE_ERROR_MESSAGES = new Map<string, string>([
  ["attacker_card_self_minted", "You can't battle with a card you minted yourself while you still hold it."],
  ["attacker_card_not_held", "That card is no longer in your wallet, so you can't battle with it."],
  ["attacker_recovering", "That card is still recovering from its last battle, so it can't start another one yet."],
  ["self_challenge", "You can't challenge your own wallet to a battle."],
  ["target_not_eligible", "That wallet has no card available to defend right now."],
  ["defender_card_not_held", "Your opponent no longer holds that card, so the battle can't go ahead."],
  ["internal_error", "Something went wrong on our end, so please try that again."],
  ["internal_matchmaking_error", "Something went wrong while finding you an opponent, so please try again."],
  ["trainer_tier_locked", "You haven't reached the level needed to challenge that trainer yet."],
  ["trainer_attack_cap_reached", "You've used up today's trainer battles. Come back after the daily reset."],
  ["ownership_unverifiable", "We couldn't confirm who holds that card right now, so please try again in a moment."],
  ["attacker_metadata_unavailable", "We couldn't load that card's details right now, so please try again in a moment."],
  ["attempt_in_progress", "That battle is still being settled, so give it a moment."],
  ["attempt_expired", "That battle took too long to settle. Start it again with a fresh signature."],
  ["attempt_not_claimable", "That battle request can't be resumed. Start it again with a fresh signature."],
  ["nonce_expired", "That signature has expired. Start the battle again to sign a fresh one."],
  ["stale_attacker_version", "Your card's stats changed while this battle was starting, so please try again."],
  ["conflicting_first_use_materialization", "Your card's first battle was already being set up, so please try again."],
  ["progress_row_missing", "We couldn't find your card's battle record, so please refresh your holdings and try again."],
  ["rate_limited", "You're sending battles faster than we can take them, so wait a minute and try again."],
  ["unsupported_wallet_type", "This wallet type can't sign battles. Try a wallet with a tz1, tz2, or tz3 address."],
  ["signature_invalid", "Your wallet's signature didn't check out, so nothing was sent. Please try again."],
  ["address_mismatch", "That signature came from a different wallet than the one connected. Reconnect and try again."],
  ["identity_mismatch", "That signature was for a different battle. Start again with a fresh signature."],
  ["envelope_invalid", "That battle session wasn't valid. Start again with a fresh signature."],
  ["malformed", "That battle request couldn't be read. Start again with a fresh signature."],
  ["invalid_json_body", "That battle request couldn't be read. Please try again."],
  ["missing_required_fields", "That battle request was missing something. Please try again."],
]);

export function battleErrorMessage(code: string): string {
  return BATTLE_ERROR_MESSAGES.get(code) ?? code;
}
