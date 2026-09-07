-- Follow-up review: staging (store.ts's old stageHoldingsPage) did a bare
-- read/merge/write across two separate round trips with no ownership check
-- at all, and promotion never confirmed the sync it was promoting was
-- staged by the CURRENT attempt generation -- a worker that lost its lease
-- to a takeover could still overwrite newer pages, or a stale sync could be
-- promoted after a takeover already resumed and completed it.
--
-- Fixed the same way as commit_battle/promote_holdings_snapshot: the whole
-- check-merge-write cycle for one staged page lives inside a single plpgsql
-- call (the neon serverless HTTP driver auto-commits each separate call, so
-- a lock taken by one call is gone before the next call could use it -- see
-- store.ts's Sql doc comment). worker_generation on holdings_syncs is the
-- fence: a call from a strictly older generation than the row's current
-- worker_generation is a superseded worker and its write is silently
-- dropped, not applied.
CREATE FUNCTION stage_holdings_page(
  p_sync_id text,
  p_generation bigint,
  p_new_cards jsonb, -- array of StagedCard
  p_next_cursor text,
  p_complete boolean
) RETURNS TABLE(ok boolean, stale boolean) AS $$
DECLARE
  s holdings_syncs;
  v_merged jsonb;
  v_seen text[];
  v_card jsonb;
BEGIN
  SELECT * INTO s FROM holdings_syncs WHERE sync_id = p_sync_id FOR UPDATE;
  IF NOT FOUND OR s.status != 'in_progress' OR p_generation < s.worker_generation THEN
    RETURN QUERY SELECT false, true;
    RETURN;
  END IF;

  v_merged := s.staged_cards;
  SELECT array_agg(elem ->> 'cardKey') INTO v_seen FROM jsonb_array_elements(v_merged) elem;
  IF v_seen IS NULL THEN
    v_seen := ARRAY[]::text[];
  END IF;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p_new_cards) LOOP
    IF NOT (v_card ->> 'cardKey' = ANY(v_seen)) THEN
      v_merged := v_merged || jsonb_build_array(v_card);
      v_seen := v_seen || (v_card ->> 'cardKey');
    END IF;
  END LOOP;

  UPDATE holdings_syncs SET
    staged_cards = v_merged,
    cursor = p_next_cursor,
    worker_generation = p_generation,
    status = CASE WHEN p_complete THEN 'complete' ELSE status END,
    updated_at = now()
  WHERE sync_id = p_sync_id;

  RETURN QUERY SELECT true, false;
END;
$$ LANGUAGE plpgsql;

-- promote_holdings_snapshot itself already fences on wallets.holdings_generation
-- (0002); the caller must additionally confirm the sync it's promoting was
-- both completed AND last staged by the generation now attempting to
-- promote it, so a superseded worker can never trigger a promotion using a
-- sync a newer worker resumed and finished under its own generation.
CREATE OR REPLACE FUNCTION commit_participation(
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
      IF NOT FOUND OR s.wallet != p_wallet OR s.attempt_nonce != p_nonce OR s.status != 'complete'
         OR s.worker_generation != p_generation THEN
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
