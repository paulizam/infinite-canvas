ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

CREATE TABLE admin_mfa_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext bytea NOT NULL,
  secret_iv bytea NOT NULL,
  secret_tag bytea NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  last_counter bigint NOT NULL DEFAULT -1,
  created_at timestamptz NOT NULL,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE admin_mfa_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX admin_mfa_recovery_user_idx ON admin_mfa_recovery_codes(user_id, used_at);
