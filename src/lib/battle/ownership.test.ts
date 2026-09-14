import assert from "node:assert/strict";
import test from "node:test";

import { objktClient } from "@/lib/objkt";
import { verifyOwnership } from "./ownership";

type ObjktClientStub = {
  request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
};

function withObjktStub(
  stub: ObjktClientStub["request"],
  fn: () => Promise<void>,
): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

function withFetchStub(stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("verifyOwnership returns held when OBJKT reports a positive balance", async () => {
  await withObjktStub(
    async () => ({ token_holder: [{ quantity: 1 }] }),
    async () => {
      const result = await verifyOwnership("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "held");
      if (result.status === "held") assert.equal(result.source, "objkt");
    },
  );
});

test("verifyOwnership returns not_held when OBJKT confirms zero rows", async () => {
  await withObjktStub(
    async () => ({ token_holder: [] }),
    async () => {
      const result = await verifyOwnership("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "not_held");
    },
  );
});

test("verifyOwnership falls back to TzKT and reports held from a positive balance", async () => {
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  try {
    await withObjktStub(
      async () => {
        throw new Error("OBJKT unavailable");
      },
      () =>
        withFetchStub(
          (async () => new Response(JSON.stringify([{ balance: 2 }]), { status: 200 })) as typeof fetch,
          async () => {
            const result = await verifyOwnership("tz1Wallet", "KT1Contract", "1");
            assert.equal(result.status, "held");
            if (result.status === "held") assert.equal(result.source, "tzkt");
          },
        ),
    );
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test("verifyOwnership returns unverifiable when both OBJKT and TzKT fail -- never collapsed to not_held", async () => {
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await withObjktStub(
      async () => {
        throw new Error("OBJKT unavailable");
      },
      () =>
        withFetchStub(
          (async () => new Response("", { status: 503 })) as typeof fetch,
          async () => {
            const result = await verifyOwnership("tz1Wallet", "KT1Contract", "1");
            assert.equal(result.status, "unverifiable");
          },
        ),
    );
  } finally {
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
});
