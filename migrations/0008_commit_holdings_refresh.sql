-- The refresh route had the same atomicity gap the review flagged in
-- opt-in (0004/0006's commit_participation): it called
-- promoteHoldingsSnapshot and completeAttempt as two separate statements,
-- so a crash between them left a promoted snapshot with no completed
-- response recorded. Refresh never touches wallets.opted_in, so it gets its
-- own function rather than overloading commit_participation's opted_in
-- branching.
CREATE FUNCTION commit_holdings_refresh(
  p_nonce text, p_generation bigint, p_wallet text, p_param_hash text, p_sync_id text
) RETURNS TABLE(response jsonb, status_code integer) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  promoted boolean;
  result jsonb;
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
       OR s.worker_generation != p_generation THEN
      RAISE EXCEPTION USING MESSAGE = 'invalid_holdings_sync', ERRCODE = 'RF001';
    END IF;
    SELECT h.promoted INTO promoted FROM promote_holdings_snapshot(p_wallet, s.captured_holdings_generation, s.staged_cards) h;
    IF NOT promoted THEN
      RAISE EXCEPTION USING MESSAGE = 'stale_holdings_generation', ERRCODE = 'RF001';
    END IF;
    result := jsonb_build_object('refreshed', true);
    UPDATE battle_attempts SET status = 'completed', response = result, status_code = 200, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 200;
  EXCEPTION WHEN SQLSTATE 'RF001' THEN
    result := jsonb_build_object('error', SQLERRM);
    UPDATE battle_attempts SET status = 'failed', retryable = false, response = result, status_code = 409, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 409;
  END;
END;
$$ LANGUAGE plpgsql;
