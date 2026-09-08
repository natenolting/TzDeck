-- Two bugs in commit_participation (0006) and commit_holdings_refresh
-- (0008), found by direct exercise against a real database:
--
-- 1. Both hard-coded retryable = false on every rejection, even
--    attempt_expired and stale_holdings_generation -- both operational
--    timing (a lost race, a closed authorization window), not a business
--    rule the caller broke. commit_battle (0005) already classifies this
--    correctly per SQLSTATE; these two didn't carry that pattern over, so a
--    lost race (e.g. a concurrent opt-out bumping holdings_generation)
--    permanently killed that opt-in attempt -- no path ever reached
--    reclaimAttempt for it.
-- 2. The promotion fence required s.worker_generation = p_generation
--    exactly. But stage_holdings_page refuses to touch an already-complete
--    sync at all, so worker_generation can never advance past whatever
--    generation finished staging. If the process died between staging
--    finishing and promotion running, a later reclaim bumps the ATTEMPT to
--    a new generation, and promotion becomes permanently unsatisfiable --
--    no call can ever make worker_generation equal that new generation.
--    The fence should reject a call from an OLDER generation than the one
--    that last touched the sync (s.worker_generation > p_generation, a
--    genuine takeover happened since), not merely a different one.
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
    RETURN QUERY SELECT jsonb_build_object('error', 'identity_mismatch'), 401; RETURN;
  END IF;
  IF a.status = 'completed' OR (a.status = 'failed' AND NOT a.retryable) THEN
    RETURN QUERY SELECT a.response, a.status_code; RETURN;
  END IF;
  IF a.status != 'pending' OR a.generation != p_generation
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable'), 409; RETURN;
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
    result := jsonb_build_object('error', SQLERRM);
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
    RETURN QUERY SELECT jsonb_build_object('error', 'identity_mismatch'), 401; RETURN;
  END IF;
  IF a.status = 'completed' OR (a.status = 'failed' AND NOT a.retryable) THEN
    RETURN QUERY SELECT a.response, a.status_code; RETURN;
  END IF;
  IF a.status != 'pending' OR a.generation != p_generation
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    RETURN QUERY SELECT jsonb_build_object('error', 'attempt_not_claimable'), 409; RETURN;
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
    result := jsonb_build_object('error', SQLERRM);
    UPDATE battle_attempts SET status = 'failed', retryable = v_retryable, response = result, status_code = v_status, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, v_status;
  END;
END;
$$ LANGUAGE plpgsql;
