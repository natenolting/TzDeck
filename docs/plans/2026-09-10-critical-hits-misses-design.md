# Critical hits and misses design

Status: implemented (see docs/plans/2026-09-10-critical-hits-misses-plan.md
and its commits on feat/pvp-battle-system). Verified via the full
automated test suite (unit tests for the three level curves,
resolveBattle's crit/miss branching, and BattleResultScreen's three beat
styles), tsc, lint, and a production build. A live click-through in the
browser with a mocked miss/critical/hit sequence was set up but not
completed -- it needed a wallet signature the user couldn't approve
mid-session (away from their PC) -- so this rests on the automated
coverage alone, not an eyes-on confirmation of the rendered styling.

## Summary

One d100 roll per side per round (in addition to the existing ±20% damage
variance roll) determines whether that side's hit is a miss, a critical
hit, or a normal hit. Miss chance starts high and decays with level ("still
learning to fight"); crit chance and crit damage multiplier both start low
and grow with level. All three curves are pure functions of level, in the
same per-level-scaling spirit as the existing Power/HP leveling
(`applyLevel` in `rules.ts`).

## The mechanic

- `roll = randomInt(1, 100)` via the shared seeded RNG stream, one per side
  per round, independent of the existing variance roll (`swingA`/`swingB`
  in `resolveBattle`).
- `roll === 1` → **miss**: this side deals 0 damage this round, regardless
  of the variance roll.
- `roll > (100 - critChance(level))` → **critical hit**: this side's
  damage is `power × varianceSwing × critMultiplier(level)`.
- otherwise → **normal hit**: unchanged, `power × varianceSwing`.

Miss and crit share **one** roll, not two independent rolls, so their
thresholds can never overlap by construction, and only one extra `roll()`
call is spent per side per round.

`level` is the acting side's own current level for that side's roll --
symmetric, computed independently for attacker and defender each round,
consistent with how `effectiveStats` is already applied per side today.

## Level curves

```
critChance(level)     = min(20%,  1%  + 0.5% × (level - 1))    -- caps at level 39
critMultiplier(level) = min(3.0x, 1.5x + 0.05x × (level - 1))  -- caps at level 31
missChance(level)     = max(1%,  10% - 0.3% × (level - 1))     -- floors at level 31
```

A crit multiplies the *already-varied* round damage
(`power × varianceSwing × critMultiplier`), not a separate flat number --
a crit round still carries some of the existing variance spread, it isn't
a fully deterministic third value.

Miss starts at 10% for a fresh Level 1 card and decays to a 1% floor by
level 31 -- never quite zero, even a veteran can slip. That floor level
lines up with crit multiplier's own cap at level 31: by then a card has
essentially stopped whiffing and is hitting as hard as its crits will ever
hit, while crit *chance* keeps climbing a bit further, capping at level 39.

**Verified no zone collision:** miss's widest range is 10 of 100 values (at
level 1) and crit's widest range is 20 of 100 values (from level 39
onward), and the two move in *opposite* directions with level -- their
combined width never exceeds ~21 of the 100 slots at any level, so a wide
normal-hit middle band always remains regardless of level.

## What changes

### `src/lib/battle/rules.ts`

- New exported pure functions: `criticalHitChance(level)`,
  `criticalHitMultiplier(level)`, `missChance(level)` -- computed directly
  from the formulas above, unit-testable in isolation from combat
  resolution.
- `resolveBattle` gains one extra `roll()` call per side per round, and
  applies the miss/crit/normal branching described above to that side's
  round damage.
- `RoundRecord` gains `resultA: "hit" | "critical" | "miss"` and
  `resultB: "hit" | "critical" | "miss"` -- one enum per side rather than
  two booleans, so "both true" is structurally impossible.
- `BattleResult`'s aggregate fields (`finalHpA`, `finalHpB`,
  `roundDamageA`, `roundDamageB`, `outcome`) are unaffected. A miss is just
  a round where that side's damage happens to be 0, already handled by the
  existing HP-decrement logic; a crit is just a round with abnormally high
  damage. No special-casing needed in win/draw/overkill-tiebreak
  resolution itself.

### `src/app/api/battle/random/route.ts`, `.../challenge/route.ts`

- No route-level logic changes -- both already forward whatever
  `resolveBattle` returns straight into `commitBattle`'s
  `inputs: { attackerStats, defenderStats, combat }` and the persisted
  response. The new `resultA`/`resultB` fields ride along automatically.
- `battle_attempts.response` (JSONB) now includes the new fields for every
  future battle. Past battles' stored responses lack them -- the client
  must treat `resultA`/`resultB` as optional (absent means "hit") when
  rendering a historical/terminal-replay result, not assume they're always
  present.

### `src/components/BattleResultScreen.tsx`

- The beat-log line gets a third rendering branch per beat, keyed off that
  beat's `result`:
  - `"hit"`: unchanged, e.g. "piramid hit for 63!"
  - `"miss"`: "piramid's hit missed!" (no damage number)
  - `"critical"`: "piramid landed a CRITICAL HIT for 184!" (visually
    distinct styling -- exact treatment, e.g. size/color/animation, to be
    decided during implementation)
- HP bar draining is unaffected -- it already just reads each beat's
  resulting hpA/hpB, which naturally reflect 0 damage on a miss or
  inflated damage on a crit.

### `scripts/simulate-battles.ts`, `scripts/validate-battle-tiebreak.ts`

- Both consume `resolveBattle` directly against fixed RNG seeds for their
  acceptance/balance runs. Adding a roll changes the RNG call sequence, so
  any seed-dependent expectations in those tools need re-validation --
  flagged as an implementation-time task, not a design blocker.

## Explicitly out of scope (for this design)

- XP awarded is unaffected by whether the winning blow was a crit -- still
  purely a function of the defeated opponent's tier/level, unchanged.
- No new persistent card attribute, no interaction with the Power/HP
  formulas themselves -- crit/miss is a per-round roll layered on top of
  existing damage, not a stat a card carries.
- No change to the "Level X · Power Y · HP Z" summary shown elsewhere (the
  Battle panel, the deck detail modal) -- crit/miss odds aren't surfaced as
  a headline stat there, only expressed live in the animated battle log.

## Testing

- Pure-function tests for `criticalHitChance`/`criticalHitMultiplier`/
  `missChance` against the formulas above, including the level-1 value and
  the capped/floored boundary levels (39, 31).
- `resolveBattle` tests: seed a specific `mulberry32` value known (from the
  pure-function math) to land in the miss zone / crit zone / normal zone
  for a given level, and assert the resulting `RoundRecord`'s
  `resultA`/`resultB` and damage match.
- `BattleResultScreen` render tests for the three new beat-line styles,
  extending the existing beat-reveal test suite (`BattleResultScreen.test.tsx`).
- Re-run `validate-battle-tiebreak.ts`'s acceptance targets and
  `simulate-battles.ts` across a range of levels to sanity-check crit/miss
  don't meaningfully distort the R14 tiebreak's own demonstrated draw-rate
  improvement -- a qualitative check, not a hard gate.
