import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOW_ALL,
  exclusionReason,
  partitionListings,
  type DenylistIndex,
  type FilterableListing,
} from "./pullFilter";

function listing(overrides: {
  id?: number;
  price?: number;
  pk?: number | null;
  flag?: string | null;
  live?: boolean | null;
  contract?: string;
  tokenId?: string;
  creatorFlags?: Array<string | null>;
  noCreators?: boolean;
} = {}): FilterableListing {
  const creators = overrides.noCreators
    ? undefined
    : (overrides.creatorFlags ?? ["none"]).map((flag) => ({
        holder: { address: "tz1Creator", flag },
      }));

  return {
    id: overrides.id ?? 1,
    price: overrides.price ?? 2_000_000,
    token: {
      pk: overrides.pk === undefined ? 100 : overrides.pk,
      flag: overrides.flag === undefined ? "none" : overrides.flag,
      token_id: overrides.tokenId ?? "1",
      fa_contract: overrides.contract ?? "KT1Clean",
      fa: { live: overrides.live === undefined ? true : overrides.live },
      creators,
    },
  };
}

function denylistOf(...keys: string[]): DenylistIndex {
  const set = new Set(keys);
  return {
    has: (contract, tokenId) => set.has(contract) || set.has(`${contract}:${tokenId}`),
  };
}

test("pullFilter: an eligible listing has no exclusion reason", () => {
  assert.equal(exclusionReason(listing(), ALLOW_ALL), null);
});

test("pullFilter: rule 1 excludes a token OBJKT has flagged", () => {
  assert.equal(exclusionReason(listing({ flag: "banned" }), ALLOW_ALL), "token_flag");
});

test("pullFilter: rule 2 excludes a token from a collection that is not live", () => {
  assert.equal(exclusionReason(listing({ live: false }), ALLOW_ALL), "fa_not_live");
});

test("pullFilter: rule 3 excludes a token when any creator is flagged", () => {
  assert.equal(
    exclusionReason(listing({ creatorFlags: ["none", "banned"] }), ALLOW_ALL),
    "creator_flag",
  );
});

test("pullFilter: rule 3 admits a token with no creators at all", () => {
  // No creator means no attribution to get wrong -- the card renders "Unknown Artist".
  assert.equal(exclusionReason(listing({ noCreators: true }), ALLOW_ALL), null);
});

test("pullFilter: rule 4 excludes a denylisted token", () => {
  const denylist = denylistOf("KT1Clean:7");
  assert.equal(exclusionReason(listing({ tokenId: "7" }), denylist), "denylist");
  assert.equal(exclusionReason(listing({ tokenId: "8" }), denylist), null);
});

test("pullFilter: rule 4 excludes every token of a denylisted contract", () => {
  const denylist = denylistOf("KT1Bad");
  assert.equal(exclusionReason(listing({ contract: "KT1Bad", tokenId: "99" }), denylist), "denylist");
});

test("pullFilter: an absent flag is excluded, not admitted", () => {
  assert.equal(exclusionReason(listing({ flag: null }), ALLOW_ALL), "token_flag");
});

test("pullFilter: an absent fa.live is excluded, not admitted", () => {
  assert.equal(exclusionReason(listing({ live: null }), ALLOW_ALL), "fa_not_live");
});

test("pullFilter: rule order is stable when several rules apply", () => {
  // Flagged AND denylisted -- rule 1 fires first, so `reason` stays stable for this token.
  const denylist = denylistOf("KT1Clean:1");
  assert.equal(exclusionReason(listing({ flag: "banned" }), denylist), "token_flag");
});

test("pullFilter: partitionListings splits rows and preserves input order", () => {
  const rows = [
    listing({ id: 1, tokenId: "1" }),
    listing({ id: 2, tokenId: "2", flag: "banned", pk: 202 }),
    listing({ id: 3, tokenId: "3" }),
  ];

  const { eligible, excluded } = partitionListings(rows, ALLOW_ALL);

  assert.deepEqual(eligible.map((row) => row.id), [1, 3]);
  assert.deepEqual(excluded, [
    { faContract: "KT1Clean", tokenId: "2", tokenPk: 202, reason: "token_flag" },
  ]);
});

test("pullFilter: partitionListings reports a null pk rather than dropping the record", () => {
  const { excluded } = partitionListings([listing({ pk: null, flag: "banned" })], ALLOW_ALL);
  assert.equal(excluded[0].tokenPk, null);
});
