-- Every rejection the commit functions return now says whether it is
-- retryable, in the response body itself.
--
-- Each function already decided that from the SQLSTATE and stored it in
-- battle_attempts.retryable, but the body the route forwards carried only
-- { error }, so the client kept its own list of which codes to retry. The
-- routes' own rejections already send { error, retryable }; this makes the
-- commit functions match, so the client can take the server's word for it.
--
-- All four bodies are verbatim copies of their latest definitions
-- (commit_battle and commit_trainer_battle from 0018, commit_participation
-- and commit_holdings_refresh from 0009), which are applied and checksummed
-- and so are never edited. The only differences are the 'retryable' keys:
-- the SQLSTATE rule each function already applies to the ledger, and false
-- for the early attempt_not_claimable and identity_mismatch returns, which
-- no resubmission can fix.

CREATE OR REPLACE FUNCTION commit_battle(
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
  -- Opportunistic retention sweep, unconditional on outcome: placed ahead of
  -- the nested business-rejection block below so it is never rolled back by
  -- an ordinary rejection like attack_cap_reached.
  IF random() < 0.01 THEN
    DELETE FROM battle_log WHERE settled_at <= clock_timestamp() - interval '90 days';
  END IF;

  -- Lock the attempt row (already the outermost lock in the canonical order).
  SELECT * INTO v_attempt FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF v_attempt IS NULL OR v_attempt.generation != p_generation OR v_attempt.status != 'pending' THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable', 'retryable', false), 409;
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
    -- replay of the same terminal nonce return this exact object. Opponent
    -- identity and combat detail (attackerStats/defenderStats/combat) are
    -- forwarded straight from p_inputs -- the route already computed them,
    -- this just stops discarding them before the client sees them.
    v_result := jsonb_build_object(
      'outcome', p_outcome,
      'winner', CASE WHEN p_outcome = 'draw' THEN NULL
                     WHEN p_winner_wallet = p_attacker_wallet THEN 'attacker'
                     ELSE 'defender' END,
      'xpAwarded', v_xp_award,
      'winnerNewXp', v_winner_new_xp,
      'loserRecoveryUntil', v_loser_recovery_until,
      'defenderWallet', p_defender_wallet,
      'defenderCardKey', p_defender_card_key,
      'attackerStats', p_inputs->'attackerStats',
      'defenderStats', p_inputs->'defenderStats',
      'combat', jsonb_build_object(
        'rounds', p_inputs->'combat'->'rounds',
        'finalHpA', p_inputs->'combat'->'finalHpA',
        'finalHpB', p_inputs->'combat'->'finalHpB',
        'history', p_inputs->'combat'->'history'
      )
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
    v_result := jsonb_build_object('error', SQLERRM, 'retryable', v_sqlstate IN ('BT011', 'BT012'));
    UPDATE battle_attempts SET status = 'failed', response = v_result, status_code = v_status,
      retryable = (v_sqlstate IN ('BT011', 'BT012'))
    WHERE nonce = p_nonce AND generation = p_generation;
    RETURN QUERY SELECT v_result, v_status;
    RETURN;
  END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commit_trainer_battle(
  p_nonce text,
  p_generation bigint,
  p_attacker_wallet text,
  p_attacker_card_key text,
  p_attacker_expected_version bigint, -- NULL means "expected absent" (first use)
  p_attacker_seed_editions integer,
  p_attacker_seed_description_length integer,
  p_attacker_seed_source text,
  p_trainer_tier text,           -- 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  p_outcome text,                -- 'win' | 'draw'
  p_attacker_won boolean,        -- meaningless when p_outcome = 'draw'
  p_base_xp_award integer,       -- pre-repeat-decay: rules.ts::trainerBaseXpAward(tier, gap)
  p_rules_version text,
  p_rng_seed text,
  p_inputs jsonb
) RETURNS TABLE(
  response jsonb,
  status_code integer
) AS $$
DECLARE
  v_attempt battle_attempts;
  v_attacker_wallet_row wallets;
  v_attacker_progress wallet_card_progress;
  v_attacker_row_inserted boolean;
  v_settlement_time timestamptz;
  v_effective_trainer_attack_count integer;
  v_trainer_id text;
  v_decay_count integer;
  v_decay_multiplier numeric;
  v_xp_award integer;
  v_new_xp bigint;
  v_recovery_until timestamptz;
  v_result jsonb;
  v_sqlstate text;
  v_status integer;
  -- Tuning placeholders -- must match rules.ts's constants; see the parity test.
  v_trainer_attack_cap_max CONSTANT integer := 20;
  v_decay_rate CONSTANT numeric := 0.5;
  v_decay_floor CONSTANT numeric := 0.1;
  v_offensive_recovery CONSTANT interval := interval '4 hours';
BEGIN
  -- Opportunistic retention sweep, unconditional on outcome -- same pattern
  -- as commit_battle (0014): placed ahead of the nested rejection block so
  -- it's never rolled back by an ordinary rejection.
  IF random() < 0.01 THEN
    DELETE FROM battle_log WHERE settled_at <= clock_timestamp() - interval '90 days';
  END IF;

  SELECT * INTO v_attempt FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF v_attempt IS NULL OR v_attempt.generation != p_generation OR v_attempt.status != 'pending' THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable', 'retryable', false), 409;
    RETURN;
  END IF;

  v_trainer_id := 'trainer:' || p_trainer_tier;

  BEGIN -- nested block: an expected business rejection rolls back everything below, without aborting the outer call
    IF v_attempt.lease_expires_at IS NULL OR v_attempt.lease_expires_at <= clock_timestamp()
       OR v_attempt.retry_until <= clock_timestamp() THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'BT011';
    END IF;

    INSERT INTO wallets (address) VALUES (p_attacker_wallet) ON CONFLICT (address) DO NOTHING;
    PERFORM 1 FROM wallets WHERE address = p_attacker_wallet FOR UPDATE;
    SELECT * INTO v_attacker_wallet_row FROM wallets WHERE address = p_attacker_wallet;

    IF p_attacker_expected_version IS NULL THEN
      INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
      VALUES (p_attacker_wallet, p_attacker_card_key, p_attacker_seed_editions, p_attacker_seed_description_length, p_attacker_seed_source)
      ON CONFLICT (wallet, card_key) DO NOTHING
      RETURNING true INTO v_attacker_row_inserted;
    END IF;
    PERFORM 1 FROM wallet_card_progress WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key FOR UPDATE;
    SELECT * INTO v_attacker_progress FROM wallet_card_progress WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key;

    IF v_attacker_progress IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'progress_row_missing', ERRCODE = 'BT003';
    END IF;

    IF p_attacker_expected_version IS NOT NULL AND v_attacker_progress.progress_version != p_attacker_expected_version THEN
      RAISE EXCEPTION USING MESSAGE = 'stale_attacker_version', ERRCODE = 'BT004';
    END IF;
    IF p_attacker_expected_version IS NULL THEN
      IF v_attacker_progress.progress_version != 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'stale_attacker_version', ERRCODE = 'BT004';
      END IF;
      IF NOT COALESCE(v_attacker_row_inserted, false) THEN
        RAISE EXCEPTION USING MESSAGE = 'conflicting_first_use_materialization', ERRCODE = 'BT012';
      END IF;
    END IF;

    v_settlement_time := clock_timestamp();
    IF v_attempt.lease_expires_at <= v_settlement_time OR v_attempt.retry_until <= v_settlement_time THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'BT011';
    END IF;

    v_effective_trainer_attack_count := CASE WHEN v_attacker_wallet_row.trainer_attack_reset_at <= v_settlement_time THEN 0 ELSE v_attacker_wallet_row.trainer_attack_count END;
    IF v_effective_trainer_attack_count >= v_trainer_attack_cap_max THEN
      RAISE EXCEPTION USING MESSAGE = 'trainer_attack_cap_reached', ERRCODE = 'BT101';
    END IF;
    IF v_attacker_progress.recovery_until IS NOT NULL AND v_attacker_progress.recovery_until > v_settlement_time THEN
      RAISE EXCEPTION USING MESSAGE = 'attacker_recovering', ERRCODE = 'BT009';
    END IF;

    UPDATE wallets SET
      trainer_attack_count = CASE WHEN trainer_attack_reset_at <= v_settlement_time THEN 1 ELSE trainer_attack_count + 1 END,
      trainer_attack_reset_at = CASE WHEN trainer_attack_reset_at <= v_settlement_time THEN date_trunc('day', v_settlement_time) + interval '1 day' ELSE trainer_attack_reset_at END
    WHERE address = p_attacker_wallet;

    IF p_outcome = 'win' AND p_attacker_won THEN
      -- R20 decay, reused as-is: computed from a count read INSIDE this
      -- locked transaction, keyed on the trainer's synthetic id exactly the
      -- way PvP keys it on a real loser wallet.
      SELECT count(*) INTO v_decay_count FROM battle_log
      WHERE winner_wallet = p_attacker_wallet AND loser_wallet = v_trainer_id
        AND settled_at > v_settlement_time - interval '7 days';
      v_decay_multiplier := GREATEST(v_decay_floor, POWER(v_decay_rate, v_decay_count));
      v_xp_award := GREATEST(1, ROUND(p_base_xp_award * v_decay_multiplier));

      UPDATE wallet_card_progress SET
        xp = xp + v_xp_award,
        progress_version = progress_version + 1
      WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key
      RETURNING xp INTO v_new_xp;

      INSERT INTO battle_log (
        attempt_nonce, attacker_wallet, attacker_card_key, defender_wallet, defender_card_key,
        winner_wallet, loser_wallet, outcome, settled_at, rules_version, inputs, rng_seed, xp_awarded
      ) VALUES (
        p_nonce, p_attacker_wallet, p_attacker_card_key, v_trainer_id, v_trainer_id,
        p_attacker_wallet, v_trainer_id, 'win', v_settlement_time, p_rules_version, p_inputs, p_rng_seed, v_xp_award
      );
    ELSIF p_outcome = 'win' THEN
      -- The trainer won: attacker's card recovers exactly like a PvP
      -- offensive loss. No XP, no decay tracked (a trainer never accrues
      -- wins against a player).
      v_xp_award := 0;
      UPDATE wallet_card_progress SET
        recovery_until = v_settlement_time + v_offensive_recovery,
        recovery_reason = 'offensive',
        progress_version = progress_version + 1
      WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key
      RETURNING recovery_until INTO v_recovery_until;

      INSERT INTO battle_log (
        attempt_nonce, attacker_wallet, attacker_card_key, defender_wallet, defender_card_key,
        winner_wallet, loser_wallet, outcome, settled_at, rules_version, inputs, rng_seed, xp_awarded
      ) VALUES (
        p_nonce, p_attacker_wallet, p_attacker_card_key, v_trainer_id, v_trainer_id,
        v_trainer_id, p_attacker_wallet, 'win', v_settlement_time, p_rules_version, p_inputs, p_rng_seed, NULL
      );
    ELSE
      -- Draw: version bump only (concurrency fencing), no XP, no recovery.
      UPDATE wallet_card_progress SET progress_version = progress_version + 1
      WHERE wallet = p_attacker_wallet AND card_key = p_attacker_card_key;
      v_xp_award := 0;

      INSERT INTO battle_log (
        attempt_nonce, attacker_wallet, attacker_card_key, defender_wallet, defender_card_key,
        winner_wallet, loser_wallet, outcome, settled_at, rules_version, inputs, rng_seed, xp_awarded
      ) VALUES (
        p_nonce, p_attacker_wallet, p_attacker_card_key, v_trainer_id, v_trainer_id,
        NULL, NULL, 'draw', v_settlement_time, p_rules_version, p_inputs, p_rng_seed, NULL
      );
    END IF;

    -- The one place this payload is built -- a first attempt and a later
    -- replay of the same terminal nonce return this exact object.
    -- trainerTier/trainerId stand in for defenderWallet/defenderCardKey --
    -- a trainer is never a real wallet, so it never fills those fields.
    v_result := jsonb_build_object(
      'outcome', p_outcome,
      'winner', CASE WHEN p_outcome = 'draw' THEN NULL WHEN p_attacker_won THEN 'attacker' ELSE 'defender' END,
      'xpAwarded', v_xp_award,
      'winnerNewXp', v_new_xp,
      'loserRecoveryUntil', v_recovery_until,
      'trainerTier', p_trainer_tier,
      'trainerId', v_trainer_id,
      'attackerStats', p_inputs->'attackerStats',
      'defenderStats', p_inputs->'defenderStats',
      'combat', jsonb_build_object(
        'rounds', p_inputs->'combat'->'rounds',
        'finalHpA', p_inputs->'combat'->'finalHpA',
        'finalHpB', p_inputs->'combat'->'finalHpB',
        'history', p_inputs->'combat'->'history'
      )
    );

    UPDATE battle_attempts SET status = 'completed', completed_at = v_settlement_time,
      response = v_result, status_code = 200
    WHERE nonce = p_nonce;

    RETURN QUERY SELECT v_result, 200;
    RETURN;
  EXCEPTION
    WHEN SQLSTATE 'BT003' OR SQLSTATE 'BT004' OR SQLSTATE 'BT009' OR SQLSTATE 'BT011'
      OR SQLSTATE 'BT012' OR SQLSTATE 'BT101' THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_status := CASE WHEN v_sqlstate = 'BT011' THEN 503 ELSE 409 END;
    v_result := jsonb_build_object('error', SQLERRM, 'retryable', v_sqlstate IN ('BT011', 'BT012'));
    UPDATE battle_attempts SET status = 'failed', response = v_result, status_code = v_status,
      retryable = (v_sqlstate IN ('BT011', 'BT012'))
    WHERE nonce = p_nonce AND generation = p_generation;
    RETURN QUERY SELECT v_result, v_status;
    RETURN;
  END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commit_participation(
  p_nonce text, p_generation bigint, p_wallet text, p_param_hash text,
  p_opted_in boolean, p_sync_id text
) RETURNS TABLE(response jsonb, status_code integer) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  promoted boolean;
  result jsonb;
  v_sqlstate text;
  v_status integer;
  v_retryable boolean;
BEGIN
  SELECT * INTO a FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF NOT FOUND OR a.wallet != p_wallet OR a.action != 'opt-in' OR a.param_hash != p_param_hash THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'identity_mismatch', 'retryable', false), 401; RETURN;
  END IF;
  IF a.status = 'completed' OR (a.status = 'failed' AND NOT a.retryable) THEN
    RETURN QUERY SELECT a.response, a.status_code; RETURN;
  END IF;
  IF a.status != 'pending' OR a.generation != p_generation
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable', 'retryable', false), 409; RETURN;
  END IF;
  BEGIN
    INSERT INTO wallets(address) VALUES(p_wallet) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM wallets WHERE address = p_wallet FOR UPDATE;
    IF a.lease_expires_at <= clock_timestamp() OR a.retry_until <= clock_timestamp() THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'PT001';
    END IF;
    IF p_opted_in THEN
      SELECT * INTO s FROM holdings_syncs WHERE sync_id = p_sync_id;
      IF NOT FOUND OR s.wallet != p_wallet OR s.attempt_nonce != p_nonce OR s.status != 'complete'
         OR s.worker_generation > p_generation THEN
        RAISE EXCEPTION USING MESSAGE = 'invalid_holdings_sync', ERRCODE = 'PT002';
      END IF;
      SELECT h.promoted INTO promoted FROM promote_holdings_snapshot(p_wallet, s.captured_holdings_generation, s.staged_cards) h;
      IF NOT promoted THEN
        RAISE EXCEPTION USING MESSAGE = 'stale_holdings_generation', ERRCODE = 'PT003';
      END IF;
      UPDATE wallets SET opted_in = true WHERE address = p_wallet;
    ELSE
      UPDATE wallets SET opted_in = false, holdings_generation = holdings_generation + 1 WHERE address = p_wallet;
    END IF;
    result := jsonb_build_object('optedIn', p_opted_in);
    UPDATE battle_attempts SET status = 'completed', response = result, status_code = 200, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 200;
  EXCEPTION WHEN SQLSTATE 'PT001' OR SQLSTATE 'PT002' OR SQLSTATE 'PT003' THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    -- PT001 (window closed) and PT003 (lost a holdings-generation race) are
    -- operational timing, retryable under a fresh reclaim; PT002 is a real
    -- identity/precondition mismatch that resubmitting the same call won't fix.
    v_status := CASE WHEN v_sqlstate = 'PT001' THEN 503 ELSE 409 END;
    v_retryable := v_sqlstate IN ('PT001', 'PT003');
    result := jsonb_build_object('error', SQLERRM, 'retryable', v_retryable);
    UPDATE battle_attempts SET status = 'failed', retryable = v_retryable, response = result, status_code = v_status, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, v_status;
  END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION commit_holdings_refresh(
  p_nonce text, p_generation bigint, p_wallet text, p_param_hash text, p_sync_id text
) RETURNS TABLE(response jsonb, status_code integer) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  promoted boolean;
  result jsonb;
  v_sqlstate text;
  v_status integer;
  v_retryable boolean;
BEGIN
  SELECT * INTO a FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF NOT FOUND OR a.wallet != p_wallet OR a.action != 'refresh' OR a.param_hash != p_param_hash THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'identity_mismatch', 'retryable', false), 401; RETURN;
  END IF;
  IF a.status = 'completed' OR (a.status = 'failed' AND NOT a.retryable) THEN
    RETURN QUERY SELECT a.response, a.status_code; RETURN;
  END IF;
  IF a.status != 'pending' OR a.generation != p_generation
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable', 'retryable', false), 409; RETURN;
  END IF;
  BEGIN
    IF a.lease_expires_at <= clock_timestamp() OR a.retry_until <= clock_timestamp() THEN
      RAISE EXCEPTION USING MESSAGE = 'attempt_expired', ERRCODE = 'RF001';
    END IF;
    SELECT * INTO s FROM holdings_syncs WHERE sync_id = p_sync_id;
    IF NOT FOUND OR s.wallet != p_wallet OR s.attempt_nonce != p_nonce OR s.status != 'complete'
       OR s.worker_generation > p_generation THEN
      RAISE EXCEPTION USING MESSAGE = 'invalid_holdings_sync', ERRCODE = 'RF002';
    END IF;
    SELECT h.promoted INTO promoted FROM promote_holdings_snapshot(p_wallet, s.captured_holdings_generation, s.staged_cards) h;
    IF NOT promoted THEN
      RAISE EXCEPTION USING MESSAGE = 'stale_holdings_generation', ERRCODE = 'RF003';
    END IF;
    result := jsonb_build_object('refreshed', true);
    UPDATE battle_attempts SET status = 'completed', response = result, status_code = 200, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 200;
  EXCEPTION WHEN SQLSTATE 'RF001' OR SQLSTATE 'RF002' OR SQLSTATE 'RF003' THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_status := CASE WHEN v_sqlstate = 'RF001' THEN 503 ELSE 409 END;
    v_retryable := v_sqlstate IN ('RF001', 'RF003');
    result := jsonb_build_object('error', SQLERRM, 'retryable', v_retryable);
    UPDATE battle_attempts SET status = 'failed', retryable = v_retryable, response = result, status_code = v_status, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, v_status;
  END;
END;
$$ LANGUAGE plpgsql;
