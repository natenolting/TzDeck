import assert from "node:assert/strict";
import test from "node:test";

import { parseDenylistArgs } from "./denylist-args";

test("denylist-args: add with a token id", () => {
  assert.deepEqual(
    parseDenylistArgs(["--add", "KT1Abc", "--token", "42", "--reason", "impersonation"]),
    { kind: "add", faContract: "KT1Abc", tokenId: "42", reason: "impersonation" },
  );
});

test("denylist-args: add without a token id denylists the whole contract", () => {
  assert.deepEqual(
    parseDenylistArgs(["--add", "KT1Abc", "--reason", "confirmed bad"]),
    { kind: "add", faContract: "KT1Abc", tokenId: null, reason: "confirmed bad" },
  );
});

test("denylist-args: remove", () => {
  assert.deepEqual(
    parseDenylistArgs(["--remove", "KT1Abc", "--token", "42"]),
    { kind: "remove", faContract: "KT1Abc", tokenId: "42" },
  );
});

test("denylist-args: list", () => {
  assert.deepEqual(parseDenylistArgs(["--list"]), { kind: "list" });
});

test("denylist-args: add requires a reason", () => {
  assert.throws(
    () => parseDenylistArgs(["--add", "KT1Abc"]),
    /--reason is required/,
  );
});

test("denylist-args: a contract address must look like one", () => {
  assert.throws(
    () => parseDenylistArgs(["--add", "tz1NotAContract", "--reason", "x"]),
    /must be a KT1 contract address/,
  );
});

test("denylist-args: no command is an error", () => {
  assert.throws(() => parseDenylistArgs([]), /one of --add, --remove, --list/);
});
