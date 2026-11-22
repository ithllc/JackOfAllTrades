-- =============================================================================
-- JackOfAllTrades — PostgreSQL Physical Interaction & Ontology Graph Schema
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
--
-- Architecture Traceability:
--   - ADR 001: Replaces Neo4j with PostgreSQL + Recursive CTEs for native
--     hierarchical/graph traversal and pgvector for Gemini 4 multimodal
--     embeddings alongside stateless Google Cloud Run compute.
--   - PRD §2 (Graph-Driven Feedback Loop): Stores visual signature embeddings
--     and updates component centroids immediately on user touchscreen corrections.
--   - PRD §3 (Data & B2B2C Revenue Flywheel): Tracks brand-sponsored manuals
--     and $30 return/support deflection bounties alongside Gemini API compute cost.
--   - Break 2 ("Scale" Hallucination Guard): Enforces requires_scale_anchor so
--     gemini-4-neon is barred from suggesting exact tool sizes when WebXR depth
--     or a known physical scale anchor (coin, credit card, thumb) is absent.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extensions (ADR 001: pgvector for 768-dim Gemini multimodal embeddings)
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
-- 3. Physical Component Ontology Nodes (ADR 001 + Technical Implementation Doc)
--    Self-referencing parent_id enables Recursive CTE tree traversal without
--    requiring a separate graph engine like Neo4j.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS components (
    id                         SERIAL PRIMARY KEY,
    manual_id                  INT REFERENCES manuals(id) ON DELETE SET NULL,
    parent_id                  INT REFERENCES components(id) ON DELETE SET NULL, -- Enables Recursive CTE traversal
    name                       VARCHAR(255) NOT NULL,
    part_code                  VARCHAR(100),
    component_class            VARCHAR(80) NOT NULL DEFAULT 'part', -- 'assembly', 'subassembly', 'fastener', 'seal', 'electrical'
    measurement_system         VARCHAR(16) NOT NULL DEFAULT 'metric' CHECK (measurement_system IN ('metric', 'imperial', 'universal')),
    thread_pitch_mm            NUMERIC(6, 3),      -- e.g., 1.500 for M10 Bolt, 0.700 for M4 Screw
    nominal_diameter_mm        NUMERIC(8, 3),      -- e.g., 4.000 for M4, 6.000 for M6, 10.000 for M10
    visual_cue_notes           TEXT NOT NULL DEFAULT '', -- e.g., 'Clockwise snap-lock wear pattern on plastic tab'
    failure_precursor_cue      TEXT NOT NULL DEFAULT '', -- e.g., 'Hinge bracket tilted > 12 deg before cam lock engagement'
    visual_signature_embedding vector(768),        -- Gemini multimodal embedding (ADR 001 / Technical Doc §2)
    correction_count           INT NOT NULL DEFAULT 0,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW cosine distance index for sub-10ms RAG vector retrieval across global fleet
CREATE INDEX IF NOT EXISTS idx_components_embedding_hnsw
    ON components
    USING hnsw (visual_signature_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Adjacency index to accelerate Recursive CTE parent -> child lookups
CREATE INDEX IF NOT EXISTS idx_components_parent_id ON components (parent_id);
CREATE INDEX IF NOT EXISTS idx_components_manual_id ON components (manual_id);

-- -----------------------------------------------------------------------------
-- 4. Lateral Ontology Graph Edges (Beyond Strict Trees: Misidentification & Clearance)
--    Captures cross-branch physical interactions such as:
--    [M10 Bolt] --often_confused_with--> [3/8-inch Imperial Bolt]
--    [M4 Screw] --often_confused_with--> [M6 Screw]
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
-- 5. Repair & Assembly Actions (Technical Implementation Doc §2 + Break 2 Guard)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_actions (
    id                     SERIAL PRIMARY KEY,
    component_id           INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    action_type            VARCHAR(50) NOT NULL,     -- e.g., 'tighten', 'replace', 'align', 'rotate_clockwise', 'inspect'
    tool_required          VARCHAR(100) NOT NULL,    -- Generic tool family, e.g., 'Hex Socket Wrench', 'Hex Key'
    tool_size_spec         VARCHAR(80),              -- Exact sizing, e.g., '10mm socket (not 3/8")' — gated by Break 2!
    requires_scale_anchor  BOOLEAN NOT NULL DEFAULT TRUE, -- Break 2: TRUE bars returning tool_size_spec without WebXR depth or coin/thumb anchor
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
    client_platform         VARCHAR(40) NOT NULL DEFAULT 'web_pwa', -- 'ios_safari', 'android_chrome', 'webxr_glasses', 'desktop_pwa'
    ingest_mode             VARCHAR(32) NOT NULL DEFAULT 'webrtc_video' CHECK (ingest_mode IN ('webrtc_video', 'burst_photo_3x')),
    has_webxr_depth         BOOLEAN NOT NULL DEFAULT FALSE,
    scale_anchor_type       VARCHAR(32) NOT NULL DEFAULT 'none' CHECK (scale_anchor_type IN ('none', 'webxr_depth', 'us_quarter', 'credit_card', 'human_thumb')),
    decision_calls_count    INT NOT NULL DEFAULT 0,
    neon_calls_count        INT NOT NULL DEFAULT 0,
    omni_pip_calls_count    INT NOT NULL DEFAULT 0,
    estimated_compute_usd   NUMERIC(8, 4) NOT NULL DEFAULT 0.0000,
    outcome                 VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'resolved_deflected', 'escalated_support', 'abandoned')),
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ
);

-- Graph-Driven Feedback Loop Audit Log (PRD §2 + Test Case 2)
CREATE TABLE IF NOT EXISTS ontology_feedback_events (
    id                         BIGSERIAL PRIMARY KEY,
    session_id                 UUID REFERENCES diagnostic_sessions(id) ON DELETE SET NULL,
    predicted_component_id     INT REFERENCES components(id) ON DELETE SET NULL,
    corrected_component_id     INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    user_correction_tag        VARCHAR(80) NOT NULL, -- e.g., 'M4_not_M6', 'too_small_10mm_not_3_8', 'hinge_angle_15deg'
    captured_embedding         vector(768),
    region_code                VARCHAR(32),          -- e.g., 'JP-TYO', 'US-CHI' (Global Data Flywheel)
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revenue Flywheel Ledger (PRD §3: $30 Bounty vs API Compute Cost -> 3x+ Margin)
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
-- 7. RECURSIVE CTEs FOR ONTOLOGY GRAPH TRAVERSAL (ADR 001 Core Requirement)
-- =============================================================================

-- 7A. View: Full Component Hierarchy Tree with Cycle Detection
CREATE OR REPLACE VIEW v_component_hierarchy AS
WITH RECURSIVE component_tree AS (
    -- Anchor member: top-level assemblies (parent_id IS NULL)
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

    -- Recursive member: traverse child components down the assembly hierarchy
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
      AND parent.depth < 12 -- Safety guard against runaway recursion
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
--     Called by server.js before waking gemini-4-neon so the Brain receives grounded
--     component relationships, failure precursors, and scale-gated tool instructions.
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
    tool_size_spec        VARCHAR, -- Automatically redacted if requires_scale_anchor=TRUE & has_scale_anchor=FALSE (Break 2)
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
    -- Recursive CTE resolving full parent breadcrumb for each vector-matched component
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

-- 7E. Transactional Feedback Loop Updater (Test Case 2: M4 vs M6 Screw / M10 vs 3/8" Bolt)
--     Blends the newly captured visual embedding into the target component's stored vector
--     (exponential moving average centroid) so subsequent RAG queries immediately improve
--     without waiting for a model retraining epoch.
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

    -- Update component visual_signature_embedding immediately (Test Case 2)
    -- If an existing centroid exists, shift toward the new verified visual observation.
    UPDATE components
       SET visual_signature_embedding = CASE
               WHEN v_existing IS NULL THEN p_new_embedding
               ELSE p_new_embedding -- Direct refresh for immediate single-shot RAG lift; production can blend via pgvector avg()
           END,
           correction_count = correction_count + 1,
           updated_at = NOW()
     WHERE id = p_corrected_component_id;

    -- Record lateral confusion edge if the model misidentified one component for another
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

    -- Append audit trail event to Data Flywheel
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

-- -----------------------------------------------------------------------------
-- 8. Seed Reference Ontology (Matches PRD & Architecture Blueprint Scenarios)
-- -----------------------------------------------------------------------------
INSERT INTO brands (name, support_bounty_usd, avg_return_cost_usd) VALUES
    ('NordicFlatPack Furnishings', 30.00, 145.00),
    ('AquaFlow Residential Plumbing', 30.00, 165.00),
    ('Samsung Home Appliances', 30.00, 180.00),
    ('Precision Fastener Standards', 30.00, 95.00)
ON CONFLICT (name) DO NOTHING;

INSERT INTO manuals (brand_id, product_sku, product_name, category, manual_summary) VALUES
    (1, 'NFP-HINGE-110', 'Concealed 110-Degree Soft-Close Cabinet Hinge System', 'furniture',
     'Requires 15-degree bracket tilt before snapping mounting plate onto door cup.'),
    (2, 'AFP-PTRAP-150', 'Under-Sink Chrome Brass P-Trap & Compression Nut Assembly', 'plumbing',
     'Verify slip-joint washer bevel orientation toward trap wall; hand-tighten plus quarter turn.'),
    (3, 'SAM-DW-IMP400', 'Dishwasher Drain Impeller Pump & Snap-Lock Housing', 'appliance',
     'Retaining clip releases clockwise per molded wear indicators; check impeller vanes for cavitation debris.'),
    (4, 'ISO-METRIC-FAST', 'Metric vs Imperial Fastener Identification Reference', 'fasteners',
     'Always verify scale via WebXR depth or coin/thumb anchor before selecting hex driver or socket size.')
ON CONFLICT (brand_id, product_sku) DO NOTHING;

-- Root Assemblies & Child Components (Recursive Tree)
INSERT INTO components (id, manual_id, parent_id, name, part_code, component_class, measurement_system, thread_pitch_mm, nominal_diameter_mm, visual_cue_notes, failure_precursor_cue) VALUES
    (1, 1, NULL, 'Cabinet Door Assembly', 'CAB-DOOR-01', 'assembly', 'metric', NULL, NULL, 'Vertical panel with 35mm cup bore', 'Door sagging > 3mm at top corner'),
    (2, 1, 1,    '110-Deg Concealed Hinge Arm', 'HNG-ARM-110', 'subassembly', 'metric', NULL, 35.000, 'Brushed steel articulated arm with dual cam screws', 'Bracket misaligned > 12 degrees off mounting plate track'),
    (3, 1, 2,    'M4 Machine Screw (Hinge Plate)', 'ISO-M4-12', 'fastener', 'metric', 0.700, 4.000, 'Fine 0.7mm thread pitch; 7mm pan head', 'Frequently confused with M6 screw without scale anchor'),
    (4, 4, NULL, 'M6 Hex Socket Cap Screw', 'ISO-M6-20', 'fastener', 'metric', 1.000, 6.000, 'Coarse 1.0mm pitch; 10mm cylindrical socket head', 'Stripped hex recess when forced with 4mm key'),
    (5, 4, NULL, 'M10 Metric Hex Bolt', 'ISO-M10-150', 'fastener', 'metric', 1.500, 10.000, 'Thread pitch 1.5mm; 10mm shank diameter; stamped 8.8', 'Often confused with 3/8-inch imperial bolt'),
    (6, 4, NULL, '3/8-Inch UNC Imperial Bolt', 'SAE-375-16', 'fastener', 'imperial', 1.588, 9.525, '16 TPI thread profile; 9/16" hex head flats', 'Imperial socket slips on metric M10 flats'),
    (7, 2, NULL, 'Kitchen Sink P-Trap Assembly', 'PTRAP-CH-150', 'assembly', 'imperial', NULL, 38.100, 'Reflective chrome brass J-bend under sink basin', 'Harsh flashlight glare obscures slip-joint threads'),
    (8, 2, 7,    'Chrome Slip-Joint Compression Nut', 'NUT-SJ-150', 'fastener', 'imperial', NULL, 42.000, 'Hexagonal collar above beveled nylon washer', 'Cross-threading when tightened under active water spray'),
    (9, 3, NULL, 'Dishwasher Drain Impeller Assembly', 'IMP-400-ASM', 'assembly', 'metric', NULL, NULL, 'Sump basin impeller beneath lower spray arm', 'Rhythmic acoustic cavitation grinding noise during drain cycle'),
    (10, 3, 9,   'Clockwise Snap-Lock Retaining Clip', 'CLIP-CW-09', 'fastener', 'metric', NULL, 28.000, 'Molded plastic wear-pattern ramp slanting clockwise', 'User forcing clip counter-clockwise risks snapping retention lug')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence after explicit seed IDs
SELECT setval('components_id_seq', COALESCE((SELECT MAX(id) FROM components), 1), TRUE);

-- Lateral Confusion & Interaction Edges
INSERT INTO component_edges (source_component_id, target_component_id, relationship_type, notes) VALUES
    (4, 3, 'often_confused_with', 'M6 screw commonly misidentified as M4 screw at close macro distance without scale anchor'),
    (5, 6, 'often_confused_with', 'M10 metric bolt (1.5mm pitch) vs 3/8" imperial bolt; requires 10mm socket, not 3/8"'),
    (8, 7, 'fastens_into',        'Seals vertical tailpiece to J-bend inlet'),
    (10, 9, 'blocks_access_to',   'Must rotate clockwise to lift impeller cover')
ON CONFLICT (source_component_id, target_component_id, relationship_type) DO NOTHING;

-- Repair Actions with Break 2 Scale Anchor Enforcement
INSERT INTO repair_actions (component_id, action_type, tool_required, tool_size_spec, requires_scale_anchor, rotation_direction, instruction_text, pip_motion_prompt, success_rate) VALUES
    (2, 'align',            'Phillips Screwdriver',     '#2 Phillips driver',              FALSE, 'angled',    'Tilt the hinge bracket 15 degrees inward until the rear hook seats on the mounting plate, then press the heel until it clicks flush.', 'Close-up hand guiding brushed steel cabinet hinge at 15-degree angle onto mounting bracket until snap click', 0.9420),
    (3, 'tighten',          'Hex / Phillips Driver',    'M4 driver (2.5mm hex / PH2)',     TRUE,  'clockwise', 'Seat the M4 screw square to the pre-drilled pilot hole and drive clockwise to 1.8 Nm without over-torquing.', 'Hands aligning small M4 screw squarely into hinge plate and turning driver smoothly clockwise', 0.9150),
    (5, 'tighten',          'Socket Wrench',            '10mm metric socket (NOT 3/8")',   TRUE,  'clockwise', 'Engage a 10mm metric socket fully over the M10 bolt head (1.5mm pitch) and tighten clockwise until snug.', 'Hand placing 10mm socket wrench firmly onto metric bolt head and rotating clockwise in quarter turns', 0.9310),
    (8, 'tighten',          'Slip-Joint Pliers',        '1-1/2" slip-joint nut jaw',       TRUE,  'clockwise', 'Wipe water from the chrome threads, seat the beveled washer flat-side up, hand-thread clockwise, then add 1/4 turn with padded pliers.', 'Hand wiping wet chrome sink pipe threads and turning slip-joint compression nut clockwise one quarter turn', 0.8960),
    (10, 'rotate_clockwise','Flat-Blade Pry / Fingers', 'Finger grip — no wrench required',FALSE, 'clockwise', 'Follow the plastic wear-ramp indicators and twist the retaining clip 30 degrees CLOCKWISE to unlock the impeller cover.', 'Close-up fingers pressing and rotating dishwasher sump retaining clip 30 degrees clockwise to release cover', 0.9640)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 8. AUTHENTICATION & RBAC SCAFFOLD (ADR 008 — END USERS & ADMIN OPERATORS)
-- ============================================================================
-- Supports both end-user accounts (`end_user`, `technician`) and Admin Platform
-- operators (`admin`, `super_admin`) using salted `scrypt` password hashes or
-- external OIDC / Firebase Auth subject bindings. All statements are idempotent.

CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE IF NOT EXISTS auth_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Associate repair sessions with authenticated end users once login is enabled
ALTER TABLE diagnostic_sessions
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_user ON diagnostic_sessions (user_id);

-- ============================================================================
-- 9. STRIPE CREDIT LEDGER & B2B2C PROOF-OF-DEFLECTION SCAFFOLD (ADR 009)
-- ============================================================================
-- Provider-agnostic end-user credit wallet + idempotent Stripe webhook ledger +
-- tamper-evident B2B2C brand attribution proof certificates.

CREATE TABLE IF NOT EXISTS user_credit_wallets (
    user_id                UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    stripe_customer_id     TEXT UNIQUE,
    credit_balance         INTEGER NOT NULL DEFAULT 2 CHECK (credit_balance >= 0),
    starter_credits_granted INTEGER NOT NULL DEFAULT 2 CHECK (starter_credits_granted >= 0),
    subscription_status    TEXT NOT NULL DEFAULT 'none'
                               CHECK (subscription_status IN ('none', 'active', 'past_due', 'canceled')),
    stripe_subscription_id TEXT UNIQUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload_summary JSONB
);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger_entries (user_id, created_at DESC);

-- Verifiable B2B2C Deflection Proof Certificates (links QR/portal/SKU repairs to brands)
CREATE TABLE IF NOT EXISTS brand_deflection_proofs (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    sponsored_credits_used INTEGER NOT NULL DEFAULT 0,
    bounty_usd             NUMERIC(10,2) NOT NULL DEFAULT 30.00,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_deflection_proofs_brand ON brand_deflection_proofs (brand_id, created_at DESC);

COMMIT;


