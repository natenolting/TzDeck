# Ship the funnel instrumentation (#76)

## Feature playbook
- [x] 1. `how` over the affected subsystem — commit_battle/commit_trainer_battle sweeps (0014:68, 0016:58),
      wallets schema (0001:5), @vercel/analytics 2.0.1 track(), db-health-check.ts precedent
- [x] 2. `architect` — skip: the design is already settled by #73's grilling round and written up as a
      build spec on the ticket. No open structural fork remains; re-deriving it would be theatre.
- [x] 3. Throughput checkpoint (below)
- [ ] 4. Delegate code-writing to a subagent in its own worktree; review the diff
- [ ] 5. Verify on the matching surface (run the migration on dev, run the script, fire the events)
- [ ] 6. Rebase into small, ordered commits
- [ ] 7. `interrogate` — skip unless the SQL review turns up disagreement
- [ ] 8. Run Opening a PR

## Throughput checkpoint
- **Blocking first steps.** Migration 0018 gates the funnel script, which reads `wallets.created_at`.
  Verified before fan-out: all 17 migrations are applied on dev, so 0018 is genuinely next.
- **Independent workstreams.** The five client events touch component files only; the migration and
  script touch migrations/ and scripts/. They could split, but they are one feature with one
  acceptance test, so per the playbook's code-coupled rule they go to a single owner.
- **Shared mutable state.** The delegate gets its own worktree. I do not write files or run a suite
  in a worktree it holds. The dev database is shared with nothing else running right now.
- **Smallest safe decomposition.** One owner, three commits. Splitting the migration from the script
  would leave a script that cannot run, which is not a verifiable unit.

## Danger in this ticket
The 30-day sweep is a LITERAL inside two large PL/pgSQL bodies: commit_battle (0014, 291 lines) and
commit_trainer_battle (0016, 220 lines). Changing it means redefining both functions in full, which is
the pattern 0014 and 0016 already used. A transcription error here silently breaks battling.
The delegate must copy each body verbatim and change only the interval.
