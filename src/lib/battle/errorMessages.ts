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
]);

export function battleErrorMessage(code: string): string {
  return BATTLE_ERROR_MESSAGES.get(code) ?? code;
}
