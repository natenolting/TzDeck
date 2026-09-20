<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project conventions

- New script or npm command (`package.json`, `scripts/`): document it in README.md's Development commands section (and any other section it belongs in, e.g. Battle system, Database migrations) in the same commit.
- Every pull request body carries a `## Update` section: one to three sentences of plain English on what changed for a player, not for a reviewer. `.github/workflows/discord-updates.yml` posts that text verbatim to the Discord updates channel when the PR merges, so it is player-facing copy, not a changelog entry. A pull request without the section falls back to its title.
