-- A trainer fight only ever locks the attacker's own wallets/progress rows --
-- there is no real defender wallet to lock, no defender opted_in check, no
-- defense_count, and no two-wallet lock ordering. Branching commit_battle
-- with an is_trainer flag would tangle two different transaction shapes
-- together for no shared benefit, so this is a separate function instead.
--
-- p_base_xp_award already has the trainer discount and the gap-based
-- tier-mismatch decay applied by rules.ts::trainerBaseXpAward before this is
-- called -- this function applies only the repeat-win decay (R20's existing
-- formula), the same split commit_battle already uses for baseXpAward vs its
-- own decay stage.
CREATE FUNCTION commit_trainer_battle(
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
    DELETE FROM battle_log WHERE settled_at <= clock_timestamp() - interval '30 days';
  END IF;

  SELECT * INTO v_attempt FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF v_attempt IS NULL OR v_attempt.generation != p_generation OR v_attempt.status != 'pending' THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable'), 409;
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
    v_result := jsonb_build_object('error', SQLERRM);
    UPDATE battle_attempts SET status = 'failed', response = v_result, status_code = v_status,
      retryable = (v_sqlstate IN ('BT011', 'BT012'))
    WHERE nonce = p_nonce AND generation = p_generation;
    RETURN QUERY SELECT v_result, v_status;
    RETURN;
  END;
END;
$$ LANGUAGE plpgsql;
