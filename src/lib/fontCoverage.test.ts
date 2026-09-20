import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { coversText, readCodepointCoverage } from "./fontCoverage";

/** The font the OG card actually loads, so the assertions below describe what ships. */
const oxanium = new Uint8Array(
  readFileSync(path.join(process.cwd(), "assets/og/Oxanium-Regular.ttf")),
);
const coverage = readCodepointCoverage(oxanium);

test("the vendored font's cmap parses into real ranges", () => {
  assert.ok(coverage.length > 0, "empty coverage means the cmap format went unread");
  assert.equal(coversText(coverage, "A"), true);
  assert.equal(coversText(coverage, "é"), true);
});

test("a Latin token name and artist render as themselves", () => {
  assert.equal(coversText(coverage, "Evil Eye Candle Therapy"), true);
  assert.equal(coversText(coverage, "Marie & Laveau"), true);
  assert.equal(coversText(coverage, "600 tez · 1 edition"), true);
});

// This is why the OG card spells the price "600 tez" where the HTML page,
// which has a browser's system fallback behind it, can print the tez sign.
test("the tez sign is outside the vendored font", () => {
  assert.equal(coversText(coverage, "ꜩ"), false);
});

test("Persian, Cyrillic and CJK names are reported as unrenderable", () => {
  assert.equal(coversText(coverage, "گل"), false);
  assert.equal(coversText(coverage, "Закат"), false);
  assert.equal(coversText(coverage, "漢字"), false);
});

test("one unrenderable character condemns the whole string", () => {
  assert.equal(coversText(coverage, "Sunset 漢"), false);
});

test("emoji do not need font coverage, because next/og draws them itself", () => {
  assert.equal(coversText(coverage, "Sunset \u{1f305}"), true);
  assert.equal(coversText(coverage, "❤️"), true);
});

test("a font with no readable cmap covers nothing rather than claiming everything", () => {
  assert.deepEqual(readCodepointCoverage(new Uint8Array(64)), []);
  assert.equal(coversText([], "A"), false);
});
