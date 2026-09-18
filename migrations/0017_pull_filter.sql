-- Pull-pool filtering (docs/pull-filter-spec.md). Two tables with very
-- different growth: pull_denylist is written only by a human via the denylist
-- CLI and stays at tens of rows; pull_exclusions is written by the pack draw
-- and would grow with traffic if it appended. It upserts instead, so a token
-- excluded a thousand times is one row with hit_count = 1000, and the row
-- count tracks distinct flagged tokens the draw has met rather than requests.
--
-- Retention sweeps opportunistically inside record_pull_exclusion rather than
-- via separate cron infra -- the same pattern 0012 uses for rate_limits.
-- Denylist-reason rows are exempt from the sweep: a denylisted token that
-- stops appearing has not stopped being denylisted, and its row is the
-- evidence for why it is gone.

CREATE TABLE pull_denylist (
  fa_contract text NOT NULL,
  token_id text,              -- NULL = the entire contract
  reason text NOT NULL,
  added_by text,
  added_at timestamptz NOT NULL DEFAULT now()
);

-- Postgres treats NULLs as distinct in a unique index, so a plain
-- (fa_contract, token_id) index would let the same contract-wide entry be
-- inserted repeatedly. COALESCE collapses NULL to '' so it cannot.
CREATE UNIQUE INDEX pull_denylist_key
  ON pull_denylist (fa_contract, COALESCE(token_id, ''));

CREATE TABLE pull_exclusions (
  fa_contract text NOT NULL,
  token_id text NOT NULL,
  token_pk bigint,
  reason text NOT NULL,
  hit_count integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fa_contract, token_id)
);

CREATE INDEX pull_exclusions_last_seen_idx ON pull_exclusions (last_seen);

CREATE FUNCTION record_pull_exclusion(
  p_fa_contract text, p_token_id text, p_token_pk bigint, p_reason text
) RETURNS void AS $$
DECLARE
  v_now CONSTANT timestamptz := clock_timestamp();
BEGIN
  IF random() < 0.01 THEN
    DELETE FROM pull_exclusions
    WHERE last_seen <= v_now - interval '180 days'
      AND reason <> 'denylist';
  END IF;

  INSERT INTO pull_exclusions (
    fa_contract, token_id, token_pk, reason, hit_count, first_seen, last_seen
  )
  VALUES (p_fa_contract, p_token_id, p_token_pk, p_reason, 1, v_now, v_now)
  ON CONFLICT (fa_contract, token_id) DO UPDATE SET
    hit_count = pull_exclusions.hit_count + 1,
    last_seen = v_now,
    reason = EXCLUDED.reason,
    token_pk = COALESCE(EXCLUDED.token_pk, pull_exclusions.token_pk);
END;
$$ LANGUAGE plpgsql;
