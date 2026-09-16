-- Trainer battles draw from their own daily allowance, independent of the
-- existing PvP attack_count/attack_reset_at -- practicing against a trainer
-- should never eat into (or be capped by) the same budget as attacking
-- another wallet's card. Same shape and reset semantics as the PvP pair.
ALTER TABLE wallets
  ADD COLUMN trainer_attack_count integer NOT NULL DEFAULT 0 CHECK (trainer_attack_count >= 0),
  ADD COLUMN trainer_attack_reset_at timestamptz NOT NULL DEFAULT now();
