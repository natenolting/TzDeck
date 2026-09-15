export const BATTLE_ERROR_MESSAGES = new Map<string, string>([
  ["attacker_card_self_minted", "You can't battle with a card you minted yourself while you still hold it."],
  ["attacker_card_not_held", "That card is no longer in your wallet, so you can't battle with it."],
  ["attacker_recovering", "That card is still recovering from its last battle, so it can't start another one yet."],
]);

export function battleErrorMessage(code: string): string {
  return BATTLE_ERROR_MESSAGES.get(code) ?? code;
}
