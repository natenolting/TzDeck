-- U1: core battle-system tables. No payment method is attached to the Neon
-- resource this runs against in production (Key Technical Decisions) -- that
-- is an operational guardrail enforced at provisioning time, not by this file.

CREATE TABLE wallets (
  address             text PRIMARY KEY,
  opted_in            boolean NOT NULL DEFAULT false,
  attack_count        integer NOT NULL DEFAULT 0 CHECK (attack_count >= 0),
  attack_reset_at     timestamptz NOT NULL DEFAULT now(),
  defense_count       integer NOT NULL DEFAULT 0 CHECK (defense_count >= 0),
  defense_reset_at    timestamptz NOT NULL DEFAULT now(),
  holdings_generation integer NOT NULL DEFAULT 0 CHECK (holdings_generation >= 0),
  holdings_refreshed_at timestamptz
);

CREATE TABLE wallet_card_progress (
  wallet            text NOT NULL REFERENCES wallets(address),
  card_key          text NOT NULL,
  xp                bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  seed_editions     integer NOT NULL CHECK (seed_editions >= 1),
  seed_description_length integer NOT NULL CHECK (seed_description_length >= 0),
  seed_source       text NOT NULL,
  seed_captured_at  timestamptz NOT NULL DEFAULT now(),
  recovery_until    timestamptz,
  recovery_reason   text CHECK (recovery_reason IN ('offensive', 'defensive')),
  progress_version  bigint NOT NULL DEFAULT 0 CHECK (progress_version >= 0),
  PRIMARY KEY (wallet, card_key),
  CHECK (recovery_reason IS NULL OR recovery_until IS NOT NULL)
);

CREATE TABLE battle_attempts (
  nonce             text PRIMARY KEY,
  wallet            text NOT NULL,
  action            text NOT NULL,
  param_hash        text NOT NULL,
  issued_at         timestamptz NOT NULL,
  first_claimed_at  timestamptz,
  retry_until       timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  generation        bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  lease_expires_at  timestamptz,
  retryable         boolean,
  response          jsonb,
  status_code       integer,
  completed_at      timestamptz
);
CREATE INDEX battle_attempts_wallet_idx ON battle_attempts (wallet);

CREATE TABLE battle_log (
  id                bigserial PRIMARY KEY,
  attempt_nonce     text NOT NULL UNIQUE REFERENCES battle_attempts(nonce),
  attacker_wallet   text NOT NULL,
  attacker_card_key text NOT NULL,
  defender_wallet   text NOT NULL,
  defender_card_key text NOT NULL,
  winner_wallet     text,
  loser_wallet      text,
  outcome           text NOT NULL CHECK (outcome IN ('win', 'draw')),
  settled_at        timestamptz NOT NULL,
  rules_version     text NOT NULL,
  inputs            jsonb NOT NULL,
  rng_seed          text NOT NULL,
  xp_awarded        bigint,
  resulting_level   integer,
  resulting_xp      bigint,
  CHECK ((outcome = 'draw') = (winner_wallet IS NULL AND loser_wallet IS NULL))
);
CREATE INDEX battle_log_decay_idx ON battle_log (winner_wallet, loser_wallet, settled_at);

CREATE TABLE wallet_holdings (
  wallet       text NOT NULL REFERENCES wallets(address),
  card_key     text NOT NULL,
  promoted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, card_key)
);

CREATE TABLE holdings_syncs (
  sync_id                     text PRIMARY KEY,
  wallet                      text NOT NULL REFERENCES wallets(address),
  attempt_nonce               text NOT NULL REFERENCES battle_attempts(nonce),
  worker_generation           bigint NOT NULL,
  captured_holdings_generation integer NOT NULL,
  cursor                      text,
  status                      text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'complete', 'stale')),
  staged_cards                jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rules_versions (
  version      text PRIMARY KEY,
  config       jsonb NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now()
);
