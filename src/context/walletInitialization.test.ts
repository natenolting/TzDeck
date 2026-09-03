import assert from "node:assert/strict";
import test from "node:test";

import { runWalletInitialization } from "./walletInitialization";

test("wallet initialization ignores results after unmount", async () => {
  let mounted = true;
  let resolveInitialization: ((value: string) => void) | undefined;
  let readyValue: string | undefined;
  const initialization = new Promise<string>((resolve) => {
    resolveInitialization = resolve;
  });

  const pending = runWalletInitialization({
    initialize: () => initialization,
    isMounted: () => mounted,
    onReady: (value) => {
      readyValue = value;
    },
    onError: () => assert.fail("Initialization should not fail"),
  });

  mounted = false;
  resolveInitialization?.("connected");
  await pending;

  assert.equal(readyValue, undefined);
});

test("wallet initialization reports errors while mounted", async () => {
  const expectedError = new Error("Beacon storage unavailable");
  let receivedError: unknown;

  await runWalletInitialization({
    initialize: async () => {
      throw expectedError;
    },
    isMounted: () => true,
    onReady: () => assert.fail("Initialization should not succeed"),
    onError: (error) => {
      receivedError = error;
    },
  });

  assert.equal(receivedError, expectedError);
});
