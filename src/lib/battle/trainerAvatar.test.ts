import assert from "node:assert/strict";
import test from "node:test";

import { trainerAvatarSvg } from "./trainerAvatar";

test("trainerAvatarSvg: same tier always produces byte-identical output", () => {
  const first = trainerAvatarSvg("epic");
  const second = trainerAvatarSvg("epic");
  assert.equal(first, second);
});

test("trainerAvatarSvg: different tiers produce different output", () => {
  const common = trainerAvatarSvg("common");
  const legendary = trainerAvatarSvg("legendary");
  assert.notEqual(common, legendary);
});

test("trainerAvatarSvg: returns a well-formed inline SVG string", () => {
  const svg = trainerAvatarSvg("rare");
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(svg.includes("viewBox"));
});

test("trainerAvatarSvg: is symmetric left-to-right within its 5x5 grid (an identicon property)", () => {
  const svg = trainerAvatarSvg("uncommon");
  const xs = [...svg.matchAll(/<rect x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(xs.length > 0, "expected at least one foreground cell");

  const CELL = 44 / 5;
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of xs) {
    const mirrorX = 4 * CELL - x;
    assert.equal(counts.get(mirrorX), counts.get(x), `column at x=${x} should mirror column at x=${mirrorX}`);
  }
});
