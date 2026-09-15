import assert from "node:assert/strict";
import test from "node:test";

import { battleErrorMessage } from "./errorMessages";

test("battleErrorMessage translates a code that has copy", () => {
  assert.equal(
    battleErrorMessage("attacker_card_self_minted"),
    "You can't battle with a card you minted yourself while you still hold it.",
  );
});

test("battleErrorMessage returns an unmapped code unchanged", () => {
  assert.equal(battleErrorMessage("attacker_card_not_held"), "attacker_card_not_held");
  assert.equal(battleErrorMessage("toString"), "toString");
});
