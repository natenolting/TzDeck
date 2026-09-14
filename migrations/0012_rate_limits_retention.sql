-- H1: `bucket_key` is caller-controlled (a wallet address, or an
-- unauthenticated caller's derived IP) and rows never expired on their own.
-- Before this, any distinct key -- including a spoofed IP -- minted one
-- permanent row forever. Combined with fixing IP derivation to a header
-- Vercel's edge actually controls (see getClientIp), an attacker can no
-- longer manufacture unlimited distinct keys, but legitimate callers still
-- accumulate rows with no cleanup. Sweep opportunistically inside the same
-- function rather than adding separate cron infra: a bucket a full day past
-- its own window has nothing left worth keeping.
CREATE INDEX rate_limits_window_started_at_idx ON rate_limits (window_started_at);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text, p_window_seconds integer, p_max_requests integer
) RETURNS boolean AS $$
DECLARE
  v_now CONSTANT timestamptz := clock_timestamp();
  v_count integer;
BEGIN
  IF random() < 0.01 THEN
    DELETE FROM rate_limits WHERE window_started_at <= v_now - interval '1 day';
  END IF;

  INSERT INTO rate_limits (bucket_key, window_started_at, request_count)
  VALUES (p_key, v_now, 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    request_count = CASE
      WHEN rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN 1
      ELSE rate_limits.request_count + 1
    END,
    window_started_at = CASE
      WHEN rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN v_now
      ELSE rate_limits.window_started_at
    END
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_max_requests;
END;
$$ LANGUAGE plpgsql;
