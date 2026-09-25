import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { OFFENSIVE_RECOVERY_HOURS } from "./rules";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

/**
 * The offensive recovery interval each SQL function currently uses: the one
 * from its latest definition, since migrations apply in filename order and
 * each CREATE OR REPLACE supersedes the last.
 */
function latestOffensiveRecoveryByFunction(): Map<string, string> {
  const latest = new Map<string, string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const definitions = sql.split(/CREATE (?:OR REPLACE )?FUNCTION /).slice(1);
    for (const definition of definitions) {
      const name = definition.match(/^(\w+)\(/)?.[1];
      const interval = definition.match(/v_offensive_recovery CONSTANT interval := interval '([^']+)'/)?.[1];
      if (name && interval) latest.set(name, interval);
    }
  }
  return latest;
}

test("the loss cooldown players are told matches the one commit_battle and commit_trainer_battle enforce", () => {
  const latest = latestOffensiveRecoveryByFunction();

  assert.deepEqual([...latest.keys()].sort(), ["commit_battle", "commit_trainer_battle"]);
  for (const [fn, interval] of latest) {
    assert.equal(
      interval,
      `${OFFENSIVE_RECOVERY_HOURS} ${OFFENSIVE_RECOVERY_HOURS === 1 ? "hour" : "hours"}`,
      `${fn} rests a losing attacker for ${interval}, but OFFENSIVE_RECOVERY_HOURS in rules.ts says ${OFFENSIVE_RECOVERY_HOURS}; update one to match the other`,
    );
  }
});
