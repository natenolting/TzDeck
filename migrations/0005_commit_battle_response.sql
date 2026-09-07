-- Follow-up review found three gaps in the original commit_battle (0003):
--
-- 1. It checked generation and pending status but never lease_expires_at or
--    retry_until, so a worker whose authorization window had already closed
--    (no takeover needed) could still settle a battle.
-- 2. The route reconstructed its own HTTP response from local variables
--    (pre-decay XP) while this function persisted a DIFFERENT, minimal
--    response (post-decay XP, no winner identity) for replay -- a first
--    attempt and a later replay of the same nonce could disagree, and a
--    rejected commit never even got its status_code recorded, so replaying
--    it defaulted to 200.
-- 3. A first-use attacker row (p_attacker_expected_version IS NULL) was
--    accepted as long as progress_version was still 0, but a concurrent
--    opt-in holdings-sync promotion can ALSO materialize that same row at
--    version 0 with different seed data -- version alone can't tell "I just
--    created this row" apart from "someone else did, moments ago."
--
-- Fixed by: checking both deadlines twice (before the wallet/progress lock
-- waits, and again immediately after, since a wait can itself burn the
-- remaining window); returning the exact (response, status_code) pair that
-- also gets persisted to battle_attempts.response/status_code, so a first
-- attempt and a replay are always byte-identical; and capturing whether THIS
-- invocation's own INSERT actually created the attacker's row, rejecting as
-- a conflicting materialization when it did not.
DROP FUNCTION commit_battle(
  text, bigint, text, text, bigint, integer, integer, text,
  text, text, bigint, text, text, text, text, text, text, integer, text, text, jsonb
);

CREATE FUNCTION commit_battle(
  p_nonce text,
  p_generation bigint,
  p_attacker_wallet text,
  p_attacker_card_key text,
  p_attacker_expected_version bigint, -- NULL means "expected absent" (first use)
  p_attacker_seed_editions integer,   -- used only if this card's row must be inserted
  p_attacker_seed_description_length integer,
  p_attacker_seed_source text,
  p_defender_wallet text,
  p_defender_card_key text,
  p_defender_expected_version bigint, -- never NULL -- defenders are always already materialized
  p_outcome text,             -- 'win' | 'draw'
  p_winner_wallet text,       -- NULL if draw
  p_winner_card_key text,
  p_loser_wallet text,
  p_loser_card_key text,
  p_loser_recovery_reason text,   -- 'offensive' | 'defensive', NULL if draw
  p_base_xp_award integer,        -- pre-decay; deterministic given public inputs (rules.ts::baseXpAward)
  p_rules_version text,
  p_rng_seed text,
  p_inputs jsonb
) RETURNS TABLE(
  response jsonb,
  status_code integer
) AS $$
DECLARE
  v_attempt battle_attempts;
  v_first_wallet text;
  v_second_wallet text;
  v_attacker_wallet_row wallets;
  v_defender_wallet_row wallets;
  v_attacker_progress wallet_card_progress;
  v_defender_progress wallet_card_progress;
  v_attacker_row_inserted boolean;
  v_settlement_time timestamptz;
  v_effective_attack_count integer;
  v_effective_defense_count integer;
  v_decay_count integer;
  v_decay_multiplier numeric;
  v_xp_award integer;
  v_recovery_interval interval;
  v_winner_new_xp bigint;
  v_loser_recovery_until timestamptz;
  v_result jsonb;
  v_sqlstate text;
  v_status integer;
  -- Tuning placeholders (Open Questions) -- must match rules.ts's constants; see parity tests.
  v_attack_cap_max CONSTANT integer := 20;
  v_defense_cap_max CONSTANT integer := 20;
  v_decay_rate CONSTANT numeric := 0.5;
  v_decay_floor CONSTANT numeric := 0.1;
  v_offensive_recovery CONSTANT interval := interval '4 hours';
  v_defensive_recovery CONSTANT interval := interval '1 hour';
BEGIN
  -- Lock the attempt row (already the outermost lock in the canonical order).
  SELECT * INTO v_attempt FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF v_attempt IS NULL OR v_attempt.generation != p_generation OR v_attempt.status != 'pending' THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable'), 409;
    RETURN;
  END IF;

  BEGIN -- nested block: an expected business rejection rolls back everything below, without aborting the outer call
    IF v_attempt.lease_expires_at IS NULL OR v_attempt.lease_expires_at <= clock_timestamp()
       OR v_attempt.retry_until <= clock_timestamp() THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'BT011';
    END IF;

    IF p_attacker_wallet = p_defender_wallet THEN
      RAISE EXCEPTION USING MESSAGE = 'self_challenge', ERRCODE = 'BT001';
    END IF;

    -- Lock wallets in canonical (sorted-by-address) order.
    IF p_attacker_wallet < p_defender_wallet THEN
      v_first_wallet := p_attacker_wallet;
      v_second_wallet := p_defender_wallet;
    ELSE
      v_first_wallet := p_defender_wallet;
      v_second_wallet := p_attacker_wallet;
    END IF;

    -- The attacker's wallet row may not exist yet (never opted in, never attacked before).
    IF v_first_wallet = p_attacker_wallet THEN
      INSERT INTO wallets (address) VALUES (p_attacker_wallet) ON CONFLICT (address) DO NOTHING;
    END IF;
    PERFORM 1 FROM wallets WHERE address = v_first_wallet FOR UPDATE;
    PERFORM 1 FROM wallets WHERE address = v_second_wallet FOR UPDATE;
    IF v_second_wallet = p_attacker_wallet THEN
      INSERT INTO wallets (address) VALUES (p_attacker_wallet) ON CONFLICT (address) DO NOTHING;
      PERFORM 1 FROM wallets WHERE address = p_attacker_wallet FOR UPDATE;
    END IF;

    SELECT * INTO v_attacker_wallet_row FROM wallets WHERE address = p_attacker_wallet;
    SELECT * INTO v_defender_wallet_row FROM wallets WHERE address = p_defender_wallet;
    IF v_defender_wallet_row IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'defender_wallet_not_found', ERRCODE = 'BT002';
    END IF;

    -- Lock progress rows in canonical (sorted-by-wallet-then-card_key) order.
    -- The attacker's row may not exist yet; the defender's always must.
    IF (p_attacker_wallet, p_attacker_card_key) < (p_defender_wallet, p_defender_card_key) THEN
      IF p_attacker_expected_version IS NULL THEN
        INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
        VALUES (p_attacker_wallet, p_attacker_card_key, p_attacker_seed_editions, p_attacker_seed_description_length, p_attacker_seed_source)
        ON CONFLICT (wallet, card_key) DO NOTHING
        RETURNING true INTO v_attacker_row_inserted;
      END IF;
      PERFORM 1 FROM wallet_card_progress WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key FOR UPDATE;
      PERFORM 1 FROM wallet_card_progress WHERE wallet = p_defender_wallet AND card_key = p_defender_card_key FOR UPDATE;
    ELSE
      PERFORM 1 FROM wallet_card_progress WHERE wallet = p_defender_wallet AND card_key = p_defender_card_key FOR UPDATE;
      IF p_attacker_expected_version IS NULL THEN
        INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
        VALUES (p_attacker_wallet, p_attacker_card_key, p_attacker_seed_editions, p_attacker_seed_description_length, p_attacker_seed_source)
        ON CONFLICT (wallet, card_key) DO NOTHING
        RETURNING true INTO v_attacker_row_inserted;
      END IF;
      PERFORM 1 FROM wallet_card_progress WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key FOR UPDATE;
    END IF;

    SELECT * INTO v_attacker_progress FROM wallet_card_progress WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key;
    SELECT * INTO v_defender_progress FROM wallet_card_progress WHERE wallet = p_defender_wallet AND card_key = p_defender_card_key;

    IF v_attacker_progress IS NULL OR v_defender_progress IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'progress_row_missing', ERRCODE = 'BT003';
    END IF;

    -- Reject a stale resolution: either card changed since combat was resolved against it.
    IF p_attacker_expected_version IS NOT NULL AND v_attacker_progress.progress_version != p_attacker_expected_version THEN
      RAISE EXCEPTION USING MESSAGE = 'stale_attacker_version', ERRCODE = 'BT004';
    END IF;
    IF p_attacker_expected_version IS NULL THEN
      IF v_attacker_progress.progress_version != 0 THEN
        -- Another concurrent commit materialized this "first use" row first.
        RAISE EXCEPTION USING MESSAGE = 'stale_attacker_version', ERRCODE = 'BT004';
      END IF;
      IF NOT COALESCE(v_attacker_row_inserted, false) THEN
        -- Row already existed at version 0 but THIS invocation didn't create
        -- it -- a concurrent opt-in holdings-sync promotion beat us to it,
        -- possibly with different seed data than what combat was just
        -- resolved against. Reject rather than settle against unverified stats.
        RAISE EXCEPTION USING MESSAGE = 'conflicting_first_use_materialization', ERRCODE = 'BT012';
      END IF;
    END IF;
    IF v_defender_progress.progress_version != p_defender_expected_version THEN
      RAISE EXCEPTION USING MESSAGE = 'stale_defender_version', ERRCODE = 'BT005';
    END IF;

    v_settlement_time := clock_timestamp();
    -- Re-check both deadlines: the lock waits above can themselves burn the
    -- remaining window even when the entry check above passed.
    IF v_attempt.lease_expires_at <= v_settlement_time OR v_attempt.retry_until <= v_settlement_time THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'BT011';
    END IF;

    -- Role-specific eligibility -- NOT the same check applied to both rows.
    v_effective_attack_count := CASE WHEN v_attacker_wallet_row.attack_reset_at <= v_settlement_time THEN 0 ELSE v_attacker_wallet_row.attack_count END;
    v_effective_defense_count := CASE WHEN v_defender_wallet_row.defense_reset_at <= v_settlement_time THEN 0 ELSE v_defender_wallet_row.defense_count END;

    IF v_effective_attack_count >= v_attack_cap_max THEN
      RAISE EXCEPTION USING MESSAGE = 'attack_cap_reached', ERRCODE = 'BT006';
    END IF;
    IF NOT v_defender_wallet_row.opted_in THEN
      RAISE EXCEPTION USING MESSAGE = 'defender_opted_out', ERRCODE = 'BT007';
    END IF;
    IF v_effective_defense_count >= v_defense_cap_max THEN
      RAISE EXCEPTION USING MESSAGE = 'defense_cap_reached', ERRCODE = 'BT008';
    END IF;
    IF v_attacker_progress.recovery_until IS NOT NULL AND v_attacker_progress.recovery_until > v_settlement_time THEN
      RAISE EXCEPTION USING MESSAGE = 'attacker_recovering', ERRCODE = 'BT009';
    END IF;
    IF v_defender_progress.recovery_until IS NOT NULL AND v_defender_progress.recovery_until > v_settlement_time THEN
      RAISE EXCEPTION USING MESSAGE = 'defender_recovering', ERRCODE = 'BT010';
    END IF;

    -- Cap counters: reset-on-boundary is inline, not a separate job.
    UPDATE wallets SET
      attack_count = CASE WHEN attack_reset_at <= v_settlement_time THEN 1 ELSE attack_count + 1 END,
      attack_reset_at = CASE WHEN attack_reset_at <= v_settlement_time THEN date_trunc('day', v_settlement_time) + interval '1 day' ELSE attack_reset_at END
    WHERE address = p_attacker_wallet;

    UPDATE wallets SET
      defense_count = CASE WHEN defense_reset_at <= v_settlement_time THEN 1 ELSE defense_count + 1 END,
      defense_reset_at = CASE WHEN defense_reset_at <= v_settlement_time THEN date_trunc('day', v_settlement_time) + interval '1 day' ELSE defense_reset_at END
    WHERE address = p_defender_wallet;

    IF p_outcome = 'win' THEN
      -- R20 decay: computed from a count read INSIDE this locked transaction, never a JS pre-read.
      SELECT count(*) INTO v_decay_count FROM battle_log
      WHERE winner_wallet = p_winner_wallet AND loser_wallet = p_loser_wallet
        AND settled_at > v_settlement_time - interval '7 days';
      -- Must match rules.ts::decayScaledAward -- see the parity test.
      v_decay_multiplier := GREATEST(v_decay_floor, POWER(v_decay_rate, v_decay_count));
      v_xp_award := GREATEST(1, ROUND(p_base_xp_award * v_decay_multiplier));

      v_recovery_interval := CASE WHEN p_loser_recovery_reason = 'defensive' THEN v_defensive_recovery ELSE v_offensive_recovery END;

      UPDATE wallet_card_progress SET
        xp = xp + v_xp_award,
        progress_version = progress_version + 1
      WHERE wallet = p_winner_wallet AND card_key = p_winner_card_key
      RETURNING xp INTO v_winner_new_xp;

      UPDATE wallet_card_progress SET
        recovery_until = v_settlement_time + v_recovery_interval,
        recovery_reason = p_loser_recovery_reason,
        progress_version = progress_version + 1
      WHERE wallet = p_loser_wallet AND card_key = p_loser_card_key
      RETURNING recovery_until INTO v_loser_recovery_until;
    ELSE
      -- Draw: both sides get a version bump (concurrency fencing), no XP, no recovery.
      UPDATE wallet_card_progress SET progress_version = progress_version + 1 WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key;
      UPDATE wallet_card_progress SET progress_version = progress_version + 1 WHERE wallet = p_defender_wallet AND card_key = p_defender_card_key;
      v_xp_award := 0;
    END IF;

    INSERT INTO battle_log (
      attempt_nonce, attacker_wallet, attacker_card_key, defender_wallet, defender_card_key,
      winner_wallet, loser_wallet, outcome, settled_at, rules_version, inputs, rng_seed, xp_awarded
    ) VALUES (
      p_nonce, p_attacker_wallet, p_attacker_card_key, p_defender_wallet, p_defender_card_key,
      p_winner_wallet, p_loser_wallet, p_outcome, v_settlement_time, p_rules_version, p_inputs, p_rng_seed,
      CASE WHEN p_outcome = 'win' THEN v_xp_award ELSE NULL END
    );

    -- The one place this payload is built -- a first attempt and a later
    -- replay of the same terminal nonce return this exact object.
    v_result := jsonb_build_object(
      'outcome', p_outcome,
      'winner', CASE WHEN p_outcome = 'draw' THEN NULL
                     WHEN p_winner_wallet = p_attacker_wallet THEN 'attacker'
                     ELSE 'defender' END,
      'xpAwarded', v_xp_award,
      'winnerNewXp', v_winner_new_xp,
      'loserRecoveryUntil', v_loser_recovery_until
    );

    UPDATE battle_attempts SET status = 'completed', completed_at = v_settlement_time,
      response = v_result, status_code = 200
    WHERE nonce = p_nonce;

    RETURN QUERY SELECT v_result, 200;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'BT001' OR SQLSTATE 'BT002' OR SQLSTATE 'BT003' OR SQLSTATE 'BT004'
      OR SQLSTATE 'BT005' OR SQLSTATE 'BT006' OR SQLSTATE 'BT007' OR SQLSTATE 'BT008'
      OR SQLSTATE 'BT009' OR SQLSTATE 'BT010' OR SQLSTATE 'BT011' OR SQLSTATE 'BT012' THEN
    -- Nested game writes above have already rolled back to the start of this
    -- block. Mark the attempt failed and return normally -- do NOT re-raise.
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    -- BT011 (lease/retry window closed) and BT012 (lost a first-use
    -- materialization race) are operational timing, not a business rule
    -- broken by the caller -- retryable under a fresh generation/attempt.
    v_status := CASE WHEN v_sqlstate = 'BT011' THEN 503 ELSE 409 END;
    v_result := jsonb_build_object('error', SQLERRM);
    UPDATE battle_attempts SET status = 'failed', response = v_result, status_code = v_status,
      retryable = (v_sqlstate IN ('BT011', 'BT012'))
    WHERE nonce = p_nonce AND generation = p_generation;
    RETURN QUERY SELECT v_result, v_status;
    RETURN;
  END;
END;
$$ LANGUAGE plpgsql;
