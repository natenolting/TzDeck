import assert from "node:assert/strict";
import test from "node:test";

import { objktClient } from "@/lib/objkt";
import { fetchBattleHoldingsPage, fetchBattleTokenMetadata } from "./holdings";

type ObjktClientStub = {
  request: (document: string, variables?: Record<string, unknown>) => Promise<unknown>;
};

function withObjktStub(stub: ObjktClientStub["request"], fn: () => Promise<void>): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

test("fetchBattleTokenMetadata: happy path derives editions and description length from real supply", async () => {
  await withObjktStub(
    async () => ({ token_holder: [{ quantity: 1, token: { supply: 5, description: "A short description." } }] }),
    async () => {
      const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "ok");
      if (result.status === "ok") {
        assert.equal(result.metadata.seed.editions, 5);
        assert.equal(result.metadata.source, "objkt");
      }
    },
  );
});

test("fetchBattleTokenMetadata: a missing supply never defaults to a valuable 1-of-1 seed", async () => {
  await withObjktStub(
    async () => ({ token_holder: [{ quantity: 1, token: { supply: null, description: null } }] }),
    async () => {
      const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "ok");
      if (result.status === "ok") {
        assert.ok(
          result.metadata.seed.editions > 1,
          "missing supply must fall back to a conservative (non-scarce) value, never 1",
        );
      }
    },
  );
});

test("fetchBattleTokenMetadata: a token still held by its own creator is self_minted, never battle-eligible", async () => {
  await withObjktStub(
    async () => ({
      token_holder: [
        {
          quantity: 1,
          token: { supply: 1, description: null, creators: [{ holder: { address: "tz1Wallet" } }] },
        },
      ],
    }),
    async () => {
      const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "self_minted");
    },
  );
});

test("fetchBattleTokenMetadata: a token created by someone else is battle-eligible", async () => {
  await withObjktStub(
    async () => ({
      token_holder: [
        {
          quantity: 1,
          token: { supply: 1, description: null, creators: [{ holder: { address: "tz1SomeoneElse" } }] },
        },
      ],
    }),
    async () => {
      const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "ok");
    },
  );
});

test("fetchBattleTokenMetadata: zero quantity is not_held", async () => {
  await withObjktStub(
    async () => ({ token_holder: [{ quantity: 0, token: { supply: 5, description: null } }] }),
    async () => {
      const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
      assert.equal(result.status, "not_held");
    },
  );
});

test("fetchBattleTokenMetadata: upstream failure is unavailable, never silently empty", async () => {
  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  try {
    await withObjktStub(
      async () => {
        throw new Error("OBJKT down");
      },
      async () => {
        const result = await fetchBattleTokenMetadata("tz1Wallet", "KT1Contract", "1");
        assert.equal(result.status, "unavailable");
      },
    );
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test("fetchBattleHoldingsPage: a full page is not marked complete, forcing a follow-up fetch", async () => {
  await withObjktStub(
    async () => ({
      token_holder: Array.from({ length: 100 }, (_, i) => ({
        quantity: 1,
        token: { fa_contract: "KT1Contract", token_id: String(i), supply: 10, description: null },
      })),
    }),
    async () => {
      const page = await fetchBattleHoldingsPage("tz1Wallet", null, 100);
      assert.equal(page.status, "ok");
      if (page.status === "ok") {
        assert.equal(page.cards.length, 100);
        assert.equal(page.complete, false, "an exact-page-size-multiple result must not be presented as complete");
        assert.equal(page.nextCursor, 100);
      }
    },
  );
});

test("fetchBattleHoldingsPage: a partial page (fewer than pageSize) is complete", async () => {
  await withObjktStub(
    async () => ({
      token_holder: Array.from({ length: 30 }, (_, i) => ({
        quantity: 1,
        token: { fa_contract: "KT1Contract", token_id: String(i), supply: 10, description: null },
      })),
    }),
    async () => {
      const page = await fetchBattleHoldingsPage("tz1Wallet", 100, 100);
      assert.equal(page.status, "ok");
      if (page.status === "ok") {
        assert.equal(page.cards.length, 30);
        assert.equal(page.complete, true);
        assert.equal(page.nextCursor, null);
      }
    },
  );
});

test("fetchBattleHoldingsPage: a self-minted, still-self-held card is excluded from the page, but still counted for pagination", async () => {
  await withObjktStub(
    async () => ({
      token_holder: [
        {
          quantity: 1,
          token: {
            fa_contract: "KT1Contract",
            token_id: "1",
            supply: 1,
            description: null,
            creators: [{ holder: { address: "tz1Wallet" } }],
          },
        },
        {
          quantity: 1,
          token: {
            fa_contract: "KT1Contract",
            token_id: "2",
            supply: 10,
            description: null,
            creators: [{ holder: { address: "tz1SomeoneElse" } }],
          },
        },
      ],
    }),
    async () => {
      const page = await fetchBattleHoldingsPage("tz1Wallet", null, 100);
      assert.equal(page.status, "ok");
      if (page.status === "ok") {
        assert.equal(page.cards.length, 1, "the self-minted card must never enter the battle pool");
        assert.equal(page.cards[0].tokenId, "2");
        // Only two rows came back from a page sized 100 -- genuinely complete,
        // not "complete" because filtering happened to shrink the count.
        assert.equal(page.complete, true);
      }
    },
  );
});

test("fetchBattleHoldingsPage: failure on a later page is unavailable, not a silently-short page", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withObjktStub(
      async () => {
        throw new Error("OBJKT down mid-traversal");
      },
      async () => {
        const page = await fetchBattleHoldingsPage("tz1Wallet", 100, 100);
        assert.equal(page.status, "unavailable");
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
});
