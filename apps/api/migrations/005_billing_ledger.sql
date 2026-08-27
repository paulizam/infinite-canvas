CREATE TABLE billing_wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_units bigint NOT NULL DEFAULT 0 CHECK (balance_units BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE billing_price_rules (
  logical_model_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN ('text','image','video','audio','agent')),
  base_units bigint NOT NULL CHECK (base_units BETWEEN 0 AND 9007199254740991),
  multiplier_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(logical_model_id, capability)
);

CREATE TABLE billing_ledger_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES generation_jobs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  entry_type text NOT NULL CHECK (entry_type IN ('reserve','settle','refund','adjustment')),
  amount_units bigint NOT NULL,
  balance_after_units bigint NOT NULL CHECK (balance_after_units BETWEEN 0 AND 9007199254740991),
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX billing_ledger_user_created_idx
  ON billing_ledger_entries(user_id, created_at DESC, id DESC);

ALTER TABLE generation_jobs
  ADD COLUMN billing_state text NOT NULL DEFAULT 'free'
    CHECK (billing_state IN ('free','reserved','settled','refunded','needs_review')),
  ADD COLUMN estimated_units bigint NOT NULL DEFAULT 0 CHECK (estimated_units BETWEEN 0 AND 9007199254740991),
  ADD COLUMN reserved_units bigint NOT NULL DEFAULT 0 CHECK (reserved_units BETWEEN 0 AND 9007199254740991),
  ADD COLUMN actual_units bigint CHECK (actual_units IS NULL OR actual_units BETWEEN 0 AND 9007199254740991);

CREATE FUNCTION reject_billing_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing ledger entries are immutable';
END;
$$;
CREATE TRIGGER billing_ledger_no_update
  BEFORE UPDATE OR DELETE ON billing_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_billing_ledger_mutation();
