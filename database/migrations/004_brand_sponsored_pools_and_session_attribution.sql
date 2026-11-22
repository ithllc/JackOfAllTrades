-- =============================================================================
-- Migration 004: Brand Sponsored Pools, Session Attribution & Ruler Scale Anchor
-- Project: Jack of All Trades
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
-- Target Engine: Google Cloud SQL for PostgreSQL 16
--
-- Closes schema gaps identified during the full-stack repository audit:
--   1. Adds prepaid OEM `sponsored_credit_pool` and `stripe_brand_customer_id`
--      to `brands` (required by ADR 009 B2B2C sponsored repair passes).
--   2. Adds B2B2C attribution & credit tracking columns to `diagnostic_sessions`
--      (`attribution_channel`, `attribution_brand_id`, `attribution_sku`,
--       `attribution_ref`, `credits_charged`).
--   3. Expands `diagnostic_sessions.scale_anchor_type` CHECK constraint safely
--      to allow `'ruler'` (matching `src/lib/scaleCalibration.ts`).
--   4. Adds query performance indexes for Cloud SQL telemetry & audit queries.
-- =============================================================================

BEGIN;

-- 1. Brand-Sponsored Credit Pools & Stripe Customer Bindings (ADR 009)
ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS sponsored_credit_pool INTEGER NOT NULL DEFAULT 0
        CHECK (sponsored_credit_pool >= 0),
    ADD COLUMN IF NOT EXISTS stripe_brand_customer_id TEXT UNIQUE;

-- 2. Diagnostic Session Attribution & Credit Metering Columns
ALTER TABLE diagnostic_sessions
    ADD COLUMN IF NOT EXISTS attribution_channel VARCHAR(40) NOT NULL DEFAULT 'organic_camera'
        CHECK (attribution_channel IN (
            'brand_qr_box',
            'support_portal_redirect',
            'barcode_sku_scan',
            'organic_camera'
        )),
    ADD COLUMN IF NOT EXISTS attribution_brand_id INT REFERENCES brands(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS attribution_sku VARCHAR(120),
    ADD COLUMN IF NOT EXISTS attribution_ref TEXT,
    ADD COLUMN IF NOT EXISTS credits_charged INTEGER NOT NULL DEFAULT 0
        CHECK (credits_charged >= 0);

-- 3. Expand scale_anchor_type CHECK constraint idempotently to include 'ruler'
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname
      INTO v_constraint_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE rel.relname = 'diagnostic_sessions'
       AND nsp.nspname = current_schema()
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) LIKE '%scale_anchor_type%'
     LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE diagnostic_sessions DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE diagnostic_sessions
        ADD CONSTRAINT diagnostic_sessions_scale_anchor_type_check
        CHECK (scale_anchor_type IN (
            'none',
            'webxr_depth',
            'us_quarter',
            'credit_card',
            'human_thumb',
            'ruler'
        ));
END $$;

-- 4. Indexes for attribution reporting, feedback joins, and wallet lookups
CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_attribution_brand
    ON diagnostic_sessions (attribution_brand_id, started_at DESC)
    WHERE attribution_brand_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ontology_feedback_session
    ON ontology_feedback_events (session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_credit_wallets_stripe_customer
    ON user_credit_wallets (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

COMMIT;
