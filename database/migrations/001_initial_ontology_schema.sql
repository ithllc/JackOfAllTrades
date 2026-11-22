-- =============================================================================
-- Migration 001: Initial Physical Interaction & Ontology Graph Schema (PostgreSQL 16)
-- Project: Jack of All Trades
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
-- Target Engine: Google Cloud SQL for PostgreSQL 16 + pgvector
--
-- Idempotent: Safe to run multiple times on fresh or existing databases.
-- Architecture Traceability:
--   - ADR 001: Replaces Neo4j with PostgreSQL 16 + Recursive CTEs for native
--     hierarchical/graph traversal and pgvector for 768-dim Gemini embeddings.
--   - PRD §2 (Graph-Driven Feedback Loop): Stores visual signature embeddings
--     and updates component centroids immediately on user corrections.
--   - PRD §3 (Data & B2B2C Revenue Flywheel): Tracks brand-sponsored manuals
--     and $30 return/support deflection bounties alongside Gemini API compute cost.
--   - Break 2 ("Scale" Hallucination Guard): Enforces requires_scale_anchor so
--     exact tool sizes are redacted when WebXR depth or a scale anchor is absent.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. PostgreSQL Extensions (pgvector for 768-dim embeddings, pgcrypto for UUIDs)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 2. Brands & Sponsored Manuals (PRD §3: B2B2C Revenue Flywheel)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(160) NOT NULL UNIQUE,
    support_bounty_usd  NUMERIC(8, 2) NOT NULL DEFAULT 30.00 CHECK (support_bounty_usd >= 0),
    avg_return_cost_usd NUMERIC(8, 2) NOT NULL DEFAULT 150.00 CHECK (avg_return_cost_usd >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manuals (
    id                  SERIAL PRIMARY KEY,
    brand_id            INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_sku         VARCHAR(120) NOT NULL,
    product_name        VARCHAR(255) NOT NULL,
    category            VARCHAR(100) NOT NULL, -- e.g., 'plumbing', 'furniture', 'appliance', 'fasteners'
    manual_uri          TEXT,
    manual_summary      TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_id, product_sku)
);

-- -----------------------------------------------------------------------------
-- 3. Physical Component Ontology Nodes (ADR 001)
--    Self-referencing parent_id enables Recursive CTE tree traversal natively
--    inside PostgreSQL without requiring a separate graph database.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS components (
    id                         SERIAL PRIMARY KEY,
    manual_id                  INT REFERENCES manuals(id) ON DELETE SET NULL,
    parent_id                  INT REFERENCES components(id) ON DELETE SET NULL,
    name                       VARCHAR(255) NOT NULL,
    part_code                  VARCHAR(100),
    component_class            VARCHAR(80) NOT NULL DEFAULT 'part', -- 'assembly', 'subassembly', 'fastener', 'seal', 'electrical'
    measurement_system         VARCHAR(16) NOT NULL DEFAULT 'metric'
                                   CHECK (measurement_system IN ('metric', 'imperial', 'universal')),
    thread_pitch_mm            NUMERIC(6, 3),      -- e.g., 1.500 for M10 Bolt, 0.700 for M4 Screw
    nominal_diameter_mm        NUMERIC(8, 3),      -- e.g., 4.000 for M4, 6.000 for M6, 10.000 for M10
    visual_cue_notes           TEXT NOT NULL DEFAULT '',
    failure_precursor_cue      TEXT NOT NULL DEFAULT '',
    visual_signature_embedding vector(768),        -- 768-dim Gemini multimodal embedding
    correction_count           INT NOT NULL DEFAULT 0,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW cosine distance index for sub-10ms RAG vector retrieval across global fleet
CREATE INDEX IF NOT EXISTS idx_components_embedding_hnsw
    ON components
    USING hnsw (visual_signature_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Adjacency indexes to accelerate Recursive CTE parent -> child lookups
CREATE INDEX IF NOT EXISTS idx_components_parent_id ON components (parent_id);
CREATE INDEX IF NOT EXISTS idx_components_manual_id ON components (manual_id);

-- -----------------------------------------------------------------------------
-- 4. Lateral Ontology Graph Edges (Misidentification & Clearance Relationships)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component_edges (
    id                  SERIAL PRIMARY KEY,
    source_component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    target_component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    relationship_type   VARCHAR(64) NOT NULL CHECK (
                            relationship_type IN (
                                'fastens_into',
                                'mates_with',
                                'often_confused_with',
                                'blocks_access_to',
                                'hazard_adjacent_to'
                            )
                        ),
    notes               TEXT NOT NULL DEFAULT '',
    weight              NUMERIC(5, 4) NOT NULL DEFAULT 1.0000,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_component_id <> target_component_id),
    UNIQUE (source_component_id, target_component_id, relationship_type)
);

-- -----------------------------------------------------------------------------
-- 5. Repair & Assembly Actions (with Break 2 Scale Anchor Guard)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_actions (
    id                     SERIAL PRIMARY KEY,
    component_id           INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    action_type            VARCHAR(50) NOT NULL,     -- e.g., 'tighten', 'replace', 'align', 'rotate_clockwise', 'inspect'
    tool_required          VARCHAR(100) NOT NULL,    -- Generic tool family, e.g., 'Hex Socket Wrench', 'Hex Key'
    tool_size_spec         VARCHAR(80),              -- Exact sizing, e.g., '10mm socket (not 3/8")' — gated by Break 2
    requires_scale_anchor  BOOLEAN NOT NULL DEFAULT TRUE,
    rotation_direction     VARCHAR(32) CHECK (rotation_direction IN ('clockwise', 'counter_clockwise', 'linear', 'angled', 'none')),
    instruction_text       TEXT NOT NULL,
    pip_motion_prompt      TEXT,                     -- Seed prompt for gemini-omni-1.2-flash PiP video loop
    success_rate           NUMERIC(5, 4) NOT NULL DEFAULT 0.8500 CHECK (success_rate >= 0 AND success_rate <= 1),
    execution_count        INT NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_actions_component_id ON repair_actions (component_id);

-- -----------------------------------------------------------------------------
-- 6. Diagnostic Sessions, Feedback Loop & B2B2C Deflection Bounties
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostic_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manual_id               INT REFERENCES manuals(id) ON DELETE SET NULL,
    client_platform         VARCHAR(40) NOT NULL DEFAULT 'web_pwa',
    ingest_mode             VARCHAR(32) NOT NULL DEFAULT 'webrtc_video'
                                CHECK (ingest_mode IN ('webrtc_video', 'burst_photo_3x')),
    has_webxr_depth         BOOLEAN NOT NULL DEFAULT FALSE,
    scale_anchor_type       VARCHAR(32) NOT NULL DEFAULT 'none'
                                CHECK (scale_anchor_type IN ('none', 'webxr_depth', 'us_quarter', 'credit_card', 'human_thumb', 'ruler')),
    decision_calls_count    INT NOT NULL DEFAULT 0,
    neon_calls_count        INT NOT NULL DEFAULT 0,
    omni_pip_calls_count    INT NOT NULL DEFAULT 0,
    estimated_compute_usd   NUMERIC(8, 4) NOT NULL DEFAULT 0.0000,
    outcome                 VARCHAR(32) NOT NULL DEFAULT 'active'
                                CHECK (outcome IN ('active', 'resolved_deflected', 'escalated_support', 'abandoned')),
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ontology_feedback_events (
    id                         BIGSERIAL PRIMARY KEY,
    session_id                 UUID REFERENCES diagnostic_sessions(id) ON DELETE SET NULL,
    predicted_component_id     INT REFERENCES components(id) ON DELETE SET NULL,
    corrected_component_id     INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    user_correction_tag        VARCHAR(80) NOT NULL,
    captured_embedding         vector(768),
    region_code                VARCHAR(32),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deflection_bounties (
    id                  BIGSERIAL PRIMARY KEY,
    session_id          UUID NOT NULL UNIQUE REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
    brand_id            INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    bounty_usd          NUMERIC(8, 2) NOT NULL DEFAULT 30.00,
    compute_cost_usd    NUMERIC(8, 4) NOT NULL DEFAULT 0.0000,
    averted_return_usd  NUMERIC(8, 2) NOT NULL DEFAULT 150.00,
    net_margin_multiple NUMERIC(8, 2) GENERATED ALWAYS AS (
                            CASE
                                WHEN compute_cost_usd > 0 THEN ROUND(bounty_usd / compute_cost_usd, 2)
                                ELSE 99.99
                            END
                        ) STORED,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 7. RECURSIVE CTEs FOR ONTOLOGY GRAPH TRAVERSAL (ADR 001)
-- =============================================================================

-- 7A. View: Full Component Hierarchy Tree with Cycle Detection
CREATE OR REPLACE VIEW v_component_hierarchy AS
WITH RECURSIVE component_tree AS (
    SELECT
        c.id,
        c.parent_id,
        c.manual_id,
        c.name,
        c.part_code,
        c.component_class,
        c.measurement_system,
        c.thread_pitch_mm,
        c.nominal_diameter_mm,
        c.failure_precursor_cue,
        0 AS depth,
        ARRAY[c.id] AS path_ids,
        c.name::TEXT AS breadcrumb_path,
        FALSE AS is_cycle
    FROM components c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
        child.id,
        child.parent_id,
        child.manual_id,
        child.name,
        child.part_code,
        child.component_class,
        child.measurement_system,
        child.thread_pitch_mm,
        child.nominal_diameter_mm,
        child.failure_precursor_cue,
        parent.depth + 1 AS depth,
        parent.path_ids || child.id AS path_ids,
        parent.breadcrumb_path || ' > ' || child.name AS breadcrumb_path,
        child.id = ANY(parent.path_ids) AS is_cycle
    FROM components child
    INNER JOIN component_tree parent ON child.parent_id = parent.id
    WHERE NOT parent.is_cycle
      AND parent.depth < 12
)
SELECT * FROM component_tree;

-- 7B. Function: Top-Down Sub-Assembly Traversal from Any Root Component
CREATE OR REPLACE FUNCTION get_component_hierarchy(root_component_id INT)
RETURNS TABLE (
    component_id          INT,
    parent_id             INT,
    name                  VARCHAR,
    component_class       VARCHAR,
    depth                 INT,
    breadcrumb_path       TEXT,
    failure_precursor_cue TEXT,
    primary_action        VARCHAR,
    tool_required         VARCHAR,
    success_rate          NUMERIC
)
LANGUAGE SQL
STABLE
AS $$
    WITH RECURSIVE sub_tree AS (
        SELECT
            c.id,
            c.parent_id,
            c.name,
            c.component_class,
            0 AS depth,
            ARRAY[c.id] AS visited_ids,
            c.name::TEXT AS breadcrumb_path,
            c.failure_precursor_cue
        FROM components c
        WHERE c.id = root_component_id

        UNION ALL

        SELECT
            child.id,
            child.parent_id,
            child.name,
            child.component_class,
            st.depth + 1,
            st.visited_ids || child.id,
            st.breadcrumb_path || ' > ' || child.name,
            child.failure_precursor_cue
        FROM components child
        INNER JOIN sub_tree st ON child.parent_id = st.id
        WHERE NOT (child.id = ANY(st.visited_ids))
          AND st.depth < 10
    )
    SELECT
        st.id AS component_id,
        st.parent_id,
        st.name,
        st.component_class,
        st.depth,
        st.breadcrumb_path,
        st.failure_precursor_cue,
        ra.action_type AS primary_action,
        ra.tool_required,
        ra.success_rate
    FROM sub_tree st
    LEFT JOIN LATERAL (
        SELECT r.action_type, r.tool_required, r.success_rate
        FROM repair_actions r
        WHERE r.component_id = st.id
        ORDER BY r.success_rate DESC
        LIMIT 1
    ) ra ON TRUE
    ORDER BY st.depth ASC, st.id ASC;
$$;

-- 7C. Function: Bottom-Up Ancestry Traversal (Leaf Fastener -> Root Product)
CREATE OR REPLACE FUNCTION get_component_ancestry(target_component_id INT)
RETURNS TABLE (
    component_id    INT,
    parent_id       INT,
    name            VARCHAR,
    component_class VARCHAR,
    hops_up         INT
)
LANGUAGE SQL
STABLE
AS $$
    WITH RECURSIVE ancestry AS (
        SELECT
            c.id,
            c.parent_id,
            c.name,
            c.component_class,
            0 AS hops_up,
            ARRAY[c.id] AS visited_ids
        FROM components c
        WHERE c.id = target_component_id

        UNION ALL

        SELECT
            p.id,
            p.parent_id,
            p.name,
            p.component_class,
            a.hops_up + 1,
            a.visited_ids || p.id
        FROM components p
        INNER JOIN ancestry a ON a.parent_id = p.id
        WHERE NOT (p.id = ANY(a.visited_ids))
          AND a.hops_up < 10
    )
    SELECT id, parent_id, name, component_class, hops_up
    FROM ancestry
    ORDER BY hops_up DESC;
$$;

-- 7D. Hybrid RAG Query: pgvector Cosine Similarity + Recursive CTE Context + Break 2 Scale Guard
CREATE OR REPLACE FUNCTION rag_search_ontology_subgraph(
    query_embedding      vector(768),
    has_scale_anchor     BOOLEAN DEFAULT FALSE,
    similarity_threshold FLOAT DEFAULT 0.60,
    max_results          INT DEFAULT 5
)
RETURNS TABLE (
    component_id          INT,
    component_name        VARCHAR,
    ancestry_path         TEXT,
    cosine_similarity     FLOAT,
    thread_pitch_mm       NUMERIC,
    visual_cue_notes      TEXT,
    failure_precursor_cue TEXT,
    action_type           VARCHAR,
    tool_required         VARCHAR,
    tool_size_spec        VARCHAR,
    scale_guard_active    BOOLEAN,
    instruction_text      TEXT,
    success_rate          NUMERIC
)
LANGUAGE SQL
STABLE
AS $$
    WITH top_matches AS (
        SELECT
            c.id,
            c.name,
            c.thread_pitch_mm,
            c.visual_cue_notes,
            c.failure_precursor_cue,
            (1.0 - (c.visual_signature_embedding <=> query_embedding))::FLOAT AS cosine_similarity
        FROM components c
        WHERE c.visual_signature_embedding IS NOT NULL
          AND (1.0 - (c.visual_signature_embedding <=> query_embedding)) >= similarity_threshold
        ORDER BY c.visual_signature_embedding <=> query_embedding ASC
        LIMIT max_results
    ),
    ancestry_paths AS (
        SELECT
            h.id,
            h.breadcrumb_path
        FROM v_component_hierarchy h
        WHERE h.id IN (SELECT id FROM top_matches)
    )
    SELECT
        tm.id AS component_id,
        tm.name AS component_name,
        COALESCE(ap.breadcrumb_path, tm.name::TEXT) AS ancestry_path,
        tm.cosine_similarity,
        tm.thread_pitch_mm,
        tm.visual_cue_notes,
        tm.failure_precursor_cue,
        ra.action_type,
        ra.tool_required,
        CASE
            WHEN ra.requires_scale_anchor AND NOT has_scale_anchor THEN
                'REDACTED — Place scale anchor (coin, credit card, or thumb) or enable WebXR depth first'
            ELSE
                ra.tool_size_spec
        END AS tool_size_spec,
        (ra.requires_scale_anchor AND NOT has_scale_anchor) AS scale_guard_active,
        ra.instruction_text,
        ra.success_rate
    FROM top_matches tm
    LEFT JOIN ancestry_paths ap ON ap.id = tm.id
    LEFT JOIN repair_actions ra ON ra.component_id = tm.id
    ORDER BY tm.cosine_similarity DESC, ra.success_rate DESC NULLS LAST;
$$;

-- 7E. Transactional Feedback Loop Updater (Test Case 2: M4 vs M6 / M10 vs 3/8" Bolt)
CREATE OR REPLACE FUNCTION apply_ontology_correction(
    p_session_id             UUID,
    p_predicted_component_id INT,
    p_corrected_component_id INT,
    p_correction_tag         VARCHAR,
    p_new_embedding          vector(768),
    p_region_code            VARCHAR DEFAULT 'GLOBAL'
)
RETURNS TABLE (
    updated_component_id INT,
    new_correction_count INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_existing vector(768);
BEGIN
    SELECT visual_signature_embedding
      INTO v_existing
      FROM components
     WHERE id = p_corrected_component_id
       FOR UPDATE;

    UPDATE components
       SET visual_signature_embedding = CASE
               WHEN v_existing IS NULL THEN p_new_embedding
               ELSE p_new_embedding
           END,
           correction_count = correction_count + 1,
           updated_at = NOW()
     WHERE id = p_corrected_component_id;

    IF p_predicted_component_id IS NOT NULL AND p_predicted_component_id <> p_corrected_component_id THEN
        INSERT INTO component_edges (source_component_id, target_component_id, relationship_type, notes)
        VALUES (
            p_predicted_component_id,
            p_corrected_component_id,
            'often_confused_with',
            'Auto-linked from user touchscreen correction: ' || p_correction_tag
        )
        ON CONFLICT (source_component_id, target_component_id, relationship_type)
        DO UPDATE SET weight = LEAST(component_edges.weight + 0.1000, 9.9999);
    END IF;

    INSERT INTO ontology_feedback_events (
        session_id,
        predicted_component_id,
        corrected_component_id,
        user_correction_tag,
        captured_embedding,
        region_code
    ) VALUES (
        p_session_id,
        p_predicted_component_id,
        p_corrected_component_id,
        p_correction_tag,
        p_new_embedding,
        p_region_code
    );

    RETURN QUERY
    SELECT c.id, c.correction_count
      FROM components c
     WHERE c.id = p_corrected_component_id;
END;
$$;

COMMIT;
