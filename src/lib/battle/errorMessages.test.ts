import assert from "node:assert/strict";
import test from "node:test";

import { battleErrorMessage } from "./errorMessages";

test("battleErrorMessage translates a code that has copy", () => {
  assert.equal(
    battleErrorMessage("attacker_card_self_minted"),
    "You can't battle with a card you minted yourself while you still hold it.",
  );
});

test("battleErrorMessage translates the attacker's card leaving their wallet", () => {
  assert.equal(
    battleErrorMessage("attacker_card_not_held"),
    "That card is no longer in your wallet, so you can't battle with it.",
  );
});

test("battleErrorMessage translates an attacking card that is still in recovery", () => {
  assert.equal(
    battleErrorMessage("attacker_recovering"),
    "That card is still recovering from its last battle, so it can't start another one yet.",
  );
});

test("battleErrorMessage translates a wallet challenging itself", () => {
  assert.equal(battleErrorMessage("self_challenge"), "You can't challenge your own wallet to a battle.");
});

test("battleErrorMessage translates a challenged wallet with nothing able to defend", () => {
  assert.equal(battleErrorMessage("target_not_eligible"), "That wallet has no card available to defend right now.");
});

test("battleErrorMessage translates the defending card leaving its owner's wallet", () => {
  assert.equal(
    battleErrorMessage("defender_card_not_held"),
    "Your opponent no longer holds that card, so the battle can't go ahead.",
  );
});

test("battleErrorMessage translates an unexpected server failure", () => {
  assert.equal(battleErrorMessage("internal_error"), "Something went wrong on our end, so please try that again.");
});

test("battleErrorMessage gives an unknown code a generic sentence, never the code itself", () => {
  const generic = "Something went wrong with that battle, so please try again.";
  assert.equal(battleErrorMessage("no_such_battle_code"), generic);
  assert.equal(battleErrorMessage("toString"), generic, "an inherited property is not copy");
});
