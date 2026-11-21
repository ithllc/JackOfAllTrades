/**
 * JackOfAllTrades — Interactive Field Bench Scenarios (Deterministic Synthetic Camera Feed)
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Allows full end-to-end verification of MediaDevices fallback, 15s frame ring buffering,
 * Wasm stillness detection, Break 2 scale anchoring, and Test Case 2 M4/M6 bounding-box
 * corrections even on devices or headless browsers without a physical webcam.
 */

export interface BenchScenario {
  id: 'm4_screw' | 'under_sink' | 'cabinet_hinge' | 'dishwasher_clip';
  label: string;
  shortTitle: string;
  brand: string;
  manualSku: string;
  environmentSummary: string;
  predictedComponentId: number;
  predictedLabel: string;
  correctedComponentId: number;
  correctedLabel: string;
  correctionTag: string;
  defaultGlare: boolean;
  boundingBox: { xPct: number; yPct: number; wPct: number; hPct: number };
  queryVector: number[];
  motionCue: {
    actionLabel: string;
    direction: 'clockwise' | 'counter_clockwise' | 'angled';
    angleDeg: number;
    stepInstruction: string;
    pipPrompt: string;
  };
}

export const BENCH_SCENARIOS: BenchScenario[] = [
  {
    id: 'm4_screw',
    label: 'M4 vs M6 Fastener Bench (Test Case 2)',
    shortTitle: 'Fastener Scale Bench',
    brand: 'Precision Fastener Standards',
    manualSku: 'ISO-METRIC-FAST',
    environmentSummary: 'Close-up macro bench view of an M4 hinge plate screw frequently misidentified as M6 without a scale anchor.',
    predictedComponentId: 4,
    predictedLabel: 'M6 Hex Socket Cap Screw',
    correctedComponentId: 3,
    correctedLabel: 'M4 Machine Screw (Hinge Plate)',
    correctionTag: 'M4_not_M6',
    defaultGlare: false,
    boundingBox: { xPct: 21, yPct: 31, wPct: 28, hPct: 34 },
    queryVector: [0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09],
    motionCue: {
      actionLabel: 'Seat square & tighten clockwise (1.8 Nm)',
      direction: 'clockwise',
      angleDeg: 360,
      stepInstruction: 'Align the M4 screw squarely with the mounting plate bore and drive smoothly clockwise.',
      pipPrompt: 'Macro close-up of fingers seating an M4 machine screw into a brushed steel plate and tightening clockwise.',
    },
  },
  {
    id: 'under_sink',
    label: 'Under-Sink Chrome P-Trap (Hardest Input)',
    shortTitle: 'Under-Sink P-Trap',
    brand: 'AquaFlow Residential Plumbing',
    manualSku: 'AFP-PTRAP-150',
    environmentSummary: 'Water-splashed lens + harsh flashlight glare off chrome slip-joint compression nut under kitchen sink.',
    predictedComponentId: 8,
    predictedLabel: 'Chrome Slip-Joint Compression Nut',
    correctedComponentId: 8,
    correctedLabel: 'Chrome Slip-Joint Compression Nut',
    correctionTag: 'slip_joint_washer_bevel',
    defaultGlare: true,
    boundingBox: { xPct: 23, yPct: 27, wPct: 24, hPct: 36 },
    queryVector: [0.09, 0.10, 0.12, 0.15, 0.85, 0.50, 0.08, 0.06],
    motionCue: {
      actionLabel: 'Wipe threads, hand-thread clockwise + 1/4 turn',
      direction: 'clockwise',
      angleDeg: 90,
      stepInstruction: 'Seat the beveled washer flat-side up, hand-tighten the chrome nut clockwise, then add one quarter turn.',
      pipPrompt: 'Hands wiping water from chrome under-sink P-trap threads and rotating slip-joint nut clockwise one quarter turn.',
    },
  },
  {
    id: 'cabinet_hinge',
    label: 'Concealed Cabinet Hinge (Data Flywheel)',
    shortTitle: 'Concealed Hinge 110°',
    brand: 'NordicFlatPack Furnishings',
    manualSku: 'NFP-HINGE-110',
    environmentSummary: 'Brushed steel 110-degree hinge arm tilted off the mounting plate track — proactive 15° angle overlay.',
    predictedComponentId: 2,
    predictedLabel: '110-Deg Concealed Hinge Arm',
    correctedComponentId: 2,
    correctedLabel: '110-Deg Concealed Hinge Arm',
    correctionTag: 'hinge_angle_15deg',
    defaultGlare: false,
    boundingBox: { xPct: 16, yPct: 30, wPct: 36, hPct: 34 },
    queryVector: [0.84, 0.52, 0.14, 0.05, 0.09, 0.11, 0.20, 0.18],
    motionCue: {
      actionLabel: 'Tilt bracket 15° inward & snap heel flush',
      direction: 'angled',
      angleDeg: 15,
      stepInstruction: 'Angle the hinge arm 15 degrees inward to hook the front locating pins, then press the rear heel until it clicks.',
      pipPrompt: 'Close-up hand tilting brushed steel concealed furniture hinge at 15 degrees onto mounting plate until snap click.',
    },
  },
  {
    id: 'dishwasher_clip',
    label: 'Dishwasher Impeller Clip (Raw Media Physics)',
    shortTitle: 'Impeller Retaining Clip',
    brand: 'Samsung Home Appliances',
    manualSku: 'SAM-DW-IMP400',
    environmentSummary: 'Lower sump basin with rhythmic impeller cavitation sound and polymer retaining clip showing clockwise wear ramp.',
    predictedComponentId: 10,
    predictedLabel: 'Clockwise Snap-Lock Retaining Clip',
    correctedComponentId: 10,
    correctedLabel: 'Clockwise Snap-Lock Retaining Clip',
    correctionTag: 'clip_clockwise_30deg',
    defaultGlare: false,
    boundingBox: { xPct: 21, yPct: 31, wPct: 28, hPct: 34 },
    queryVector: [0.06, 0.08, 0.09, 0.07, 0.12, 0.11, 0.84, 0.52],
    motionCue: {
      actionLabel: 'Twist 30° CLOCKWISE (do not force CCW)',
      direction: 'clockwise',
      angleDeg: 30,
      stepInstruction: 'Follow the molded wear-ramp pattern and rotate the retaining clip 30 degrees clockwise to lift the sump cover.',
      pipPrompt: 'Close-up fingers pressing and turning dishwasher polymer sump retaining clip 30 degrees clockwise to release cover.',
    },
  },
];
