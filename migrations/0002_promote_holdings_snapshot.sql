-- U4c: atomic promotion of a fully-traversed holdings snapshot. Uses the
-- same lesson U8 applies to commit_battle: a staleness check expressed only
-- as a CTE's WHERE clause does not stop sibling writes from committing, so
-- this is a real plpgsql function with an explicit RAISE EXCEPTION branch,
-- not a bare multi-CTE statement.
CREATE FUNCTION promote_holdings_snapshot(
  p_wallet text,
  p_captured_holdings_generation integer,
  p_cards jsonb -- array of {cardKey, contractAddress, tokenId, seed: {editions, descriptionLength}, source}
) RETURNS TABLE(promoted boolean, new_generation integer) AS $$
DECLARE
  v_current_generation integer;
BEGIN
  SELECT holdings_generation INTO v_current_generation
  FROM wallets WHERE address = p_wallet FOR UPDATE;

  IF v_current_generation IS NULL THEN
    RAISE EXCEPTION 'wallet_not_found';
  END IF;

  IF v_current_generation != p_captured_holdings_generation THEN
    -- Stale: opt-out (or a competing sync) changed the generation since this
    -- snapshot started. Reject without touching membership or progress.
    RETURN QUERY SELECT false, v_current_generation;
    RETURN;
  END IF;

  -- Insert missing progress rows only -- never overwrite an existing row's
  -- seed, xp, level, recovery, or progress_version.
  INSERT INTO wallet_card_progress (wallet, card_key, seed_editions, seed_description_length, seed_source)
  SELECT
    p_wallet,
    card ->> 'cardKey',
    (card -> 'seed' ->> 'editions')::integer,
    (card -> 'seed' ->> 'descriptionLength')::integer,
    card ->> 'source'
  FROM jsonb_array_elements(p_cards) AS card
  ON CONFLICT (wallet, card_key) DO NOTHING;

  -- Replace active membership atomically -- both statements are part of the
  -- same function invocation, so there's no window where matchmaking sees
  -- zero holdings mid-swap.
  DELETE FROM wallet_holdings WHERE wallet = p_wallet;
  INSERT INTO wallet_holdings (wallet, card_key)
  SELECT p_wallet, card ->> 'cardKey'
  FROM jsonb_array_elements(p_cards) AS card;

  UPDATE wallets
  SET holdings_generation = holdings_generation + 1, holdings_refreshed_at = now()
  WHERE address = p_wallet
  RETURNING holdings_generation INTO v_current_generation;

  RETURN QUERY SELECT true, v_current_generation;
END;
$$ LANGUAGE plpgsql;
