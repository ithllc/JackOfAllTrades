-- =============================================================================
-- Migration 003: Stripe Credit Ledger & B2B2C Deflection Proofs (PostgreSQL 16 — ADR 009)
-- Project: Jack of All Trades
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
-- Target Engine: Google Cloud SQL for PostgreSQL 16
--
-- Creates provider-agnostic end-user credit wallets, idempotent Stripe webhook
-- deduplication records, double-entry credit ledger audit logs, and tamper-evident
-- SHA-256 B2B2C brand deflection proof certificates.
--
-- Note: Uses native PostgreSQL 16 `gen_random_uuid()` instead of `uuid_generate_v4()`.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_credit_wallets (
    user_id                 UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    stripe_customer_id      TEXT UNIQUE,
    credit_balance          INTEGER NOT NULL DEFAULT 2 CHECK (credit_balance >= 0),
    starter_credits_granted INTEGER NOT NULL DEFAULT 2 CHECK (starter_credits_granted >= 0),
    subscription_status     TEXT NOT NULL DEFAULT 'none'
                                CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled')),
    stripe_subscription_id  TEXT UNIQUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type
    ON stripe_webhook_events (event_type, processed_at DESC);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    delta_credits              INTEGER NOT NULL,
    reason                     TEXT NOT NULL
                                   CHECK (reason IN (
                                       'starter_grant',
                                       'stripe_pack_purchase',
                                       'stripe_subscription_cycle',
                                       'scan_problem_charge',
                                       'voice_assist_charge',
                                       'generate_pip_charge',
                                       'brand_sponsored_rebate',
                                       'admin_adjustment',
                                       'refund_reversal'
                                   )),
    amount_cents               INTEGER,
    stripe_checkout_session_id TEXT,
    stripe_event_id            TEXT UNIQUE,
    diagnostic_session_id      UUID REFERENCES diagnostic_sessions(id) ON DELETE SET NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user
    ON credit_ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_session
    ON credit_ledger_entries (diagnostic_session_id)
    WHERE diagnostic_session_id IS NOT NULL;

-- Verifiable B2B2C Deflection Proof Certificates (links QR/portal/SKU repairs to brands)
CREATE TABLE IF NOT EXISTS brand_deflection_proofs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             UUID NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
    brand_id               INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    product_sku            TEXT NOT NULL,
    attribution_channel    TEXT NOT NULL
                               CHECK (attribution_channel IN (
                                   'brand_qr_box',
                                   'support_portal_redirect',
                                   'barcode_sku_scan',
                                   'organic_camera'
                               )),
    attribution_ref        TEXT,
    before_issue_summary   TEXT NOT NULL,
    after_verified_state   TEXT NOT NULL,
    verified_by_vision     BOOLEAN NOT NULL DEFAULT FALSE,
    proof_sha256           TEXT NOT NULL UNIQUE,
    sponsored_credits_used INTEGER NOT NULL DEFAULT 0 CHECK (sponsored_credits_used >= 0),
    bounty_usd             NUMERIC(10, 2) NOT NULL DEFAULT 30.00 CHECK (bounty_usd >= 0),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_deflection_proofs_brand
    ON brand_deflection_proofs (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brand_deflection_proofs_session
    ON brand_deflection_proofs (session_id);

COMMIT;
