-- Participation and its durable response are one transaction. The attempt
-- lock precedes the wallet/progress locks taken by snapshot promotion.
CREATE FUNCTION commit_participation(
  p_nonce text, p_generation bigint, p_wallet text, p_param_hash text,
  p_opted_in boolean, p_sync_id text
) RETURNS TABLE(response jsonb, status_code integer) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  promoted boolean;
  result jsonb;
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
      IF NOT FOUND OR s.wallet != p_wallet OR s.attempt_nonce != p_nonce OR s.status != 'complete' THEN
        RAISE EXCEPTION USING MESSAGE = 'invalid_holdings_sync', ERRCODE = 'PT001';
      END IF;
      SELECT h.promoted INTO promoted FROM promote_holdings_snapshot(p_wallet, s.captured_holdings_generation, s.staged_cards) h;
      IF NOT promoted THEN
        RAISE EXCEPTION USING MESSAGE = 'stale_holdings_generation', ERRCODE = 'PT001';
      END IF;
      UPDATE wallets SET opted_in = true WHERE address = p_wallet;
    ELSE
      UPDATE wallets SET opted_in = false, holdings_generation = holdings_generation + 1 WHERE address = p_wallet;
    END IF;
    result := jsonb_build_object('optedIn', p_opted_in);
    UPDATE battle_attempts SET status = 'completed', response = result, status_code = 200, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 200;
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    result := jsonb_build_object('error', SQLERRM);
    UPDATE battle_attempts SET status = 'failed', retryable = false, response = result, status_code = 409, completed_at = clock_timestamp()
      WHERE nonce = p_nonce;
    RETURN QUERY SELECT result, 409;
  END;
END;
$$ LANGUAGE plpgsql;
