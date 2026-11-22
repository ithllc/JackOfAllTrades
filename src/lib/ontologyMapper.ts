/**
 * Jack of All Trades — PostgreSQL Ontology Row Mappers & Spatial Coordinate Utilities
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Pure, deterministic helpers that:
 *  1. Convert PostgreSQL snake_case query rows (`v_component_hierarchy`, `components`,
 *     `ontology_feedback_events`, `deflection_bounties`) into the camelCase shapes
 *     consumed by the Admin Ontology Explorer and RAG diagnostics.
 *  2. Convert Gemini normalized [ymin, xmin, ymax, xmax] (0..1000) bounding boxes
 *     into clamped viewport percentages (xPct, yPct, wPct, hPct) for AR Overlays.
 */

import type {
  OntologyComponentNode,
  OntologyFeedbackRecord,
  OntologyHierarchyRow,
} from './routingLogic';

export type RepairMotionCue =
  | 'rotate_cw'
  | 'rotate_ccw'
  | 'slide'
  | 'lift'
  | 'press'
  | 'align'
  | 'inspect';

export interface BoundingBoxPct {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface LiveFlywheelMetrics {
  deflectedReturns: number;
  bountyPerDeflectionUsd: number;
  grossBountyRevenueUsd: number;
  totalComputeUsd: number;
  marginMultiple: number;
  totalCorrections: number;
  totalSessions?: number;
}

const VALID_MOTION_CUES = new Set<RepairMotionCue>([
  'rotate_cw',
  'rotate_ccw',
  'slide',
  'lift',
  'press',
  'align',
  'inspect',
]);

/**
 * Normalizes a Gemini [ymin, xmin, ymax, xmax] bounding box (in 0..1000 image coordinates
 * OR 0..100 percentages) into safely clamped percentage coordinates for CSS positioning.
 */
export function normalizeBoxToPct(
  rawBox: unknown,
  fallback?: BoundingBoxPct
): BoundingBoxPct | null {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) {
    return fallback ?? null;
  }

  const nums = rawBox.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) {
    return fallback ?? null;
  }

  const [rawYmin, rawXmin, rawYmax, rawXmax] = nums;
  const maxVal = Math.max(rawYmin, rawXmin, rawYmax, rawXmax);
  const scale = maxVal > 100 ? 10 : 1; // 0..1000 -> divide by 10; 0..100 -> keep as %

  const y1 = Math.max(4, Math.min(92, rawYmin / scale));
  const x1 = Math.max(4, Math.min(92, rawXmin / scale));
  const y2 = Math.max(y1 + 8, Math.min(96, rawYmax / scale));
  const x2 = Math.max(x1 + 8, Math.min(96, rawXmax / scale));

  const wPct = Math.max(12, Math.min(88, Math.round((x2 - x1) * 10) / 10));
  const hPct = Math.max(12, Math.min(84, Math.round((y2 - y1) * 10) / 10));
  const xPct = Math.max(4, Math.min(96 - wPct, Math.round(x1 * 10) / 10));
  const yPct = Math.max(8, Math.min(92 - hPct, Math.round(y1 * 10) / 10));

  return { xPct, yPct, wPct, hPct };
}

/**
 * Maps arbitrary model motion strings (e.g., "clockwise", "twist_left", "push_down")
 * into a crisp AR overlay cue enum.
 */
export function normalizeMotionCue(raw: unknown): RepairMotionCue {
  if (typeof raw !== 'string') return 'inspect';
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (VALID_MOTION_CUES.has(cleaned as RepairMotionCue)) {
    return cleaned as RepairMotionCue;
  }
  if (cleaned.includes('counter') || cleaned.includes('ccw') || cleaned.includes('left') || cleaned.includes('loosen')) {
    return 'rotate_ccw';
  }
  if (cleaned.includes('clock') || cleaned.includes('cw') || cleaned.includes('tighten') || cleaned.includes('twist') || cleaned.includes('turn')) {
    return 'rotate_cw';
  }
  if (cleaned.includes('slide') || cleaned.includes('pull') || cleaned.includes('linear')) {
    return 'slide';
  }
  if (cleaned.includes('lift') || cleaned.includes('pry') || cleaned.includes('raise') || cleaned.includes('open')) {
    return 'lift';
  }
  if (cleaned.includes('press') || cleaned.includes('push') || cleaned.includes('snap') || cleaned.includes('click')) {
    return 'press';
  }
  if (cleaned.includes('align') || cleaned.includes('angle') || cleaned.includes('tilt') || cleaned.includes('seat')) {
    return 'align';
  }
  return 'inspect';
}

/**
 * Maps a PostgreSQL `v_component_hierarchy` (or `get_component_hierarchy`) row into
 * the camelCase `OntologyHierarchyRow` expected by `OntologyExplorer`.
 */
export function mapPgHierarchyRow(row: Record<string, unknown>): OntologyHierarchyRow {
  const id = Number(row.id ?? 0);
  const parentId =
    row.parent_id !== null && row.parent_id !== undefined
      ? Number(row.parent_id)
      : row.parentId !== null && row.parentId !== undefined
        ? Number(row.parentId)
        : null;

  return {
    id,
    parentId,
    name: String(row.name ?? 'Unnamed Component'),
    componentClass: String(row.component_class ?? row.componentClass ?? 'part'),
    depth: Number(row.depth ?? 0),
    breadcrumbPath: String(row.breadcrumb_path ?? row.breadcrumbPath ?? row.name ?? ''),
    failurePrecursorCue: String(row.failure_precursor_cue ?? row.failurePrecursorCue ?? ''),
    toolRequired: String(row.tool_required ?? row.toolRequired ?? 'Standard hand tool'),
    toolSizeSpec: String(row.tool_size_spec ?? row.toolSizeSpec ?? 'Standard size'),
    requiresScaleAnchor: Boolean(row.requires_scale_anchor ?? row.requiresScaleAnchor ?? false),
    successRate: Number(row.success_rate ?? row.successRate ?? 0.85),
    correctionCount: Number(row.correction_count ?? row.correctionCount ?? 0),
  };
}

/**
 * Maps a PostgreSQL `components` + `repair_actions` joined row into `OntologyComponentNode`.
 */
export function mapPgComponentNodeRow(row: Record<string, unknown>): OntologyComponentNode {
  const measurementRaw = String(row.measurement_system ?? row.measurementSystem ?? 'universal');
  const measurementSystem: 'metric' | 'imperial' | 'universal' =
    measurementRaw === 'metric' || measurementRaw === 'imperial' ? measurementRaw : 'universal';

  const rawClass = String(row.component_class ?? row.componentClass ?? 'subassembly').toLowerCase();
  const componentClass: 'assembly' | 'fastener' | 'seal' | 'subassembly' =
    rawClass === 'assembly' ||
    rawClass === 'fastener' ||
    rawClass === 'seal' ||
    rawClass === 'subassembly'
      ? rawClass
      : 'subassembly';

  const rawRot = String(row.rotation_direction ?? row.rotationDirection ?? 'linear').toLowerCase();
  const rotationDirection: 'clockwise' | 'counter_clockwise' | 'angled' | 'linear' =
    rawRot === 'clockwise' ||
    rawRot === 'counter_clockwise' ||
    rawRot === 'angled' ||
    rawRot === 'linear'
      ? rawRot
      : 'linear';

  return {
    id: Number(row.id ?? 0),
    parentId:
      row.parent_id !== null && row.parent_id !== undefined
        ? Number(row.parent_id)
        : null,
    manualSku: String(row.manual_sku ?? row.manualSku ?? 'FIELD-LEARNED'),
    brandName: String(row.brand_name ?? row.brandName ?? 'Community Ontology'),
    name: String(row.name ?? 'Unnamed Component'),
    partCode: String(row.part_code ?? row.partCode ?? `PART-${row.id ?? 0}`),
    componentClass,
    measurementSystem,
    threadPitchMm:
      row.thread_pitch_mm !== null && row.thread_pitch_mm !== undefined
        ? Number(row.thread_pitch_mm)
        : null,
    nominalDiameterMm:
      row.nominal_diameter_mm !== null && row.nominal_diameter_mm !== undefined
        ? Number(row.nominal_diameter_mm)
        : null,
    visualCueNotes: String(row.visual_cue_notes ?? row.visualCueNotes ?? ''),
    failurePrecursorCue: String(row.failure_precursor_cue ?? row.failurePrecursorCue ?? ''),
    actionType: String(row.action_type ?? row.actionType ?? 'inspect'),
    toolRequired: String(row.tool_required ?? row.toolRequired ?? 'Standard hand tool'),
    toolSizeSpec: String(row.tool_size_spec ?? row.toolSizeSpec ?? 'Standard size'),
    requiresScaleAnchor: Boolean(row.requires_scale_anchor ?? row.requiresScaleAnchor ?? false),
    rotationDirection,
    instructionText: String(row.instruction_text ?? row.instructionText ?? ''),
    pipMotionPrompt: String(row.pip_motion_prompt ?? row.pipMotionPrompt ?? ''),
    successRate: Number(row.success_rate ?? row.successRate ?? 0.85),
    correctionCount: Number(row.correction_count ?? row.correctionCount ?? 0),
    embedding: [],
  };
}

/**
 * Maps a PostgreSQL `ontology_feedback_events` joined row into `OntologyFeedbackRecord`.
 */
export function mapPgFeedbackRow(row: Record<string, unknown>): OntologyFeedbackRecord {
  const createdRaw = row.created_at ?? row.createdAt;
  const timestamp =
    createdRaw instanceof Date
      ? createdRaw.toISOString()
      : typeof createdRaw === 'string' && createdRaw
        ? createdRaw
        : new Date().toISOString();

  return {
    id: String(row.id ?? ''),
    timestamp,
    predictedComponentId:
      row.predicted_component_id !== null && row.predicted_component_id !== undefined
        ? Number(row.predicted_component_id)
        : 0,
    predictedName: String(row.predicted_name ?? row.predictedName ?? 'Auto-Detected Part'),
    correctedComponentId: Number(row.corrected_component_id ?? row.correctedComponentId ?? 0),
    correctedName: String(row.corrected_name ?? row.correctedName ?? 'Verified Component'),
    tag: String(row.user_correction_tag ?? row.tag ?? 'user_correction'),
    regionCode: String(row.region_code ?? row.regionCode ?? 'GLOBAL'),
  };
}

/**
 * Computes B2B2C Data & Revenue Flywheel metrics from live PostgreSQL aggregate counters.
 */
export function computeLiveFlywheelMetrics(agg: {
  deflectedReturns: number;
  grossBountyRevenueUsd: number;
  totalComputeUsd: number;
  totalCorrections: number;
  totalSessions?: number;
}): LiveFlywheelMetrics {
  const deflectedReturns = Math.max(0, Number(agg.deflectedReturns) || 0);
  const grossBountyRevenueUsd = Math.round((Number(agg.grossBountyRevenueUsd) || 0) * 100) / 100;
  const totalComputeUsd = Math.round((Number(agg.totalComputeUsd) || 0) * 10000) / 10000;
  const bountyPerDeflectionUsd =
    deflectedReturns > 0
      ? Math.round((grossBountyRevenueUsd / deflectedReturns) * 100) / 100
      : 30;
  const marginMultiple =
    totalComputeUsd > 0
      ? Math.round((grossBountyRevenueUsd / totalComputeUsd) * 10) / 10
      : deflectedReturns > 0
        ? 20.0
        : 0;

  return {
    deflectedReturns,
    bountyPerDeflectionUsd,
    grossBountyRevenueUsd,
    totalComputeUsd: Number(totalComputeUsd.toFixed(2)),
    marginMultiple,
    totalCorrections: Math.max(0, Number(agg.totalCorrections) || 0),
    totalSessions: agg.totalSessions !== undefined ? Math.max(0, Number(agg.totalSessions) || 0) : undefined,
  };
}
