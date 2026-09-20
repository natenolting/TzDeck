// Courier for the Discord updates channel. The announcement is written by
// whoever opens the pull request, as a `## Update` section in its description.
// Nothing here writes prose -- it carries what a human already wrote -- so a
// run costs nothing and needs no key beyond the token Actions already hands it.
//
// Driven by .github/workflows/discord-updates.yml once CI goes green on main,
// or by hand: npm run changelog -- --pr <number> [--dry-run]
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Everything a post needs about one merged PR. Assembled from the GitHub API. */
export type MergedPull = {
  number: number;
  title: string;
  body: string;       // "" when the PR had no description
  author: string;     // login
  url: string;        // html_url
  mergedAt: string;   // ISO 8601
  filesChanged: number;
  additions: number;
  deletions: number;
};

/** The announcement text and where it came from, so a post is never ambiguous
 *  about whether a human actually wrote it. */
export type UpdateNote = {
  text: string;
  source: "update-section" | "pull-title";
};

export type DiscordEmbed = {
  title: string;
  url: string;
  description: string;
  color: number;
  footer: { text: string };
  timestamp: string;
};

/** Which pull request to post. A union rather than two optional fields, so
 *  "both given" and "neither given" die in the argument parser. */
type PullRef = { kind: "sha"; sha: string } | { kind: "number"; number: number };

/** `--accent` from src/app/globals.css, so the embed's stripe matches the site. */
const ACCENT_COLOR = 0x6366f1;

// Discord's documented embed limits.
const TITLE_LIMIT = 256;
const DESCRIPTION_LIMIT = 4096;

const HEADING = /^(#{1,6})\s+(.*)$/;
const ATTRIBUTION = /^\s*(?:🤖\s*)?generated with\b/iu;
const COAUTHOR_TRAILER = /^\s*co-authored-by:/i;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * The standard conventional-commit types, kept closed on purpose. An open
 * `\w+:` pattern would eat the first word of a title like "Note: read this".
 */
const COMMIT_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];

const COMMIT_PREFIX = new RegExp(`^(?:${COMMIT_TYPES.join("|")})(?:\\([^)]*\\))?!?:\\s+`, "i");

/** `## Update` or `### Update`, any casing. Other depths are ordinary body text. */
function isUpdateHeading(hashes: string, text: string): boolean {
  return (hashes.length === 2 || hashes.length === 3) && text.trim().toLowerCase() === "update";
}

/**
 * Cuts on a character boundary rather than a UTF-16 code unit. PR titles carry
 * emoji, and halving one sends Discord a lone surrogate.
 */
function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters.slice(0, limit - 1).join("")}…`;
}

/**
 * Pulls the `## Update` section out of a pull request body.
 *
 * The section runs to the next heading of the same or higher level, so a
 * `## Update` keeps its own `###` subheadings while a `### Update` stops at the
 * `###` after it. Claude Code's attribution line and any Co-Authored-By
 * trailers come out: they are addressed to reviewers, not to players.
 *
 * Headings inside a fenced code block do not count. README.md documents this
 * convention with a fenced `## Update` example, so a pull request that quotes
 * it would otherwise announce the example instead of its own section.
 *
 * Returns null when the section is absent, or present but empty once stripped.
 */
export function extractUpdate(body: string): string | null {
  let level: number | null = null;
  let inFence = false;
  const section: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);

    if (level === null) {
      if (heading && isUpdateHeading(heading[1], heading[2])) level = heading[1].length;
      continue;
    }

    if (heading && heading[1].length <= level) break;
    if (ATTRIBUTION.test(line) || COAUTHOR_TRAILER.test(line)) continue;
    section.push(line);
  }

  if (level === null) return null;
  const text = section.join("\n").trim();
  return text === "" ? null : text;
}

/**
 * Turns "feat(pull): keep flagged tokens out of booster packs" into "Keep
 * flagged tokens out of booster packs". A title with no prefix comes back
 * untouched, its capitalisation included, because someone chose it.
 */
export function stripCommitPrefix(title: string): string {
  const stripped = title.replace(COMMIT_PREFIX, "");
  if (stripped === title) return title;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Prefers what a human wrote. The title is the floor, never a failure. */
export function updateNote(pull: MergedPull): UpdateNote {
  const section = extractUpdate(pull.body);
  if (section !== null) return { text: section, source: "update-section" };
  return { text: stripCommitPrefix(pull.title), source: "pull-title" };
}

export function toEmbed(pull: MergedPull, note: UpdateNote): DiscordEmbed {
  const files = pull.filesChanged === 1 ? "1 file changed" : `${pull.filesChanged} files changed`;
  const footer = `#${pull.number} by ${pull.author} · ${files}, +${pull.additions} −${pull.deletions}`;

  return {
    title: truncate(pull.title, TITLE_LIMIT),
    url: pull.url,
    description: truncate(note.text, DESCRIPTION_LIMIT),
    color: ACCENT_COLOR,
    footer: { text: footer },
    timestamp: pull.mergedAt,
  };
}

/** The documented subset of a pull request this script reads. Fields GitHub
 *  documents as nullable stay nullable here, and are resolved on the way in. */
type PullResponse = {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  html_url: string;
  merged_at: string | null;
  changed_files: number;
  additions: number;
  deletions: number;
};

async function githubGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "tzdeck-changelog-post",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** null when the commit was pushed straight to main rather than merged. */
async function pullNumberForCommit(repo: string, sha: string, token: string): Promise<number | null> {
  const pulls = await githubGet<{ number: number }[]>(`/repos/${repo}/commits/${sha}/pulls`, token);
  return pulls[0]?.number ?? null;
}

async function fetchMergedPull(repo: string, ref: PullRef, token: string): Promise<MergedPull | null> {
  const number = ref.kind === "number" ? ref.number : await pullNumberForCommit(repo, ref.sha, token);
  if (number === null) return null;

  // The detail endpoint carries changed_files, additions and deletions, so
  // /files stays unfetched -- it pages, and a large PR would cost several calls.
  const pull = await githubGet<PullResponse>(`/repos/${repo}/pulls/${number}`, token);

  return {
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user?.login ?? "unknown",
    url: pull.html_url,
    // A manual --pr re-post can name a PR that has not merged yet, and Discord
    // rejects an embed whose timestamp is null.
    mergedAt: pull.merged_at ?? new Date().toISOString(),
    filesChanged: pull.changed_files,
    additions: pull.additions,
    deletions: pull.deletions,
  };
}

async function postToDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!response.ok) {
    throw new Error(`Discord rejected the post with ${response.status}: ${await response.text()}`);
  }
}

/**
 * GITHUB_REPOSITORY in Actions, the origin remote everywhere else, so
 * `npm run changelog -- --pr 85 --dry-run` works in a clone with no setup.
 */
function resolveRepo(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return fromEnv;

  let remote: string;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Set GITHUB_REPOSITORY to owner/repo. There is no origin remote to read it from.");
  }

  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
  if (!match) {
    throw new Error(`Cannot read owner/repo from the origin remote "${remote}". Set GITHUB_REPOSITORY instead.`);
  }
  return match[1];
}

function flagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): { ref: PullRef; dryRun: boolean } {
  const dryRun = argv.includes("--dry-run");
  const sha = flagValue(argv, "--sha");
  const pr = flagValue(argv, "--pr");

  if ((sha === null) === (pr === null)) {
    throw new Error("Pass exactly one of --sha <sha> or --pr <number>, plus an optional --dry-run.");
  }
  if (sha !== null) return { ref: { kind: "sha", sha }, dryRun };

  const number = Number(pr);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`--pr wants a pull request number, not "${pr}".`);
  }
  return { ref: { kind: "number", number }, dryRun };
}

async function main() {
  const { ref, dryRun } = parseArgs(process.argv.slice(2));

  const webhookUrl = process.env.DISCORD_UPDATES_WEBHOOK ?? "";
  if (!dryRun && webhookUrl === "") {
    console.log("DISCORD_UPDATES_WEBHOOK is not set, so there is nowhere to post. Skipping.");
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to read the pull request. In Actions, pass secrets.GITHUB_TOKEN.");
  }

  const pull = await fetchMergedPull(resolveRepo(), ref, token);
  if (pull === null) {
    console.log("That commit was pushed straight to main rather than merged, so there is nothing to announce. Skipping.");
    return;
  }

  const note = updateNote(pull);
  console.log(
    note.source === "update-section"
      ? `Posting the ## Update section of #${pull.number}.`
      : `#${pull.number} had no ## Update section, so its title is standing in. Write one in the next pull request and it speaks for itself.`,
  );

  const embed = toEmbed(pull, note);
  if (dryRun) {
    console.log(JSON.stringify({ embeds: [embed] }, null, 2));
    return;
  }

  await postToDiscord(webhookUrl, embed);
  console.log(`Posted #${pull.number} to the updates channel.`);
}

// The test imports this module for its pure functions. Without the guard, that
// import would fire a real run at the GitHub API.
const isEntryPoint =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
