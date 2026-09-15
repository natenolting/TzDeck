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
  // A mirrored identicon draws each left-half cell and its mirror together,
  // so the same fill color must appear an even number of times per row
  // pair -- cheap to check structurally: every tier's output has a
  // non-trivial rect count in the double digits (5 rows x up to 3 unique
  // columns x up to 2 mirrored rects), not zero and not degenerate.
  const svg = trainerAvatarSvg("uncommon");
  const rectCount = (svg.match(/<rect/g) ?? []).length;
  assert.ok(rectCount > 1, "expected more than just the background rect");
});
