import assert from "node:assert/strict";
import test from "node:test";

import { parseCardRef, shareLink } from "./share";

const CONTRACT = "KT1FxbWmoiGmsyeUih4D6GPFFeAcb4J6nNwp";

test("parseCardRef accepts a KT1 address and a decimal token id", () => {
  assert.deepEqual(parseCardRef(CONTRACT, "55"), {
    contract: CONTRACT,
    tokenId: "55",
    __brand: "CardRef",
  });
});

test("parseCardRef accepts token id zero", () => {
  assert.equal(parseCardRef(CONTRACT, "0")?.tokenId, "0");
});

test("parseCardRef rejects a malformed contract", () => {
  assert.equal(parseCardRef("tz1FxbWmoiGmsyeUih4D6GPFFeAcb4J6nNwp", "55"), null);
  assert.equal(parseCardRef(CONTRACT.slice(0, -1), "55"), null);
  assert.equal(parseCardRef(`${CONTRACT}x`, "55"), null);
  // 0, O, I and l are outside base58 and so outside any real address.
  assert.equal(parseCardRef("KT10xbWmoiGmsyeUih4D6GPFFeAcb4J6nNwp", "55"), null);
  assert.equal(parseCardRef("", "55"), null);
});

test("parseCardRef rejects a non-numeric token id", () => {
  assert.equal(parseCardRef(CONTRACT, "abc"), null);
  assert.equal(parseCardRef(CONTRACT, "1e3"), null);
  assert.equal(parseCardRef(CONTRACT, "-1"), null);
  assert.equal(parseCardRef(CONTRACT, "1.0"), null);
  assert.equal(parseCardRef(CONTRACT, ""), null);
  // Leading zeros are a second URL for one card, so they are not canonical.
  assert.equal(parseCardRef(CONTRACT, "007"), null);
});

test("parseCardRef rejects path traversal in either segment", () => {
  assert.equal(parseCardRef("../../etc/passwd", "55"), null);
  assert.equal(parseCardRef(CONTRACT, "../../etc/passwd"), null);
  assert.equal(parseCardRef(CONTRACT, "55/../54"), null);
  assert.equal(parseCardRef(`${CONTRACT}/..`, "55"), null);
});

test("shareLink is the absolute card URL and nothing else", () => {
  assert.equal(
    shareLink({ contract_address: CONTRACT, token_id: "55" }),
    "https://tzdeck.xyz/c/KT1FxbWmoiGmsyeUih4D6GPFFeAcb4J6nNwp/55",
  );
});

