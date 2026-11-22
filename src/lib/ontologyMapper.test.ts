import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLiveFlywheelMetrics,
  mapPgComponentNodeRow,
  mapPgFeedbackRow,
  mapPgHierarchyRow,
  normalizeBoxToPct,
  normalizeMotionCue,
} from './ontologyMapper';

test('normalizeBoxToPct converts Gemini 0..1000 [ymin, xmin, ymax, xmax] to clamped percentages', () => {
  const box = normalizeBoxToPct([200, 300, 500, 700]);
  assert.deepEqual(box, { xPct: 30, yPct: 20, wPct: 40, hPct: 30 });

  // Also handles 0..100 percentage inputs cleanly
  const pctBox = normalizeBoxToPct([15, 25, 55, 65]);
  assert.deepEqual(pctBox, { xPct: 25, yPct: 15, wPct: 40, hPct: 40 });

  // Returns fallback on malformed input
  const fallback = { xPct: 28, yPct: 24, wPct: 44, hPct: 36 };
  assert.deepEqual(normalizeBoxToPct(null, fallback), fallback);
});

test('normalizeMotionCue maps natural direction strings into crisp AR cue enums', () => {
  assert.equal(normalizeMotionCue('clockwise'), 'rotate_cw');
  assert.equal(normalizeMotionCue('counter_clockwise'), 'rotate_ccw');
  assert.equal(normalizeMotionCue('loosen left'), 'rotate_ccw');
  assert.equal(normalizeMotionCue('slide downward'), 'slide');
  assert.equal(normalizeMotionCue('lift cover'), 'lift');
  assert.equal(normalizeMotionCue('press_latch'), 'press');
  assert.equal(normalizeMotionCue('tilt 15 deg to align'), 'align');
  assert.equal(normalizeMotionCue('unknown_word'), 'inspect');
});

test('mapPgHierarchyRow maps PostgreSQL snake_case v_component_hierarchy rows to camelCase', () => {
  const mapped = mapPgHierarchyRow({
    id: 3,
    parent_id: 2,
    name: 'M4 Machine Screw (Hinge Plate)',
    component_class: 'fastener',
    depth: 2,
    breadcrumb_path: 'Cabinet Door Assembly > 110-Deg Concealed Hinge Arm > M4 Machine Screw',
    failure_precursor_cue: 'Often confused with M6 screw',
    tool_required: 'Hex / Phillips Driver',
    tool_size_spec: 'M4 driver (2.5mm hex / PH2)',
    requires_scale_anchor: true,
    success_rate: '0.9150',
    correction_count: 12,
  });

  assert.equal(mapped.id, 3);
  assert.equal(mapped.parentId, 2);
  assert.equal(mapped.componentClass, 'fastener');
  assert.equal(mapped.depth, 2);
  assert.equal(mapped.requiresScaleAnchor, true);
  assert.equal(mapped.successRate, 0.915);
  assert.equal(mapped.correctionCount, 12);
});

test('mapPgComponentNodeRow and mapPgFeedbackRow preserve metadata cleanly', () => {
  const node = mapPgComponentNodeRow({
    id: 5,
    parent_id: null,
    name: 'M10 Metric Hex Bolt',
    part_code: 'ISO-M10-150',
    component_class: 'fastener',
    measurement_system: 'metric',
    thread_pitch_mm: '1.500',
    nominal_diameter_mm: '10.000',
    requires_scale_anchor: true,
    tool_required: 'Socket Wrench',
    tool_size_spec: '10mm metric socket',
    success_rate: '0.9310',
    correction_count: 7,
  });

  assert.equal(node.partCode, 'ISO-M10-150');
  assert.equal(node.threadPitchMm, 1.5);
  assert.equal(node.nominalDiameterMm, 10);
  assert.equal(node.requiresScaleAnchor, true);

  const fb = mapPgFeedbackRow({
    id: 42,
    created_at: '2026-11-21T20:00:00.000Z',
    predicted_component_id: 4,
    predicted_name: 'M6 Hex Socket Cap Screw',
    corrected_component_id: 3,
    corrected_name: 'M4 Machine Screw',
    user_correction_tag: 'M4_not_M6',
    region_code: 'US-NYC',
  });

  assert.equal(fb.id, '42');
  assert.equal(fb.correctedComponentId, 3);
  assert.equal(fb.tag, 'M4_not_M6');
  assert.equal(fb.regionCode, 'US-NYC');
});

test('computeLiveFlywheelMetrics calculates bounty revenue and margin multiple safely', () => {
  const metrics = computeLiveFlywheelMetrics({
    deflectedReturns: 10,
    grossBountyRevenueUsd: 300,
    totalComputeUsd: 15,
    totalCorrections: 4,
    totalSessions: 14,
  });

  assert.equal(metrics.deflectedReturns, 10);
  assert.equal(metrics.bountyPerDeflectionUsd, 30);
  assert.equal(metrics.marginMultiple, 20);
  assert.equal(metrics.totalSessions, 14);
});
