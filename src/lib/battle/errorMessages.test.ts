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

test("battleErrorMessage returns an unmapped code unchanged", () => {
  assert.equal(battleErrorMessage("self_challenge"), "self_challenge");
  assert.equal(battleErrorMessage("toString"), "toString");
});
