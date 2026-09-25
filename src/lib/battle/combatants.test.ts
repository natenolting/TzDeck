import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { objktClient } from "@/lib/objkt";
import { requireBothStillHeld } from "./combatants";
import { AttemptRejection } from "./failures";
import type { Combatant } from "./rules";

const ATTACKER: Combatant = { wallet: "tz1Attacker", cardKey: "KT1a:1", seed: { editions: 5, descriptionLength: 0 }, level: 1 };
const DEFENDER: Combatant = { wallet: "tz1Defender", cardKey: "KT1d:2", seed: { editions: 5, descriptionLength: 0 }, level: 1 };

type Request = typeof objktClient.request;
const originalRequest = objktClient.request;

afterEach(() => {
  objktClient.request = originalRequest;
});

function holdings(held: Record<string, boolean>, onRequest: () => Promise<void> = async () => undefined): Request {
  return (async (_document: unknown, variables?: { address?: string }) => {
    await onRequest();
    return { token_holder: held[variables?.address ?? ""] ? [{ quantity: 1 }] : [] };
  }) as unknown as Request;
}

test("requireBothStillHeld checks both cards at the same time", async () => {
  let inFlight = 0;
  let mostInFlight = 0;
  objktClient.request = holdings({ tz1Attacker: true, tz1Defender: true }, async () => {
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
  });

  await requireBothStillHeld(ATTACKER, DEFENDER);

  assert.equal(mostInFlight, 2);
});

test("requireBothStillHeld names the attacker when neither card is held", async () => {
  objktClient.request = holdings({});
  await assert.rejects(requireBothStillHeld(ATTACKER, DEFENDER), (error) => {
    assert.ok(error instanceof AttemptRejection);
    assert.equal(error.code, "attacker_card_not_held");
    return true;
  });
});

test("requireBothStillHeld names the defender when only the defender's card is gone", async () => {
  objktClient.request = holdings({ tz1Attacker: true });
  await assert.rejects(requireBothStillHeld(ATTACKER, DEFENDER), (error) => {
    assert.ok(error instanceof AttemptRejection);
    assert.equal(error.code, "defender_card_not_held");
    return true;
  });
});
