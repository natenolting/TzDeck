-- H4: staged_cards had no upper bound. Every page rebuilds a text[] of every
-- card seen so far and does a linear ANY() scan per incoming card before
-- rewriting the whole growing jsonb blob -- O(n^2) total work, O(n) rewrite
-- per page, for a wallet with an unbounded number of tokens (any Tezos
-- wallet can hold or self-mint as many as it likes). Capping the total
-- distinct cards a sync will ever stage bounds that blowup to a fixed
-- worst case instead of letting one wallet's collection size dictate the
-- database's sustained CPU cost. A wallet over the cap fails the sync
-- outright rather than being allowed to keep paging forever.
DROP FUNCTION stage_holdings_page(text, text, bigint, jsonb, text, boolean);

CREATE FUNCTION stage_holdings_page(
  p_nonce text,
  p_sync_id text,
  p_generation bigint,
  p_new_cards jsonb, -- array of StagedCard
  p_next_cursor text,
  p_complete boolean
) RETURNS TABLE(ok boolean, stale boolean, too_large boolean) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  v_merged jsonb;
  v_seen text[];
  v_card jsonb;
  v_max_staged_cards CONSTANT integer := 2000;
BEGIN
  SELECT * INTO a FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF NOT FOUND OR a.generation != p_generation OR a.status != 'pending'
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    RETURN QUERY SELECT false, true, false;
    RETURN;
  END IF;

  SELECT * INTO s FROM holdings_syncs WHERE sync_id = p_sync_id FOR UPDATE;
  IF NOT FOUND OR s.attempt_nonce != p_nonce OR s.status != 'in_progress' THEN
    RETURN QUERY SELECT false, true, false;
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

  IF jsonb_array_length(v_merged) > v_max_staged_cards THEN
    RETURN QUERY SELECT false, false, true;
    RETURN;
  END IF;

  UPDATE holdings_syncs SET
    staged_cards = v_merged,
    cursor = p_next_cursor,
    worker_generation = p_generation,
    status = CASE WHEN p_complete THEN 'complete' ELSE status END,
    updated_at = now()
  WHERE sync_id = p_sync_id;

  RETURN QUERY SELECT true, false, false;
END;
$$ LANGUAGE plpgsql;
