import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySigner } from "@taquito/signer";

import { objktClient } from "@/lib/objkt";
import { issueNonce, getPublicProtocolInfo } from "./auth";
import { bytesToSign, computeParamHash, type NonceEnvelope } from "./signPayload";
import { authenticateAndClaim, type SignedRequestBody } from "./requestAuth";
import { ensureWalletExists, getSql, reclaimAttempt, startOrResumeHoldingsSync } from "./store";
import { INVOCATION_DEADLINE_MS, runBoundedHoldingsSync } from "./holdingsSync";

process.env.BATTLE_AUTH_SECRET ||= "test-secret-do-not-use-in-production";
process.env.BATTLE_APP_ID ||= "tzdeck-test";

const MNEMONIC = "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/1729'/22'/0'";

type ObjktClientStub = { request: (document: string, variables?: Record<string, unknown>) => Promise<unknown> };

function withObjktStub(stub: ObjktClientStub["request"], fn: () => Promise<void>): Promise<void> {
  const client = objktClient as unknown as ObjktClientStub;
  const original = client.request;
  client.request = stub;
  return fn().finally(() => {
    client.request = original;
  });
}

async function testSigner() {
  const signer = await InMemorySigner.fromMnemonic({ mnemonic: MNEMONIC, derivationPath: DERIVATION_PATH });
  return { signer, publicKey: await signer.publicKey(), address: await signer.publicKeyHash() };
}

async function claimAttempt(
  signer: Awaited<ReturnType<typeof testSigner>>["signer"],
  publicKey: string,
  address: string,
): Promise<{ nonce: string; generation: string }> {
  const envelope: NonceEnvelope = issueNonce();
  const bytes = await bytesToSign(envelope, getPublicProtocolInfo(), "refresh", []);
  const { prefixSig } = await signer.sign(bytes);
  const body: SignedRequestBody = { envelope, publicKey, signature: prefixSig, claimedAddress: address };
  const auth = await authenticateAndClaim(body, "refresh", []);
  if (auth.outcome !== "claimed") throw new Error(`expected a fresh claim, got ${auth.outcome}`);
  return { nonce: auth.nonce, generation: auth.generation };
}

async function cleanupWallet(wallet: string) {
  const sql = getSql();
  await sql`DELETE FROM holdings_syncs WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_holdings WHERE wallet = ${wallet}`;
  await sql`DELETE FROM battle_attempts WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallet_card_progress WHERE wallet = ${wallet}`;
  await sql`DELETE FROM wallets WHERE address = ${wallet}`;
}

function tokenHolderRow(contract: string, tokenId: number, supply = 5) {
  return { quantity: 1, token: { fa_contract: contract, token_id: String(tokenId), supply, description: "" } };
}

test("runBoundedHoldingsSync: a full-page collection well within budget completes in one invocation", async () => {
  const { signer, publicKey, address } = await testSigner();
  try {
    await ensureWalletExists(address);
    const { nonce, generation } = await claimAttempt(signer, publicKey, address);
    const syncId = `sync:${nonce}`;
    const sync = await startOrResumeHoldingsSync(syncId, address, nonce, generation, 1);

    const TOTAL_CARDS = 120; // 2 pages
    const stub = async (_doc: string, variables?: Record<string, unknown>) => {
      const offset = Number(variables?.offset ?? 0);
      const remaining = Math.max(0, TOTAL_CARDS - offset);
      const count = Math.min(100, remaining);
      return { token_holder: Array.from({ length: count }, (_, i) => tokenHolderRow("KT1Fast", offset + i)) };
    };

    let result: Awaited<ReturnType<typeof runBoundedHoldingsSync>> | undefined;
    await withObjktStub(stub, async () => {
      result = await runBoundedHoldingsSync({
        nonce,
        generation,
        wallet: address,
        syncId,
        initialCursor: sync.cursor ? Number(sync.cursor) : null,
        initialComplete: sync.status === "complete",
        deadline: Date.now() + INVOCATION_DEADLINE_MS,
      });
    });

    assert.deepEqual(result, { outcome: "complete" });
  } finally {
    await cleanupWallet(address);
  }
});

test("runBoundedHoldingsSync: elapsed time, not just page count, bounds work -- slow-but-successful pages continue before the deadline", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await ensureWalletExists(address);
    const { nonce, generation } = await claimAttempt(signer, publicKey, address);
    const syncId = `sync:${nonce}`;
    const sync = await startOrResumeHoldingsSync(syncId, address, nonce, generation, 1);

    // 4 pages (the MAX_PAGES_PER_INVOCATION bound) would normally all run in
    // one invocation, but each one here "takes" 7s of the fake clock -- by
    // the 3rd page there isn't enough of the 18s budget left for a 4th
    // (whose worst case is the real 8s upstream timeout + reserve), so this
    // must stop and release for continuation instead of attempting it.
    const TOTAL_CARDS = 4 * 100; // exactly 4 full pages if page-count were the only bound
    let fakeNow = 0;
    const deadline = INVOCATION_DEADLINE_MS;
    let pageCalls = 0;
    const stub = async (_doc: string, variables?: Record<string, unknown>) => {
      pageCalls += 1;
      fakeNow += 7_000; // simulate a slow-but-successful upstream page fetch
      const offset = Number(variables?.offset ?? 0);
      const remaining = Math.max(0, TOTAL_CARDS - offset);
      const count = Math.min(100, remaining);
      return { token_holder: Array.from({ length: count }, (_, i) => tokenHolderRow("KT1Slow", offset + i)) };
    };

    let result: Awaited<ReturnType<typeof runBoundedHoldingsSync>> | undefined;
    await withObjktStub(stub, async () => {
      result = await runBoundedHoldingsSync({
        nonce,
        generation,
        wallet: address,
        syncId,
        initialCursor: sync.cursor ? Number(sync.cursor) : null,
        initialComplete: sync.status === "complete",
        deadline,
        now: () => fakeNow,
      });
    });

    assert.deepEqual(result, { outcome: "continue" });
    assert.equal(pageCalls, 2, "stops after the 2nd page -- a 3rd would risk exceeding the deadline before it could finish");

    const staged = await sql`SELECT cursor, status FROM holdings_syncs WHERE sync_id = ${syncId}`;
    assert.equal(staged[0].status, "in_progress", "the two completed pages' progress is preserved, not discarded");
  } finally {
    await cleanupWallet(address);
  }
});

test("runBoundedHoldingsSync: a fully staged sync with too little time left to promote still continues, not a partial promotion", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await ensureWalletExists(address);
    const { nonce, generation } = await claimAttempt(signer, publicKey, address);
    const syncId = `sync:${nonce}`;
    const sync = await startOrResumeHoldingsSync(syncId, address, nonce, generation, 1);

    const TOTAL_CARDS = 50; // 1 page, completes the traversal
    let fakeNow = 0;
    const deadline = 10_000; // enough for the one page's worst case, not enough left over to promote after it
    const stub = async (_doc: string, variables?: Record<string, unknown>) => {
      fakeNow += 8_500; // this page nearly exhausts the upstream timeout, leaving under PROMOTION_RESERVE_MS
      const offset = Number(variables?.offset ?? 0);
      const remaining = Math.max(0, TOTAL_CARDS - offset);
      return { token_holder: Array.from({ length: remaining }, (_, i) => tokenHolderRow("KT1Tight", offset + i)) };
    };

    let result: Awaited<ReturnType<typeof runBoundedHoldingsSync>> | undefined;
    await withObjktStub(stub, async () => {
      result = await runBoundedHoldingsSync({
        nonce,
        generation,
        wallet: address,
        syncId,
        initialCursor: sync.cursor ? Number(sync.cursor) : null,
        initialComplete: sync.status === "complete",
        deadline,
        now: () => fakeNow,
      });
    });

    assert.deepEqual(result, { outcome: "continue" });
    const staged = await sql`SELECT status FROM holdings_syncs WHERE sync_id = ${syncId}`;
    assert.equal(staged[0].status, "complete", "the traversal itself is fully staged");
  } finally {
    await cleanupWallet(address);
  }
});

test("runBoundedHoldingsSync: resuming after a time-bounded continuation picks up from the exact saved cursor", async () => {
  const { signer, publicKey, address } = await testSigner();
  const sql = getSql();
  try {
    await ensureWalletExists(address);
    const { nonce, generation } = await claimAttempt(signer, publicKey, address);
    const syncId = `sync:${nonce}`;
    const firstSync = await startOrResumeHoldingsSync(syncId, address, nonce, generation, 1);

    const TOTAL_CARDS = 250; // 3 pages
    let fakeNow = 0;
    const stub = async (_doc: string, variables?: Record<string, unknown>) => {
      fakeNow += 7_000;
      const offset = Number(variables?.offset ?? 0);
      const remaining = Math.max(0, TOTAL_CARDS - offset);
      const count = Math.min(100, remaining);
      return { token_holder: Array.from({ length: count }, (_, i) => tokenHolderRow("KT1Resume", offset + i)) };
    };

    await withObjktStub(stub, async () => {
      const first = await runBoundedHoldingsSync({
        nonce,
        generation,
        wallet: address,
        syncId,
        initialCursor: firstSync.cursor ? Number(firstSync.cursor) : null,
        initialComplete: firstSync.status === "complete",
        deadline: INVOCATION_DEADLINE_MS,
        now: () => fakeNow,
      });
      assert.deepEqual(first, { outcome: "continue" });

      // A resumed invocation reclaims the released lease under a new
      // generation (the same fencing a real resubmitted request goes
      // through via authenticateAndClaim) and looks up the same sync row by
      // syncId, continuing from its saved cursor with a fresh time budget.
      const reclaimed = await reclaimAttempt(nonce, {
        wallet: address,
        action: "refresh",
        paramHash: await computeParamHash([]),
      });
      if (!reclaimed) throw new Error("expected the released lease to be reclaimable");
      const resumedSync = await startOrResumeHoldingsSync(syncId, address, nonce, reclaimed.generation, 1);
      fakeNow = 0;
      const second = await runBoundedHoldingsSync({
        nonce,
        generation: reclaimed.generation,
        wallet: address,
        syncId,
        initialCursor: resumedSync.cursor ? Number(resumedSync.cursor) : null,
        initialComplete: resumedSync.status === "complete",
        deadline: INVOCATION_DEADLINE_MS,
        now: () => fakeNow,
      });
      assert.deepEqual(second, { outcome: "complete" });
    });

    const holdings = await sql`SELECT card_key FROM wallet_holdings WHERE wallet = ${address}`;
    assert.equal(holdings.length, 0, "runBoundedHoldingsSync stages but never promotes -- promotion is the route's own step");
    const stagedCount = await sql`SELECT jsonb_array_length(staged_cards) AS n FROM holdings_syncs WHERE sync_id = ${syncId}`;
    assert.equal(Number(stagedCount[0].n), TOTAL_CARDS, "resuming completed the full traversal across both invocations");
  } finally {
    await cleanupWallet(address);
  }
});
