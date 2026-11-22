-- =============================================================================
-- Seed 001: Reference Physical Interaction Ontology (PostgreSQL 16)
-- Project: Jack of All Trades
-- License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
-- Target Engine: Google Cloud SQL for PostgreSQL 16
--
-- Idempotent seed script matching PRD & Architecture Blueprint scenarios.
-- Run AFTER applying database/migrations/001 through 004.
-- =============================================================================

BEGIN;

-- 1. Reference Partner Brands (with starter B2B2C sponsored credit pools)
INSERT INTO brands (name, support_bounty_usd, avg_return_cost_usd, sponsored_credit_pool) VALUES
    ('NordicFlatPack Furnishings', 30.00, 145.00, 500),
    ('AquaFlow Residential Plumbing', 30.00, 165.00, 500),
    ('Samsung Home Appliances', 30.00, 180.00, 1000),
    ('Precision Fastener Standards', 30.00, 95.00, 250)
ON CONFLICT (name) DO NOTHING;

-- 2. Brand Manuals
INSERT INTO manuals (brand_id, product_sku, product_name, category, manual_summary)
SELECT b.id, v.product_sku, v.product_name, v.category, v.manual_summary
FROM (
    VALUES
        ('NordicFlatPack Furnishings', 'NFP-HINGE-110', 'Concealed 110-Degree Soft-Close Cabinet Hinge System', 'furniture',
         'Requires 15-degree bracket tilt before snapping mounting plate onto door cup.'),
        ('AquaFlow Residential Plumbing', 'AFP-PTRAP-150', 'Under-Sink Chrome Brass P-Trap & Compression Nut Assembly', 'plumbing',
         'Verify slip-joint washer bevel orientation toward trap wall; hand-tighten plus quarter turn.'),
        ('Samsung Home Appliances', 'SAM-DW-IMP400', 'Dishwasher Drain Impeller Pump & Snap-Lock Housing', 'appliance',
         'Retaining clip releases clockwise per molded wear indicators; check impeller vanes for cavitation debris.'),
        ('Precision Fastener Standards', 'ISO-METRIC-FAST', 'Metric vs Imperial Fastener Identification Reference', 'fasteners',
         'Always verify scale via WebXR depth or coin/thumb anchor before selecting hex driver or socket size.')
) AS v(brand_name, product_sku, product_name, category, manual_summary)
JOIN brands b ON b.name = v.brand_name
ON CONFLICT (brand_id, product_sku) DO NOTHING;

-- 3. Root Assemblies & Child Components (Recursive Tree)
INSERT INTO components (
    id, manual_id, parent_id, name, part_code, component_class, measurement_system,
    thread_pitch_mm, nominal_diameter_mm, visual_cue_notes, failure_precursor_cue
) VALUES
    (1,  (SELECT id FROM manuals WHERE product_sku = 'NFP-HINGE-110' LIMIT 1), NULL, 'Cabinet Door Assembly', 'CAB-DOOR-01', 'assembly', 'metric', NULL, NULL, 'Vertical panel with 35mm cup bore', 'Door sagging > 3mm at top corner'),
    (2,  (SELECT id FROM manuals WHERE product_sku = 'NFP-HINGE-110' LIMIT 1), 1,    '110-Deg Concealed Hinge Arm', 'HNG-ARM-110', 'subassembly', 'metric', NULL, 35.000, 'Brushed steel articulated arm with dual cam screws', 'Bracket misaligned > 12 degrees off mounting plate track'),
    (3,  (SELECT id FROM manuals WHERE product_sku = 'NFP-HINGE-110' LIMIT 1), 2,    'M4 Machine Screw (Hinge Plate)', 'ISO-M4-12', 'fastener', 'metric', 0.700, 4.000, 'Fine 0.7mm thread pitch; 7mm pan head', 'Frequently confused with M6 screw without scale anchor'),
    (4,  (SELECT id FROM manuals WHERE product_sku = 'ISO-METRIC-FAST' LIMIT 1), NULL, 'M6 Hex Socket Cap Screw', 'ISO-M6-20', 'fastener', 'metric', 1.000, 6.000, 'Coarse 1.0mm pitch; 10mm cylindrical socket head', 'Stripped hex recess when forced with 4mm key'),
    (5,  (SELECT id FROM manuals WHERE product_sku = 'ISO-METRIC-FAST' LIMIT 1), NULL, 'M10 Metric Hex Bolt', 'ISO-M10-150', 'fastener', 'metric', 1.500, 10.000, 'Thread pitch 1.5mm; 10mm shank diameter; stamped 8.8', 'Often confused with 3/8-inch imperial bolt'),
    (6,  (SELECT id FROM manuals WHERE product_sku = 'ISO-METRIC-FAST' LIMIT 1), NULL, '3/8-Inch UNC Imperial Bolt', 'SAE-375-16', 'fastener', 'imperial', 1.588, 9.525, '16 TPI thread profile; 9/16" hex head flats', 'Imperial socket slips on metric M10 flats'),
    (7,  (SELECT id FROM manuals WHERE product_sku = 'AFP-PTRAP-150' LIMIT 1), NULL, 'Kitchen Sink P-Trap Assembly', 'PTRAP-CH-150', 'assembly', 'imperial', NULL, 38.100, 'Reflective chrome brass J-bend under sink basin', 'Harsh flashlight glare obscures slip-joint threads'),
    (8,  (SELECT id FROM manuals WHERE product_sku = 'AFP-PTRAP-150' LIMIT 1), 7,    'Chrome Slip-Joint Compression Nut', 'NUT-SJ-150', 'fastener', 'imperial', NULL, 42.000, 'Hexagonal collar above beveled nylon washer', 'Cross-threading when tightened under active water spray'),
    (9,  (SELECT id FROM manuals WHERE product_sku = 'SAM-DW-IMP400' LIMIT 1), NULL, 'Dishwasher Drain Impeller Assembly', 'IMP-400-ASM', 'assembly', 'metric', NULL, NULL, 'Sump basin impeller beneath lower spray arm', 'Rhythmic acoustic cavitation grinding noise during drain cycle'),
    (10, (SELECT id FROM manuals WHERE product_sku = 'SAM-DW-IMP400' LIMIT 1), 9,    'Clockwise Snap-Lock Retaining Clip', 'CLIP-CW-09', 'fastener', 'metric', NULL, 28.000, 'Molded plastic wear-pattern ramp slanting clockwise', 'User forcing clip counter-clockwise risks snapping retention lug')
ON CONFLICT (id) DO NOTHING;

-- Synchronize components SERIAL sequence after explicit seed IDs
SELECT setval(pg_get_serial_sequence('components', 'id'), COALESCE((SELECT MAX(id) FROM components), 1), TRUE);

-- 4. Lateral Confusion & Interaction Edges
INSERT INTO component_edges (source_component_id, target_component_id, relationship_type, notes) VALUES
    (4, 3, 'often_confused_with', 'M6 screw commonly misidentified as M4 screw at close macro distance without scale anchor'),
    (5, 6, 'often_confused_with', 'M10 metric bolt (1.5mm pitch) vs 3/8" imperial bolt; requires 10mm socket, not 3/8"'),
    (8, 7, 'fastens_into',        'Seals vertical tailpiece to J-bend inlet'),
    (10, 9, 'blocks_access_to',   'Must rotate clockwise to lift impeller cover')
ON CONFLICT (source_component_id, target_component_id, relationship_type) DO NOTHING;

-- 5. Repair Actions with Break 2 Scale Anchor Enforcement (idempotent by component_id + action_type)
INSERT INTO repair_actions (
    component_id, action_type, tool_required, tool_size_spec, requires_scale_anchor,
    rotation_direction, instruction_text, pip_motion_prompt, success_rate
)
SELECT v.component_id, v.action_type, v.tool_required, v.tool_size_spec, v.requires_scale_anchor,
       v.rotation_direction, v.instruction_text, v.pip_motion_prompt, v.success_rate
FROM (
    VALUES
        (2,  'align',            'Phillips Screwdriver',     '#2 Phillips driver',              FALSE, 'angled',    'Tilt the hinge bracket 15 degrees inward until the rear hook seats on the mounting plate, then press the heel until it clicks flush.', 'Close-up hand guiding brushed steel cabinet hinge at 15-degree angle onto mounting bracket until snap click', 0.9420),
        (3,  'tighten',          'Hex / Phillips Driver',    'M4 driver (2.5mm hex / PH2)',     TRUE,  'clockwise', 'Seat the M4 screw square to the pre-drilled pilot hole and drive clockwise to 1.8 Nm without over-torquing.', 'Hands aligning small M4 screw squarely into hinge plate and turning driver smoothly clockwise', 0.9150),
        (5,  'tighten',          'Socket Wrench',            '10mm metric socket (NOT 3/8")',   TRUE,  'clockwise', 'Engage a 10mm metric socket fully over the M10 bolt head (1.5mm pitch) and tighten clockwise until snug.', 'Hand placing 10mm socket wrench firmly onto metric bolt head and rotating clockwise in quarter turns', 0.9310),
        (8,  'tighten',          'Slip-Joint Pliers',        '1-1/2" slip-joint nut jaw',       TRUE,  'clockwise', 'Wipe water from the chrome threads, seat the beveled washer flat-side up, hand-thread clockwise, then add 1/4 turn with padded pliers.', 'Hand wiping wet chrome sink pipe threads and turning slip-joint compression nut clockwise one quarter turn', 0.8960),
        (10, 'rotate_clockwise', 'Flat-Blade Pry / Fingers', 'Finger grip — no wrench required',FALSE, 'clockwise', 'Follow the plastic wear-ramp indicators and twist the retaining clip 30 degrees CLOCKWISE to unlock the impeller cover.', 'Close-up fingers pressing and rotating dishwasher sump retaining clip 30 degrees clockwise to release cover', 0.9640)
) AS v(component_id, action_type, tool_required, tool_size_spec, requires_scale_anchor, rotation_direction, instruction_text, pip_motion_prompt, success_rate)
WHERE NOT EXISTS (
    SELECT 1
      FROM repair_actions existing
     WHERE existing.component_id = v.component_id
       AND existing.action_type = v.action_type
);

COMMIT;
