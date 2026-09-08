import assert from "node:assert/strict";
import test from "node:test";

import { previewStatsForCard, recoveryCopy, resubmitWhilePending } from "./BattlePanel";
import { baseStatsFromSeed, deriveBaseSeed } from "@/lib/battle/rules";

test("recoveryCopy explains the offensive-vs-defensive recovery distinction rather than showing a raw enum", () => {
  assert.match(recoveryCopy("defensive"), /defensive loss/i);
  assert.match(recoveryCopy("defensive"), /shorter/i);
  assert.match(recoveryCopy("offensive"), /offensive loss/i);
  assert.equal(recoveryCopy(null), "");
});

test("previewStatsForCard matches the server's own seed derivation for the same inputs", () => {
  const editions = 12;
  const description = "A hand-painted study of light on water.";
  const expected = baseStatsFromSeed(deriveBaseSeed(editions, description));
  assert.deepEqual(previewStatsForCard({ editions, description }), { power: expected.power, hp: expected.hp });
});

test("previewStatsForCard returns null rather than a fabricated number when editions isn't loaded", () => {
  assert.equal(previewStatsForCard({ editions: undefined, description: "irrelevant" }), null);
});

function statusResponse(status: number): Response {
  return new Response(null, { status });
}

test("resubmitWhilePending resolves immediately when the first response isn't 202, without ever waiting", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return statusResponse(200);
  };
  let waitCalls = 0;
  const wait = async () => {
    waitCalls += 1;
  };

  const result = await resubmitWhilePending(post, 50, 300, wait);
  assert.equal(result.timedOut, false);
  assert.equal(result.response.status, 200);
  assert.equal(postCalls, 1, "a settled first response must not trigger a resubmission");
  assert.equal(waitCalls, 0);
});

test("resubmitWhilePending resubmits the identical body while pending, until a non-202 response arrives", async () => {
  const statuses = [202, 202, 200];
  let postCalls = 0;
  const post = async () => {
    const status = statuses[postCalls];
    postCalls += 1;
    return statusResponse(status);
  };
  const delays: number[] = [];
  const wait = async (ms: number) => {
    delays.push(ms);
  };

  const result = await resubmitWhilePending(post, 50, 300, wait);
  assert.equal(result.timedOut, false);
  assert.equal(result.response.status, 200);
  assert.equal(postCalls, 3, "must post once per 202 plus the settling call");
  assert.deepEqual(delays, [300, 300], "must wait pollDelayMs before each resubmission, no backoff");
});

test("resubmitWhilePending gives up after maxAttempts resubmissions rather than resubmitting forever", async () => {
  let postCalls = 0;
  const post = async () => {
    postCalls += 1;
    return statusResponse(202); // never settles
  };
  let waitCalls = 0;
  const wait = async () => {
    waitCalls += 1;
  };

  const result = await resubmitWhilePending(post, 2, 300, wait);
  assert.equal(result.timedOut, true);
  assert.equal(result.response.status, 202, "the last-seen response is still returned so the caller can inspect it");
  assert.equal(postCalls, 3, "the initial post plus exactly maxAttempts resubmissions, never more");
  assert.equal(waitCalls, 2);
});
