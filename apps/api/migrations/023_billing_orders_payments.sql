CREATE TABLE billing_orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  product_id uuid NOT NULL REFERENCES billing_products(id),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','paid','fulfilled','expired','cancelled','refund_pending','refunded','refund_failed','needs_review')),
  units bigint NOT NULL CHECK (units > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  provider text NOT NULL,
  provider_order_id text,
  provider_transaction_id text,
  checkout_url text,
  qr_code text,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(user_id, idempotency_key),
  UNIQUE(provider, provider_order_id)
);
CREATE INDEX billing_orders_user_created_idx ON billing_orders(user_id, created_at DESC, id DESC);
CREATE INDEX billing_orders_status_expires_idx ON billing_orders(status, expires_at);

CREATE TABLE billing_payment_events (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  event_type text NOT NULL,
  payload_hash char(64) NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE billing_refunds (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES billing_orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed','needs_review')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  units bigint NOT NULL CHECK (units > 0),
  reason text NOT NULL,
  provider_refund_id text,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(user_id, idempotency_key),
  UNIQUE(provider_refund_id)
);

CREATE TABLE billing_reconciliation_runs (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  statement_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','mismatch')),
  matched_count integer NOT NULL,
  mismatch_count integer NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(provider, statement_date)
);
CREATE TABLE billing_reconciliation_items (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES billing_reconciliation_runs(id) ON DELETE CASCADE,
  provider_transaction_id text NOT NULL,
  order_id uuid REFERENCES billing_orders(id),
  statement_amount_minor bigint NOT NULL,
  local_amount_minor bigint,
  status text NOT NULL CHECK (status IN ('matched','missing_local','amount_mismatch')),
  UNIQUE(run_id, provider_transaction_id)
);
