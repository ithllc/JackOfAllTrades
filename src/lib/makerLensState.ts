/**
 * MakerLens — Pure State Management & Onboarding Transition Logic
 * Decoupled from React/DOM so every state transition can be unit-tested cleanly.
 */

import type { ScaleCalibrationResult } from './scaleCalibration';
import {
  normalizeBoxToPct,
  normalizeMotionCue,
  type BoundingBoxPct,
  type RepairMotionCue,
} from './ontologyMapper';

export type AppMode = 'demo' | 'live';
export type ScanPhase = 'idle' | 'scanning' | 'result' | 'error';

export const ONBOARDING_STORAGE_KEY = 'makerlens_onboarding_completed';

/**
 * Placeholder video URL used by <DemoMode /> for the battery-compartment walkthrough.
 * When a real MP4 loop is hosted at this path (or CDN), <video> plays it natively;
 * if unavailable, DemoMode falls back seamlessly to an animated canvas loop.
 */
export const DEMO_VIDEO_PLACEHOLDER_URL =
  'https://example.com/makerlens/demo-battery-compartment.mp4';

export interface RepairStep {
  number: number;
  title: string;
  detail: string;
  /** Directional AR overlay cue rendered on the live camera feed for this step */
  motionCue?: RepairMotionCue;
  /** Optional step-specific target bounding box in percentage viewport coordinates */
  targetBox?: BoundingBoxPct | null;
  /** Dedicated 6-second close-up hand-motion prompt for on-demand per-step PiP loop */
  pipMotionPrompt?: string;
  /** Optional tool specifically required for this step */
  toolNeeded?: string;
}

export interface HighlightHotspot {
  id: string;
  label: string;
  /** Percentage coordinates relative to the full-screen viewport */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** Primary directional motion cue for the overall repair */
  motionCue?: RepairMotionCue;
  /** Optional viewport box highlighting the detected scale anchor object */
  anchorBox?: BoundingBoxPct | null;
  summary: string;
  toolNeeded: string;
  steps: RepairStep[];
  motionPrompt?: string;
  /** Whether this fix came from Scan Problem or Hold to Explain voice assist */
  sourceMode?: 'scan' | 'voice';
  /** Detected spoken language name (e.g., Spanish, English) when from voice assist */
  spokenLanguage?: string | null;
  /** What the user said during Hold to Explain */
  userTranscript?: string | null;
  /** Authoritative Scale Calibration result (calibrated | needs_anchor | opted_out) */
  scaleCalibration?: ScaleCalibrationResult | null;
  /** Cloud SQL diagnostic_sessions.id created for live self-learning feedback */
  sessionId?: string | null;
  /** Cloud SQL components.id matched or newly learned for this scan */
  componentId?: number | null;
}

export const DEMO_BATTERY_HOTSPOT: HighlightHotspot = {
  id: 'battery-release-latch',
  label: 'Battery Latch',
  xPct: 37,
  yPct: 44,
  wPct: 26,
  hPct: 20,
  motionCue: 'press',
  summary: 'Press the ridged latch inward and slide the cover down to open the battery compartment.',
  toolNeeded: 'No tools needed (thumb press)',
  steps: [
    {
      number: 1,
      title: 'Press the ridged release tab',
      detail: 'Place your thumb on the textured groove inside the highlighted box and press gently inward.',
      motionCue: 'press',
    },
    {
      number: 2,
      title: 'Slide the cover downward',
      detail: 'While holding light inward pressure, glide the plastic door toward the bottom edge until it clicks free.',
      motionCue: 'slide',
    },
    {
      number: 3,
      title: 'Lift and check polarity',
      detail: 'Lift the cover away and match the + and − symbols printed inside the tray when replacing batteries.',
      motionCue: 'lift',
    },
  ],
};

/**
 * Human-readable scanning messages — strictly non-technical, zero API jargon.
 */
export const SCANNING_MESSAGES: readonly string[] = [
  'Analyzing the threads...',
  'Checking how the parts fit together...',
  'Finding the safest next step...',
] as const;

export function getScanningMessage(stepIndex: number): string {
  const safeIndex = Math.abs(Math.floor(stepIndex)) % SCANNING_MESSAGES.length;
  return SCANNING_MESSAGES[safeIndex];
}

/**
 * Resolves whether MakerLens starts in Interactive Onboarding Demo ('demo')
 * or directly in the Live Camera Magic Window ('live').
 *
 * Rules:
 *  - `?autostart=1` skips onboarding directly to 'live' (useful for deep links & testing).
 *  - `?demo=1` forces onboarding demo regardless of prior completion.
 *  - Returning users (`hasCompletedOnboarding === true`) land straight in 'live'.
 *  - First-time visitors start safely in 'demo'.
 */
export function resolveInitialAppMode(params: {
  search?: string;
  hasCompletedOnboarding: boolean;
}): AppMode {
  const query = new URLSearchParams(params.search || '');
  if (query.get('demo') === '1') return 'demo';
  if (query.get('autostart') === '1') return 'live';
  return params.hasCompletedOnboarding ? 'live' : 'demo';
}

export interface MakerLensSessionState {
  mode: AppMode;
  hasCompletedOnboarding: boolean;
  flashlightOn: boolean;
  scanPhase: ScanPhase;
  activeHotspot: HighlightHotspot | null;
  errorMessage: string | null;
}

export type MakerLensAction =
  | { type: 'COMPLETE_DEMO' }
  | { type: 'ENTER_DEMO' }
  | { type: 'TOGGLE_FLASHLIGHT' }
  | { type: 'SET_FLASHLIGHT'; enabled: boolean }
  | { type: 'START_SCAN' }
  | { type: 'SCAN_SUCCEEDED'; hotspot: HighlightHotspot }
  | { type: 'SCAN_FAILED'; message: string }
  | { type: 'RESET_SCAN' };

export function createInitialSessionState(
  hasCompletedOnboarding: boolean,
  search?: string
): MakerLensSessionState {
  return {
    mode: resolveInitialAppMode({ search, hasCompletedOnboarding }),
    hasCompletedOnboarding,
    flashlightOn: false,
    scanPhase: 'idle',
    activeHotspot: null,
    errorMessage: null,
  };
}

/**
 * Pure reducer governing transitions between Demo Mode and Live Camera Mode,
 * plus the Magic Window scan lifecycle.
 */
export function makerLensReducer(
  state: MakerLensSessionState,
  action: MakerLensAction
): MakerLensSessionState {
  switch (action.type) {
    case 'COMPLETE_DEMO':
      return {
        ...state,
        mode: 'live',
        hasCompletedOnboarding: true,
        scanPhase: 'idle',
        activeHotspot: null,
        errorMessage: null,
      };

    case 'ENTER_DEMO':
      return {
        ...state,
        mode: 'demo',
        flashlightOn: false,
        scanPhase: 'idle',
        activeHotspot: null,
        errorMessage: null,
      };

    case 'TOGGLE_FLASHLIGHT':
      return {
        ...state,
        flashlightOn: !state.flashlightOn,
      };

    case 'SET_FLASHLIGHT':
      return {
        ...state,
        flashlightOn: action.enabled,
      };

    case 'START_SCAN':
      return {
        ...state,
        scanPhase: 'scanning',
        activeHotspot: null,
        errorMessage: null,
      };

    case 'SCAN_SUCCEEDED':
      return {
        ...state,
        scanPhase: 'result',
        activeHotspot: action.hotspot,
        errorMessage: null,
      };

    case 'SCAN_FAILED':
      return {
        ...state,
        scanPhase: 'error',
        activeHotspot: null,
        errorMessage: action.message,
      };

    case 'RESET_SCAN':
      return {
        ...state,
        scanPhase: 'idle',
        activeHotspot: null,
        errorMessage: null,
      };

    default:
      return state;
  }
}

/**
 * Converts a backend `/api/analyze-buffer` or `/api/voice-assist` payload into a
 * non-technical, human-friendly HighlightHotspot for the Magic Window overlay
 * and step-by-step InstructionSheet.
 */
export function buildHotspotFromDiagnosis(payload: {
  diagnosis?: {
    componentName?: string;
    diagnosisSummary?: string;
    nextStepInstruction?: string;
    toolRequired?: string;
    toolSizeSpec?: string | null;
    scaleGuardBlocked?: boolean;
    pipMotionPrompt?: string;
    motionCue?: string;
    targetBox?: unknown;
    anchorBox?: unknown;
    steps?: Array<{
      number?: number;
      title?: string;
      detail?: string;
      motionCue?: string;
      targetBox?: unknown;
      pipMotionPrompt?: string;
      toolNeeded?: string;
    }>;
  };
  scaleCalibration?: ScaleCalibrationResult | null;
  voiceInstruction?: string;
  spokenText?: string;
  sourceMode?: 'scan' | 'voice';
  spokenLanguage?: string | null;
  userTranscript?: string | null;
  sessionId?: string | null;
  componentId?: number | null;
}): HighlightHotspot {
  const diag = payload.diagnosis;
  const label = diag?.componentName?.trim() || 'Highlighted Area';
  const summary =
    diag?.diagnosisSummary?.trim() ||
    payload.spokenText?.trim() ||
    payload.voiceInstruction?.trim() ||
    'Hold steady while following the step below to adjust this part safely.';
  const primaryStep =
    diag?.nextStepInstruction?.trim() ||
    'Check the alignment gently before applying any force.';

  const isCalibrated = payload.scaleCalibration?.status === 'calibrated';
  const isSizeBlocked =
    Boolean(diag?.scaleGuardBlocked) || (payload.scaleCalibration != null && !isCalibrated);

  const toolLine =
    diag?.toolRequired && diag?.toolSizeSpec && !isSizeBlocked
      ? `${diag.toolRequired} (${diag.toolSizeSpec})`
      : diag?.toolRequired
        ? isSizeBlocked && !/pending|calibrat|scale/i.test(diag.toolRequired)
          ? `${diag.toolRequired} (exact size pending scale)`
          : diag.toolRequired
        : 'No special tools needed';

  const defaultBox: BoundingBoxPct = { xPct: 26, yPct: 16, wPct: 48, hPct: 30 };
  const resolvedTargetBox = normalizeBoxToPct(diag?.targetBox, defaultBox) ?? defaultBox;
  const resolvedAnchorBox =
    payload.scaleCalibration?.anchorBox ?? normalizeBoxToPct(diag?.anchorBox) ?? null;
  const primaryMotionCue = normalizeMotionCue(diag?.motionCue || primaryStep);

  // Ensure every PiP prompt demonstrates the actual physical repair motion (never just placing a coin)
  const fallbackRepairMotionPrompt =
    diag?.pipMotionPrompt && !/place a (coin|quarter|credit card|thumb)/i.test(diag.pipMotionPrompt)
      ? diag.pipMotionPrompt
      : `Close-up steady hands demonstrating how to adjust or repair the ${label}: ${primaryStep}`;

  let steps: RepairStep[];
  if (Array.isArray(diag?.steps) && diag.steps.length > 0) {
    steps = diag.steps
      .filter((s) => s && (s.title?.trim() || s.detail?.trim()))
      .slice(0, 6)
      .map((s, idx) => {
        const title = s.title?.trim() || `Step ${idx + 1}`;
        const detail = s.detail?.trim() || primaryStep;
        const stepBox = normalizeBoxToPct(s.targetBox) ?? resolvedTargetBox;
        const stepMotion = normalizeMotionCue(s.motionCue || `${title} ${detail}`);
        const stepPip =
          s.pipMotionPrompt?.trim() &&
          !/place a (coin|quarter|credit card|thumb)/i.test(s.pipMotionPrompt)
            ? s.pipMotionPrompt.trim()
            : `Close-up steady hands performing Step ${idx + 1} on ${label}: ${title}. ${detail}`;
        return {
          number: idx + 1,
          title,
          detail,
          motionCue: stepMotion,
          targetBox: stepBox,
          pipMotionPrompt: stepPip,
          toolNeeded: s.toolNeeded?.trim() || undefined,
        };
      });
  } else {
    steps = [
      {
        number: 1,
        title: `Inspect & align ${label}`,
        detail: summary,
        motionCue: 'align',
        targetBox: resolvedTargetBox,
        pipMotionPrompt: `Close-up hands inspecting and aligning ${label} cleanly before applying force.`,
      },
      {
        number: 2,
        title: 'Perform the repair step',
        detail: primaryStep,
        motionCue: primaryMotionCue,
        targetBox: resolvedTargetBox,
        pipMotionPrompt: fallbackRepairMotionPrompt,
      },
    ];
  }

  return {
    id: `scan-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    xPct: resolvedTargetBox.xPct,
    yPct: resolvedTargetBox.yPct,
    wPct: resolvedTargetBox.wPct,
    hPct: resolvedTargetBox.hPct,
    motionCue: steps[0]?.motionCue ?? primaryMotionCue,
    anchorBox: resolvedAnchorBox,
    summary,
    toolNeeded: toolLine,
    steps,
    motionPrompt: steps[0]?.pipMotionPrompt ?? fallbackRepairMotionPrompt,
    sourceMode: payload.sourceMode ?? 'scan',
    spokenLanguage: payload.spokenLanguage ?? null,
    userTranscript: payload.userTranscript ?? null,
    scaleCalibration: payload.scaleCalibration ?? null,
    sessionId: payload.sessionId ?? null,
    componentId: payload.componentId ?? null,
  };
}
