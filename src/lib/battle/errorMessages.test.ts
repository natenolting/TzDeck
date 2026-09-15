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

test("battleErrorMessage returns an unmapped code unchanged", () => {
  assert.equal(battleErrorMessage("missing_required_fields"), "missing_required_fields");
  assert.equal(battleErrorMessage("toString"), "toString");
});
