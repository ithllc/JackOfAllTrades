/**
 * MakerLens — Pure State Management & Onboarding Transition Logic
 * Decoupled from React/DOM so every state transition can be unit-tested cleanly.
 */

import type { ScaleCalibrationResult } from './scaleCalibration';

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
}

export interface HighlightHotspot {
  id: string;
  label: string;
  /** Percentage coordinates relative to the full-screen viewport */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
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
}

export const DEMO_BATTERY_HOTSPOT: HighlightHotspot = {
  id: 'battery-release-latch',
  label: 'Battery Latch',
  xPct: 37,
  yPct: 44,
  wPct: 26,
  hPct: 20,
  summary: 'Press the ridged latch inward and slide the cover down to open the battery compartment.',
  toolNeeded: 'No tools needed (thumb press)',
  steps: [
    {
      number: 1,
      title: 'Press the ridged release tab',
      detail: 'Place your thumb on the textured groove inside the highlighted box and press gently inward.',
    },
    {
      number: 2,
      title: 'Slide the cover downward',
      detail: 'While holding light inward pressure, glide the plastic door toward the bottom edge until it clicks free.',
    },
    {
      number: 3,
      title: 'Lift and check polarity',
      detail: 'Lift the cover away and match the + and − symbols printed inside the tray when replacing batteries.',
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
    steps?: Array<{ number?: number; title?: string; detail?: string }>;
  };
  scaleCalibration?: ScaleCalibrationResult | null;
  voiceInstruction?: string;
  spokenText?: string;
  sourceMode?: 'scan' | 'voice';
  spokenLanguage?: string | null;
  userTranscript?: string | null;
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
  const isSizeBlocked = Boolean(diag?.scaleGuardBlocked) || (payload.scaleCalibration != null && !isCalibrated);

  const toolLine =
    diag?.toolRequired && diag?.toolSizeSpec && !isSizeBlocked
      ? `${diag.toolRequired} (${diag.toolSizeSpec})`
      : diag?.toolRequired
        ? isSizeBlocked && !/pending|calibrat|scale/i.test(diag.toolRequired)
          ? `${diag.toolRequired} (exact size pending scale)`
          : diag.toolRequired
        : 'No special tools needed';

  let steps: RepairStep[];
  if (Array.isArray(diag?.steps) && diag.steps.length > 0) {
    steps = diag.steps
      .filter((s) => s && (s.title?.trim() || s.detail?.trim()))
      .slice(0, 4)
      .map((s, idx) => ({
        number: idx + 1,
        title: s.title?.trim() || `Step ${idx + 1}`,
        detail: s.detail?.trim() || primaryStep,
      }));
  } else {
    steps = [
      {
        number: 1,
        title: 'Check the highlighted part',
        detail: summary,
      },
      {
        number: 2,
        title: 'Follow the next step',
        detail: primaryStep,
      },
    ];
  }

  if (
    steps.length < 3 &&
    diag?.scaleGuardBlocked &&
    payload.scaleCalibration?.status !== 'opted_out' &&
    payload.scaleCalibration?.status !== 'calibrated'
  ) {
    steps.push({
      number: steps.length + 1,
      title: 'Hold a coin beside the part for exact sizing',
      detail:
        'Place a quarter, credit card, or your thumb next to the part and scan again to confirm the exact tool size.',
    });
  }

  return {
    id: `scan-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    xPct: 32,
    yPct: 33,
    wPct: 36,
    hPct: 26,
    summary,
    toolNeeded: toolLine,
    steps,
    motionPrompt: diag?.pipMotionPrompt,
    sourceMode: payload.sourceMode ?? 'scan',
    spokenLanguage: payload.spokenLanguage ?? null,
    userTranscript: payload.userTranscript ?? null,
    scaleCalibration: payload.scaleCalibration ?? null,
  };
}
