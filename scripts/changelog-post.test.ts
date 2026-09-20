import assert from "node:assert/strict";
import test from "node:test";

import { extractUpdate, stripCommitPrefix, toEmbed, type MergedPull } from "./changelog-post";

const PULL: MergedPull = {
  number: 87,
  title: "Give every card a URL, a link preview, and a share button",
  body: "",
  author: "natenolting",
  url: "https://github.com/natenolting/TzDeck/pull/87",
  mergedAt: "2026-09-19T14:03:11Z",
  filesChanged: 12,
  additions: 340,
  deletions: 58,
};

test("changelog-post: extractUpdate returns the section text", () => {
  assert.equal(
    extractUpdate("## Summary\n\nInternal notes.\n\n## Update\n\nBooster packs now skip flagged tokens.\n"),
    "Booster packs now skip flagged tokens.",
  );
});

test("changelog-post: extractUpdate stops at the next heading of the same level", () => {
  assert.equal(
    extractUpdate("## Update\n\nCards have share buttons now.\n\n## Testing\n\nRan the suite.\n"),
    "Cards have share buttons now.",
  );
});

test("changelog-post: extractUpdate keeps a deeper heading inside the section", () => {
  assert.equal(
    extractUpdate("## Update\n\nTwo things changed.\n\n### Battles\n\nTrainers award less XP.\n\n## Testing\n\nRan the suite.\n"),
    "Two things changed.\n\n### Battles\n\nTrainers award less XP.",
  );
});

test("changelog-post: extractUpdate strips the attribution line and Co-Authored-By trailers", () => {
  assert.equal(
    extractUpdate(
      "## Update\n\nThe footer lost its Instagram link.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n",
    ),
    "The footer lost its Instagram link.",
  );
});

test("changelog-post: extractUpdate returns null when the section is absent", () => {
  assert.equal(extractUpdate("## Summary\n\nRefactored the pack builder.\n"), null);
});

test("changelog-post: extractUpdate returns null when the section is empty once stripped", () => {
  assert.equal(
    extractUpdate("## Update\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\n## Testing\n\nRan the suite.\n"),
    null,
  );
});

test("changelog-post: extractUpdate ignores an Update heading quoted in a code fence", () => {
  assert.equal(
    extractUpdate(
      "## Summary\n\nThe convention looks like this:\n\n```markdown\n## Update\n\nThe example nobody meant to publish.\n```\n\n## Update\n\nTrainers award less XP below level ten.\n",
    ),
    "Trainers award less XP below level ten.",
  );
});

test("changelog-post: extractUpdate does not end the section at a heading inside a fence", () => {
  assert.equal(
    extractUpdate("## Update\n\nPack odds changed.\n\n```\n## not a heading\n```\n\n## Testing\n\nRan the suite.\n"),
    "Pack odds changed.\n\n```\n## not a heading\n```",
  );
});

test("changelog-post: stripCommitPrefix removes a scoped prefix and capitalises", () => {
  assert.equal(
    stripCommitPrefix("feat(pull): keep flagged tokens out of booster packs"),
    "Keep flagged tokens out of booster packs",
  );
});

test("changelog-post: stripCommitPrefix removes a bare prefix", () => {
  assert.equal(stripCommitPrefix("chore: ignore the agent scratch directory"), "Ignore the agent scratch directory");
});

test("changelog-post: stripCommitPrefix leaves a title with no prefix untouched", () => {
  assert.equal(
    stripCommitPrefix("Drop the Instagram link from the footer"),
    "Drop the Instagram link from the footer",
  );
});

test("changelog-post: toEmbed builds the footer from the pull request's counts", () => {
  const embed = toEmbed(PULL, { text: "Every card has its own link now.", source: "update-section" });

  assert.deepEqual(embed, {
    title: "Give every card a URL, a link preview, and a share button",
    url: "https://github.com/natenolting/TzDeck/pull/87",
    description: "Every card has its own link now.",
    color: 0x6366f1,
    footer: { text: "#87 by natenolting · 12 files changed, +340 −58" },
    timestamp: "2026-09-19T14:03:11Z",
  });
});

test("changelog-post: toEmbed says 'file' when exactly one file changed", () => {
  const embed = toEmbed({ ...PULL, filesChanged: 1, additions: 2, deletions: 0 }, { text: "A typo.", source: "pull-title" });

  assert.equal(embed.footer.text, "#87 by natenolting · 1 file changed, +2 −0");
});

test("changelog-post: toEmbed truncates an over-long title and description", () => {
  const embed = toEmbed({ ...PULL, title: "a".repeat(300) }, { text: "b".repeat(5000), source: "update-section" });

  assert.equal(embed.title, `${"a".repeat(255)}…`);
  assert.equal(embed.description, `${"b".repeat(4095)}…`);
});
