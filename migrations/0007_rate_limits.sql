-- U9/U10 called for an application-layer request budget independent of the
-- daily attack/defense caps (Vercel's own WAF rate-limit rule is IP-keyed
-- and covers all of /api together -- see project memory -- so a single
-- wallet or a single caller within that shared budget still needs its own
-- narrower fence). One row per bucket key; the window resets in place
-- rather than via a separate sweep, the same inline-reset pattern
-- commit_battle already uses for the daily attack/defense caps.
CREATE TABLE rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL
);

-- Returns true if this request is within budget (and counts it), false if
-- the bucket is already over p_max_requests for the current window.
CREATE FUNCTION check_rate_limit(
  p_key text, p_window_seconds integer, p_max_requests integer
) RETURNS boolean AS $$
DECLARE
  v_now CONSTANT timestamptz := clock_timestamp();
  v_count integer;
BEGIN
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
