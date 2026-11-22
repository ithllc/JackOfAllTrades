-- =============================================================================
-- Migration 002: Authentication & RBAC Tables (PostgreSQL 16 — ADR 008)
-- Project: Jack of All Trades
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
-- Target Engine: Google Cloud SQL for PostgreSQL 16
--
-- Supports both end-user accounts (`end_user`, `technician`) and Admin Platform
-- operators (`admin`, `super_admin`) using salted `scrypt` password hashes or
-- external OIDC / Firebase Auth subject bindings.
--
-- Note: Uses native PostgreSQL 16 `gen_random_uuid()` (via pgcrypto/built-in)
-- instead of `uuid_generate_v4()` so `uuid-ossp` is never required.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL DEFAULT '',
    role            TEXT NOT NULL DEFAULT 'end_user'
                        CHECK (role IN ('end_user', 'technician', 'admin', 'super_admin')),
    auth_provider   TEXT NOT NULL DEFAULT 'email_password_scrypt'
                        CHECK (auth_provider IN ('email_password_scrypt', 'oidc_google', 'firebase_auth')),
    external_sub    TEXT UNIQUE,
    password_hash   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users (role);
CREATE INDEX IF NOT EXISTS idx_app_users_lower_email ON app_users (LOWER(email));

CREATE TABLE IF NOT EXISTS auth_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_sha256    TEXT NOT NULL UNIQUE,
    role_snapshot   TEXT NOT NULL
                        CHECK (role_snapshot IN ('end_user', 'technician', 'admin', 'super_admin')),
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_token
    ON auth_sessions (token_sha256)
    WHERE revoked_at IS NULL;

-- Associate repair diagnostic sessions with authenticated end users
ALTER TABLE diagnostic_sessions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_user ON diagnostic_sessions (user_id);

COMMIT;
