/**
 * JackOfAllTrades — Decoupled Core Routing, Adaptive Ingest, Motion Gate & Ontology Graph Engine
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Pure, deterministic TypeScript logic shared by the React PWA, Express backend,
 * and fast node:test unit tests (ADR 001, ADR 003, Break 1, Break 2, Test Cases 1-3).
 */

export type MediaIngestMode = 'webrtc_15fps' | 'webrtc_5fps' | 'burst_photo_3x';
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';
export type ScaleAnchorType = 'none' | 'webxr_depth' | 'us_quarter' | 'credit_card' | 'human_thumb';

export interface NetworkAndDeviceConditions {
  downlinkMbps: number;
  rttMs: number;
  thermalState: ThermalState;
  extremeVisualNoise: boolean;
  effectiveType?: '4g' | '3g' | '2g' | 'slow-2g' | 'wifi';
}

export interface MediaIngestDecision {
  mode: MediaIngestMode;
  targetFps: number;
  maxWidth: number;
  reason: string;
  voicePrompt: string | null;
  requiresBurstCapture: boolean;
}

/**
 * Evaluates adaptive media ingest mode (PRD §2, Test Case 1, Hardest Input, Break 1).
 * Gracefully degrades from 15 fps WebRTC -> 5 fps WebRTC -> 3-shot high-contrast burst photography
 * whenever bandwidth drops (3G / high RTT), thermal throttling engages, or lens glare/water is detected.
 */
export function evaluateMediaIngestMode(cond: NetworkAndDeviceConditions): MediaIngestDecision {
  if (cond.extremeVisualNoise) {
    return {
      mode: 'burst_photo_3x',
      targetFps: 0,
      maxWidth: 1280,
      reason: 'Extreme visual noise detected (glare, water droplets, or motion blur).',
      voicePrompt: "I can't see the threading clearly. Wipe the lens and hold still for three high-contrast burst photos.",
      requiresBurstCapture: true,
    };
  }

  const isLowBandwidth =
    cond.downlinkMbps < 1.2 ||
    cond.rttMs > 350 ||
    cond.effectiveType === '3g' ||
    cond.effectiveType === '2g' ||
    cond.effectiveType === 'slow-2g';

  if (isLowBandwidth) {
    return {
      mode: 'burst_photo_3x',
      targetFps: 0,
      maxWidth: 1024,
      reason: `Low bandwidth or high latency detected (${cond.downlinkMbps.toFixed(1)} Mbps, ${Math.round(cond.rttMs)} ms RTT).`,
      voicePrompt: 'Network latency is high. Switching from video stream to three high-contrast burst photos. Hold still.',
      requiresBurstCapture: true,
    };
  }

  if (cond.thermalState === 'serious' || cond.thermalState === 'critical') {
    return {
      mode: 'burst_photo_3x',
      targetFps: 0,
      maxWidth: 1024,
      reason: `Device thermal limit reached (${cond.thermalState}). Halting continuous video to prevent screen dimming.`,
      voicePrompt: 'Device is running warm. Switching to three still burst photos to protect your display brightness.',
      requiresBurstCapture: true,
    };
  }

  if (cond.thermalState === 'fair' || cond.downlinkMbps < 3.5 || cond.rttMs > 180) {
    return {
      mode: 'webrtc_5fps',
      targetFps: 5,
      maxWidth: 640,
      reason: 'Moderate network or thermal headroom — throttling WebRTC buffer to 5 fps.',
      voicePrompt: null,
      requiresBurstCapture: false,
    };
  }

  return {
    mode: 'webrtc_15fps',
    targetFps: 15,
    maxWidth: 640,
    reason: 'Nominal bandwidth and thermals — streaming adaptive 15 fps WebRTC ring buffer.',
    voicePrompt: null,
    requiresBurstCapture: false,
  };
}

/**
 * Wasm-compatible grayscale frame-difference motion estimator (ADR 003 / Break 1 / Test Case 3).
 * Returns normalized mean absolute difference in [0, 1] between two equal-length luma buffers.
 */
export function computeFrameMotionDelta(prevLuma: Uint8Array, nextLuma: Uint8Array): number {
  const len = Math.min(prevLuma.length, nextLuma.length);
  if (len === 0) return 0;
  let diffSum = 0;
  for (let i = 0; i < len; i++) {
    diffSum += Math.abs(prevLuma[i] - nextLuma[i]);
  }
  return diffSum / (len * 255);
}

export interface HesitationGateState {
  stillMs: number;
  triggered: boolean;
  lastMotionDelta: number;
}

/**
 * Updates client-side stillness accumulator (Break 1: triggers Decisions API only when hands
 * stay stationary for >= thresholdMs, default 3000ms, cutting API traffic by ~85%).
 */
export function evaluateHesitationTrigger(
  previous: HesitationGateState,
  motionDelta: number,
  elapsedMs: number,
  motionThreshold = 0.022,
  stillnessThresholdMs = 3000
): HesitationGateState {
  if (motionDelta >= motionThreshold) {
    return {
      stillMs: 0,
      triggered: false,
      lastMotionDelta: motionDelta,
    };
  }
  const nextStillMs = previous.stillMs + Math.max(0, elapsedMs);
  return {
    stillMs: nextStillMs,
    triggered: nextStillMs >= stillnessThresholdMs,
    lastMotionDelta: motionDelta,
  };
}

export interface DecisionsCheckScores {
  userStalled: number;         // P(true) from gemini-decision-1 noul
  hazardProximity: number;     // P(true) from gemini-decision-1 noul
  alignmentAnomaly: number;    // P(true) from gemini-decision-1 noul
  visualNoiseExtreme: number;  // P(true) from gemini-decision-1 noul
  cameraFocused: number;       // P(true) from gemini-decision-1 noul
  objectInFrame: number;       // P(true) from gemini-decision-1 noul
}

export interface DecisionsRouteOutcome {
  shouldEscalateToNeon: boolean;
  shouldDowngradeToBurst: boolean;
  dominantTrigger: 'hazard_proximity' | 'alignment_anomaly' | 'user_stalled' | 'visual_noise_extreme' | 'nominal';
  maxAnomalyConfidence: number;
  reason: string;
}

export const ANOMALY_CONFIDENCE_THRESHOLD = 0.78;

/**
 * Evaluates calibrated zero-token probabilities from gemini-decision-1 (ADR 003 / Test Case 3).
 * Strict rule: ONLY call gemini-4-neon if a high-confidence anomaly (>= 0.78) is returned.
 */
export function evaluateDecisionsRouting(
  scores: DecisionsCheckScores,
  threshold = ANOMALY_CONFIDENCE_THRESHOLD
): DecisionsRouteOutcome {
  if (scores.visualNoiseExtreme >= threshold) {
    return {
      shouldEscalateToNeon: false,
      shouldDowngradeToBurst: true,
      dominantTrigger: 'visual_noise_extreme',
      maxAnomalyConfidence: scores.visualNoiseExtreme,
      reason: 'Decisions API detected extreme glare, water droplets, or motion blur. Downgrading to 3-shot burst photography.',
    };
  }

  const candidates: Array<{ key: 'hazard_proximity' | 'alignment_anomaly' | 'user_stalled'; value: number }> = [
    { key: 'hazard_proximity', value: scores.hazardProximity },
    { key: 'alignment_anomaly', value: scores.alignmentAnomaly },
    { key: 'user_stalled', value: scores.userStalled },
  ];

  candidates.sort((a, b) => b.value - a.value);
  const top = candidates[0];

  if (top.value >= threshold) {
    return {
      shouldEscalateToNeon: true,
      shouldDowngradeToBurst: false,
      dominantTrigger: top.key,
      maxAnomalyConfidence: top.value,
      reason: `High-confidence anomaly (${top.key} = ${(top.value * 100).toFixed(1)}%). Waking gemini-4-neon with 15-second buffer + ontology RAG.`,
    };
  }

  return {
    shouldEscalateToNeon: false,
    shouldDowngradeToBurst: false,
    dominantTrigger: 'nominal',
    maxAnomalyConfidence: top.value,
    reason: 'Nominal progress verified with zero output tokens. Holding gemini-4-neon asleep.',
  };
}

export interface DiagnosisToolAdvice {
  toolRequired: string;
  toolSizeSpec: string | null;
  requiresScaleAnchor: boolean;
  instructionText: string;
}

export interface ScaleGatedAdvice {
  toolRequired: string;
  toolSizeSpec: string;
  scaleGuardBlocked: boolean;
  instructionText: string;
  anchorPrompt: string | null;
}

/**
 * Enforces Break 2 ("Scale" Hallucination Guard):
 * If WebXR depth data and a known physical scale anchor (coin, credit card, thumb) are BOTH absent,
 * gemini-4-neon is barred from outputting a specific tool size.
 */
export function enforceScaleAnchorInvariant(
  advice: DiagnosisToolAdvice,
  scaleAnchor: ScaleAnchorType,
  hasWebXRDepth: boolean
): ScaleGatedAdvice {
  const hasScaleReference = hasWebXRDepth || scaleAnchor !== 'none';
  if (advice.requiresScaleAnchor && !hasScaleReference) {
    return {
      toolRequired: advice.toolRequired,
      toolSizeSpec: 'Locked — Scale anchor required',
      scaleGuardBlocked: true,
      instructionText:
        'Place a standard reference object (US quarter coin, credit card, or your thumb) beside the part before selecting a specific tool size.',
      anchorPrompt: 'Place a coin, credit card, or your thumb next to the component so scale can be calibrated safely.',
    };
  }

  return {
    toolRequired: advice.toolRequired,
    toolSizeSpec: advice.toolSizeSpec ?? 'Standard hand fit',
    scaleGuardBlocked: false,
    instructionText: advice.instructionText,
    anchorPrompt: null,
  };
}

// =============================================================================
// Recursive CTE & Vector Similarity Ontology Graph (In-Memory Parity with schema.sql)
// =============================================================================

export interface OntologyComponentNode {
  id: number;
  parentId: number | null;
  manualSku: string;
  brandName: string;
  name: string;
  partCode: string;
  componentClass: 'assembly' | 'subassembly' | 'fastener' | 'seal';
  measurementSystem: 'metric' | 'imperial' | 'universal';
  threadPitchMm: number | null;
  nominalDiameterMm: number | null;
  visualCueNotes: string;
  failurePrecursorCue: string;
  actionType: string;
  toolRequired: string;
  toolSizeSpec: string;
  requiresScaleAnchor: boolean;
  rotationDirection: 'clockwise' | 'counter_clockwise' | 'angled' | 'linear';
  instructionText: string;
  pipMotionPrompt: string;
  successRate: number;
  correctionCount: number;
  embedding: number[]; // Normalized compact signature vector (mirrors pgvector cosine space)
}

export interface OntologyHierarchyRow {
  id: number;
  parentId: number | null;
  name: string;
  componentClass: string;
  depth: number;
  breadcrumbPath: string;
  failurePrecursorCue: string;
  toolRequired: string;
  toolSizeSpec: string;
  requiresScaleAnchor: boolean;
  successRate: number;
  correctionCount: number;
}

export interface OntologyFeedbackRecord {
  id: string;
  timestamp: string;
  predictedComponentId: number;
  predictedName: string;
  correctedComponentId: number;
  correctedName: string;
  tag: string;
  regionCode: string;
}

export interface OntologyRagMatch {
  component: OntologyComponentNode;
  ancestryPath: string;
  similarity: number;
  scaleGatedAdvice: ScaleGatedAdvice;
}

/**
 * Cosine similarity matching PostgreSQL pgvector `<=>` operator (1 - cosine_distance).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Deterministic 8-dimensional feature projection for local tests & fast fallback when
 * PostgreSQL / gemini-embedding-2 isn't reachable. Preserves cosine clustering semantics.
 */
export function buildFeatureVector(seedValues: number[]): number[] {
  const norm = Math.sqrt(seedValues.reduce((acc, v) => acc + v * v, 0)) || 1;
  return seedValues.map((v) => Number((v / norm).toFixed(6)));
}

export function createSeedOntologyNodes(): OntologyComponentNode[] {
  return [
    {
      id: 1,
      parentId: null,
      manualSku: 'NFP-HINGE-110',
      brandName: 'NordicFlatPack Furnishings',
      name: 'Cabinet Door Assembly',
      partCode: 'CAB-DOOR-01',
      componentClass: 'assembly',
      measurementSystem: 'metric',
      threadPitchMm: null,
      nominalDiameterMm: null,
      visualCueNotes: 'Vertical melamine door panel with 35mm concealed cup bore.',
      failurePrecursorCue: 'Door sagging > 3mm at top latch corner.',
      actionType: 'inspect',
      toolRequired: 'Spirit Level',
      toolSizeSpec: 'Standard 300mm level',
      requiresScaleAnchor: false,
      rotationDirection: 'linear',
      instructionText: 'Confirm cabinet carcase is square before snapping hinge arms onto mounting plates.',
      pipMotionPrompt: 'Close-up hand checking alignment of cabinet door edge against frame.',
      successRate: 0.96,
      correctionCount: 4,
      embedding: buildFeatureVector([0.92, 0.25, 0.10, 0.08, 0.12, 0.05, 0.14, 0.20]),
    },
    {
      id: 2,
      parentId: 1,
      manualSku: 'NFP-HINGE-110',
      brandName: 'NordicFlatPack Furnishings',
      name: '110-Deg Concealed Hinge Arm',
      partCode: 'HNG-ARM-110',
      componentClass: 'subassembly',
      measurementSystem: 'metric',
      threadPitchMm: null,
      nominalDiameterMm: 35.0,
      visualCueNotes: 'Brushed steel articulated hinge arm with dual depth/lateral cam screws.',
      failurePrecursorCue: 'Bracket angled > 12 degrees off mounting plate track (Tokyo->Chicago flywheel cue).',
      actionType: 'align',
      toolRequired: 'Phillips Screwdriver',
      toolSizeSpec: '#2 Phillips driver',
      requiresScaleAnchor: false,
      rotationDirection: 'angled',
      instructionText: 'Tilt the hinge bracket 15 degrees inward to hook the front pins, then press the rear heel until it snaps flush.',
      pipMotionPrompt: 'Hands tilting brushed steel concealed cabinet hinge at 15-degree angle onto mounting plate until snap click.',
      successRate: 0.942,
      correctionCount: 19,
      embedding: buildFeatureVector([0.84, 0.52, 0.14, 0.05, 0.09, 0.11, 0.20, 0.18]),
    },
    {
      id: 3,
      parentId: 2,
      manualSku: 'NFP-HINGE-110',
      brandName: 'NordicFlatPack Furnishings',
      name: 'M4 Machine Screw (Hinge Plate)',
      partCode: 'ISO-M4-12',
      componentClass: 'fastener',
      measurementSystem: 'metric',
      threadPitchMm: 0.7,
      nominalDiameterMm: 4.0,
      visualCueNotes: 'Fine 0.7mm thread pitch; 4mm shank diameter; compact pan/socket head.',
      failurePrecursorCue: 'Frequently misidentified as M6 screw at close macro range without scale anchor.',
      actionType: 'tighten',
      toolRequired: 'Hex / Phillips Driver',
      toolSizeSpec: 'M4 driver (2.5mm hex / PH2)',
      requiresScaleAnchor: true,
      rotationDirection: 'clockwise',
      instructionText: 'Seat the M4 screw square to the mounting plate pilot hole and tighten clockwise to 1.8 Nm.',
      pipMotionPrompt: 'Fingers aligning M4 screw into steel hinge plate and turning driver smoothly clockwise.',
      successRate: 0.915,
      correctionCount: 12,
      embedding: buildFeatureVector([0.16, 0.18, 0.82, 0.48, 0.12, 0.09, 0.08, 0.11]),
    },
    {
      id: 4,
      parentId: null,
      manualSku: 'ISO-METRIC-FAST',
      brandName: 'Precision Fastener Standards',
      name: 'M6 Hex Socket Cap Screw',
      partCode: 'ISO-M6-20',
      componentClass: 'fastener',
      measurementSystem: 'metric',
      threadPitchMm: 1.0,
      nominalDiameterMm: 6.0,
      visualCueNotes: 'Coarse 1.0mm thread pitch; 10mm cylindrical socket head; 5mm hex key recess.',
      failurePrecursorCue: 'Stripped socket recess when driven with undersized 4mm hex key.',
      actionType: 'tighten',
      toolRequired: 'Metric Hex Key',
      toolSizeSpec: '5mm hex key (for M6 cap screw)',
      requiresScaleAnchor: true,
      rotationDirection: 'clockwise',
      instructionText: 'Verify 5mm hex key seats fully to the bottom of the M6 socket recess before applying clockwise torque.',
      pipMotionPrompt: 'Hand inserting 5mm hex key straight into M6 socket head cap screw and rotating clockwise.',
      successRate: 0.892,
      correctionCount: 9,
      embedding: buildFeatureVector([0.14, 0.16, 0.86, 0.44, 0.10, 0.07, 0.06, 0.09]),
    },
    {
      id: 5,
      parentId: null,
      manualSku: 'ISO-METRIC-FAST',
      brandName: 'Precision Fastener Standards',
      name: 'M10 Metric Hex Bolt',
      partCode: 'ISO-M10-150',
      componentClass: 'fastener',
      measurementSystem: 'metric',
      threadPitchMm: 1.5,
      nominalDiameterMm: 10.0,
      visualCueNotes: 'Thread pitch 1.5mm; 10mm shank; metric 8.8 head marking.',
      failurePrecursorCue: 'Confused with 3/8-inch imperial bolt; requires 10mm/17mm metric socket, not imperial.',
      actionType: 'tighten',
      toolRequired: 'Metric Socket Wrench',
      toolSizeSpec: '10mm metric socket (NOT 3/8" imperial)',
      requiresScaleAnchor: true,
      rotationDirection: 'clockwise',
      instructionText: 'Switch to a calibrated metric socket—do not force an imperial 3/8-inch tool onto 1.5mm pitch metric hardware.',
      pipMotionPrompt: 'Mechanic fitting metric socket onto hex bolt head and tightening clockwise in steady quarter turns.',
      successRate: 0.931,
      correctionCount: 15,
      embedding: buildFeatureVector([0.10, 0.14, 0.56, 0.78, 0.16, 0.08, 0.05, 0.07]),
    },
    {
      id: 7,
      parentId: null,
      manualSku: 'AFP-PTRAP-150',
      brandName: 'AquaFlow Residential Plumbing',
      name: 'Kitchen Sink P-Trap Assembly',
      partCode: 'PTRAP-CH-150',
      componentClass: 'assembly',
      measurementSystem: 'imperial',
      threadPitchMm: null,
      nominalDiameterMm: 38.1,
      visualCueNotes: 'Reflective chrome-plated brass J-bend under kitchen basin.',
      failurePrecursorCue: 'Flashlight specular glare + water droplets degrade continuous video tracking.',
      actionType: 'inspect',
      toolRequired: 'Microfiber Cloth & Bucket',
      toolSizeSpec: 'Standard 1-1/2" drain union',
      requiresScaleAnchor: false,
      rotationDirection: 'linear',
      instructionText: 'Wipe lens and chrome nut dry, then verify the J-bend tailpiece sits vertically without shear stress.',
      pipMotionPrompt: 'Hand wiping wet chrome P-trap pipe under sink with cloth to reveal compression nut threading.',
      successRate: 0.908,
      correctionCount: 11,
      embedding: buildFeatureVector([0.08, 0.11, 0.10, 0.12, 0.92, 0.34, 0.09, 0.05]),
    },
    {
      id: 8,
      parentId: 7,
      manualSku: 'AFP-PTRAP-150',
      brandName: 'AquaFlow Residential Plumbing',
      name: 'Chrome Slip-Joint Compression Nut',
      partCode: 'NUT-SJ-150',
      componentClass: 'fastener',
      measurementSystem: 'imperial',
      threadPitchMm: null,
      nominalDiameterMm: 42.0,
      visualCueNotes: 'Hexagonal chrome nut sealing nylon slip-joint washer.',
      failurePrecursorCue: 'Cross-threading risk when forced under low visibility and active spray.',
      actionType: 'tighten',
      toolRequired: 'Slip-Joint Pliers',
      toolSizeSpec: '1-1/2" slip-joint jaw',
      requiresScaleAnchor: true,
      rotationDirection: 'clockwise',
      instructionText: 'Seat the beveled nylon washer bevel-down, hand-thread clockwise until seated, then finish with one quarter turn.',
      pipMotionPrompt: 'Close-up hand threading chrome slip-joint nut clockwise by hand, then applying quarter turn with pliers.',
      successRate: 0.896,
      correctionCount: 14,
      embedding: buildFeatureVector([0.09, 0.10, 0.12, 0.15, 0.85, 0.50, 0.08, 0.06]),
    },
    {
      id: 9,
      parentId: null,
      manualSku: 'SAM-DW-IMP400',
      brandName: 'Samsung Home Appliances',
      name: 'Dishwasher Drain Impeller Assembly',
      partCode: 'IMP-400-ASM',
      componentClass: 'assembly',
      measurementSystem: 'metric',
      threadPitchMm: null,
      nominalDiameterMm: null,
      visualCueNotes: 'Lower sump impeller housing beneath removable coarse filter screen.',
      failurePrecursorCue: 'Rhythmic acoustic cavitation grinding sound during drain pump cycle.',
      actionType: 'inspect',
      toolRequired: 'Inspection Flashlight',
      toolSizeSpec: 'No socket required',
      requiresScaleAnchor: false,
      rotationDirection: 'linear',
      instructionText: 'Clear glass or seed debris around impeller vanes before re-seating the sump cover.',
      pipMotionPrompt: 'Hand lifting dishwasher sump cover to inspect drain impeller vanes for trapped debris.',
      successRate: 0.948,
      correctionCount: 7,
      embedding: buildFeatureVector([0.07, 0.09, 0.08, 0.06, 0.14, 0.12, 0.91, 0.34]),
    },
    {
      id: 10,
      parentId: 9,
      manualSku: 'SAM-DW-IMP400',
      brandName: 'Samsung Home Appliances',
      name: 'Clockwise Snap-Lock Retaining Clip',
      partCode: 'CLIP-CW-09',
      componentClass: 'fastener',
      measurementSystem: 'metric',
      threadPitchMm: null,
      nominalDiameterMm: 28.0,
      visualCueNotes: 'Molded wear-pattern ramp on dark polymer clip clearly slants clockwise.',
      failurePrecursorCue: 'Forcing retaining clip counter-clockwise snaps the plastic retention lug.',
      actionType: 'rotate_clockwise',
      toolRequired: 'Finger Grip',
      toolSizeSpec: 'No wrench — manual 30-deg clockwise twist',
      requiresScaleAnchor: false,
      rotationDirection: 'clockwise',
      instructionText: 'Stop pushing counter-clockwise. Press gently and rotate the retaining clip 30 degrees CLOCKWISE to release.',
      pipMotionPrompt: 'Close-up fingers pressing and turning dishwasher polymer retaining clip 30 degrees clockwise to unlock.',
      successRate: 0.964,
      correctionCount: 21,
      embedding: buildFeatureVector([0.06, 0.08, 0.09, 0.07, 0.12, 0.11, 0.84, 0.52]),
    },
  ];
}

/**
 * In-memory relational ontology engine mirroring schema.sql Recursive CTEs & pgvector search.
 * Used as a deterministic fallback when Cloud SQL / local Postgres is not mounted, and in unit tests.
 */
export class InMemoryOntologyGraph {
  private nodes: Map<number, OntologyComponentNode>;
  private feedbackLog: OntologyFeedbackRecord[] = [];
  private deflectedCount = 42;
  private totalComputeUsd = 58.4;

  constructor(seedNodes: OntologyComponentNode[] = createSeedOntologyNodes()) {
    this.nodes = new Map(seedNodes.map((n) => [n.id, { ...n, embedding: [...n.embedding] }]));
  }

  public getAllNodes(): OntologyComponentNode[] {
    return Array.from(this.nodes.values()).sort((a, b) => a.id - b.id);
  }

  public getNode(id: number): OntologyComponentNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Mirrors `v_component_hierarchy` & `get_component_hierarchy(root_id)` Recursive CTE with cycle protection.
   */
  public getHierarchyTree(rootId?: number): OntologyHierarchyRow[] {
    const result: OntologyHierarchyRow[] = [];
    const all = this.getAllNodes();
    const roots =
      rootId !== undefined
        ? all.filter((n) => n.id === rootId)
        : all.filter((n) => n.parentId === null);

    const traverse = (
      node: OntologyComponentNode,
      depth: number,
      visited: Set<number>,
      path: string
    ) => {
      if (visited.has(node.id) || depth > 10) return;
      const nextVisited = new Set(visited);
      nextVisited.add(node.id);
      const breadcrumb = path ? `${path} > ${node.name}` : node.name;
      result.push({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        componentClass: node.componentClass,
        depth,
        breadcrumbPath: breadcrumb,
        failurePrecursorCue: node.failurePrecursorCue,
        toolRequired: node.toolRequired,
        toolSizeSpec: node.toolSizeSpec,
        requiresScaleAnchor: node.requiresScaleAnchor,
        successRate: node.successRate,
        correctionCount: node.correctionCount,
      });

      const children = all.filter((c) => c.parentId === node.id);
      for (const child of children) {
        traverse(child, depth + 1, nextVisited, breadcrumb);
      }
    };

    for (const r of roots) {
      traverse(r, 0, new Set(), '');
    }
    return result;
  }

  /**
   * Mirrors `get_component_ancestry(target_id)` bottom-up Recursive CTE.
   */
  public getAncestryBreadcrumb(targetId: number): string {
    const chain: string[] = [];
    const visited = new Set<number>();
    let current = this.nodes.get(targetId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current.name);
      current = current.parentId !== null ? this.nodes.get(current.parentId) : undefined;
    }
    return chain.join(' > ');
  }

  /**
   * Mirrors `rag_search_ontology_subgraph(...)`: pgvector cosine similarity + Recursive CTE ancestry + Break 2 guard.
   */
  public searchRagSubgraph(
    queryEmbedding: number[],
    scaleAnchor: ScaleAnchorType,
    hasWebXRDepth: boolean,
    limit = 4
  ): OntologyRagMatch[] {
    const scored = this.getAllNodes()
      .map((node) => ({
        component: node,
        similarity: Number(cosineSimilarity(queryEmbedding, node.embedding).toFixed(4)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map(({ component, similarity }) => ({
      component,
      ancestryPath: this.getAncestryBreadcrumb(component.id),
      similarity,
      scaleGatedAdvice: enforceScaleAnchorInvariant(
        {
          toolRequired: component.toolRequired,
          toolSizeSpec: component.toolSizeSpec,
          requiresScaleAnchor: component.requiresScaleAnchor,
          instructionText: component.instructionText,
        },
        scaleAnchor,
        hasWebXRDepth
      ),
    }));
  }

  /**
   * Mirrors `apply_ontology_correction(...)` (Test Case 2: M4 vs M6 screw).
   * Updates the corrected component's visual_signature_embedding so subsequent RAG scans
   * immediately rank the corrected component #1 without retraining.
   */
  public applyCorrection(params: {
    predictedComponentId: number;
    correctedComponentId: number;
    capturedEmbedding: number[];
    tag: string;
    regionCode?: string;
  }): { updated: OntologyComponentNode; event: OntologyFeedbackRecord } {
    const target = this.nodes.get(params.correctedComponentId);
    if (!target) {
      throw new Error(`Component ID ${params.correctedComponentId} not found in ontology graph.`);
    }
    const predicted = this.nodes.get(params.predictedComponentId);

    // Update target visual signature to align directly with the newly verified physical observation
    target.embedding = buildFeatureVector(params.capturedEmbedding);
    target.correctionCount += 1;
    target.successRate = Math.min(0.995, Number((target.successRate + 0.004).toFixed(4)));

    // Gently push the misidentified sibling away along the contested feature dimensions
    if (predicted && predicted.id !== target.id) {
      const nudged = predicted.embedding.map((v, idx) => {
        const q = target.embedding[idx] ?? 0;
        return Math.max(0.01, v - 0.15 * q);
      });
      predicted.embedding = buildFeatureVector(nudged);
    }

    const event: OntologyFeedbackRecord = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      predictedComponentId: params.predictedComponentId,
      predictedName: predicted?.name ?? `Component #${params.predictedComponentId}`,
      correctedComponentId: target.id,
      correctedName: target.name,
      tag: params.tag,
      regionCode: params.regionCode ?? 'US-CHI',
    };

    this.feedbackLog.unshift(event);
    if (this.feedbackLog.length > 30) {
      this.feedbackLog.pop();
    }

    return { updated: target, event };
  }

  public recordDeflection(computeCostUsd = 1.45) {
    this.deflectedCount += 1;
    this.totalComputeUsd = Number((this.totalComputeUsd + computeCostUsd).toFixed(2));
    return this.getFlywheelMetrics();
  }

  public getFeedbackLog(): OntologyFeedbackRecord[] {
    return [...this.feedbackLog];
  }

  public getFlywheelMetrics() {
    const bountyUsd = 30;
    const revenueUsd = this.deflectedCount * bountyUsd;
    const avgComputePerSession =
      this.deflectedCount > 0 ? this.totalComputeUsd / this.deflectedCount : 1.5;
    const marginMultiple = avgComputePerSession > 0 ? bountyUsd / avgComputePerSession : 20;
    return {
      deflectedReturns: this.deflectedCount,
      bountyPerDeflectionUsd: bountyUsd,
      grossBountyRevenueUsd: revenueUsd,
      totalComputeUsd: this.totalComputeUsd,
      marginMultiple: Number(marginMultiple.toFixed(1)),
      totalCorrections: this.getAllNodes().reduce((sum, n) => sum + n.correctionCount, 0),
    };
  }
}
