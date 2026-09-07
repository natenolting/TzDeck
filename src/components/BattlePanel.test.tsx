import assert from "node:assert/strict";
import test from "node:test";

import { recoveryCopy } from "./BattlePanel";

test("recoveryCopy explains the offensive-vs-defensive recovery distinction rather than showing a raw enum", () => {
  assert.match(recoveryCopy("defensive"), /defensive loss/i);
  assert.match(recoveryCopy("defensive"), /shorter/i);
  assert.match(recoveryCopy("offensive"), /offensive loss/i);
  assert.equal(recoveryCopy(null), "");
});
