-- P1 review fix: stage_holdings_page (0006) fenced writes only against the
-- sync row's own cached worker_generation, never against battle_attempts --
-- the actual source of truth every other write (commit_battle,
-- commit_participation) fences against. reclaimAttempt bumps the ATTEMPT's
-- generation on takeover but never touches holdings_syncs.worker_generation,
-- so a superseded worker could still write as long as the new worker hadn't
-- staged a page yet (worker_generation was still whatever the old worker
-- last set it to).
--
-- Reproduced in a rolled-back transaction: after reclaiming an attempt from
-- generation 0 to 1, a call still using generation 0 completed staging
-- successfully; the real (generation 1) worker's call was then rejected
-- because the sync was already 'complete' -- a fully stale worker had
-- written and closed out a sync the current worker never touched.
--
-- Fix: lock and check the attempt's current generation, pending status, live
-- lease, and retry deadline atomically with the staging write, before ever
-- touching the sync row. The attempt row is locked first, matching the
-- canonical lock order used elsewhere (the attempt is the outermost lock;
-- everything it authorizes is locked after it).
DROP FUNCTION stage_holdings_page(text, bigint, jsonb, text, boolean);

CREATE FUNCTION stage_holdings_page(
  p_nonce text,
  p_sync_id text,
  p_generation bigint,
  p_new_cards jsonb, -- array of StagedCard
  p_next_cursor text,
  p_complete boolean
) RETURNS TABLE(ok boolean, stale boolean) AS $$
DECLARE
  a battle_attempts;
  s holdings_syncs;
  v_merged jsonb;
  v_seen text[];
  v_card jsonb;
BEGIN
  SELECT * INTO a FROM battle_attempts WHERE nonce = p_nonce FOR UPDATE;
  IF NOT FOUND OR a.generation != p_generation OR a.status != 'pending'
     OR a.lease_expires_at IS NULL OR a.lease_expires_at <= clock_timestamp()
     OR a.retry_until <= clock_timestamp() THEN
    -- A takeover (generation moved on), an expired-but-not-yet-reclaimed
    -- lease, or a closed retry window -- every case means "this caller is
    -- not the current authorized worker," indistinguishable from "stale" to
    -- the caller either way.
    RETURN QUERY SELECT false, true;
    RETURN;
  END IF;

  SELECT * INTO s FROM holdings_syncs WHERE sync_id = p_sync_id FOR UPDATE;
  IF NOT FOUND OR s.attempt_nonce != p_nonce OR s.status != 'in_progress' THEN
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
