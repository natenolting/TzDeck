import assert from "node:assert/strict";
import test from "node:test";

import { bytesToSign, getPublicProtocolInfo } from "./auth";
import { bytesToSignInBrowser, type NonceEnvelope } from "./signPayload";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

test("bytesToSignInBrowser produces byte-identical output to the server's bytesToSign", async () => {
  const envelope: NonceEnvelope = { timestamp: 1_700_000_000_000, random: "abc123", mac: "deadbeef" };
  const { appId, protocolVersion } = getPublicProtocolInfo();
  const params = ["KT1Contract:1", "tz1Target", 42, true];

  const serverBytes = bytesToSign(envelope, "challenge", params);
  const browserBytes = await bytesToSignInBrowser(envelope, protocolVersion, appId, "challenge", params);

  assert.equal(browserBytes, serverBytes);
});
