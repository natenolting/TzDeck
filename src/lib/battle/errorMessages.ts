export const BATTLE_ERROR_MESSAGES = new Map<string, string>([
  ["attacker_card_self_minted", "You can't battle with a card you minted yourself while you still hold it."],
]);

export function battleErrorMessage(code: string): string {
  return BATTLE_ERROR_MESSAGES.get(code) ?? code;
}
