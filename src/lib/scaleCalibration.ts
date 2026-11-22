/**
 * Jack of All Trades — Scale Calibration & Anchor Enforcement Logic
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Pure, deterministic TypeScript helpers shared between the Express backend
 * (`/api/analyze-buffer`, `/api/voice-assist`) and the React PWA so scale
 * anchoring is enforced consistently across both Scan Problem and Hold to Explain.
 */

import type { ScaleAnchorType } from './routingLogic';

export type ScaleCalibrationStatus = 'calibrated' | 'needs_anchor' | 'opted_out';

export type DetectedScaleObject =
  | 'us_quarter'
  | 'coin'
  | 'credit_card'
  | 'human_thumb'
  | 'ruler'
  | 'webxr_depth'
  | 'none';

export interface ScaleCalibrationResult {
  status: ScaleCalibrationStatus;
  detectedObject: DetectedScaleObject;
  detectedObjectLabel: string;
  /** Physical reference dimension in millimeters (e.g., 24.26mm for US quarter, 85.6mm for credit card) */
  referenceDimensionMm: number | null;
  /** Estimated size of the target part in millimeters derived from anchor ratio comparison */
  estimatedPartSizeMm: number | null;
  /** Plain-English note explaining how the part was measured against the anchor */
  scaleMeasurementNote: string | null;
  /** Optional normalized viewport percentage box around the detected scale anchor */
  anchorBox?: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
  confidence: number;
  confirmed: boolean;
  optedOut: boolean;
  userDeclinedInSpeech: boolean;
  bannerTitle: string;
  bannerText: string;
  /** Short plain-English explanation of why using a known-size reference object matters */
  whyScaleMatters: string;
  /** Concise voice line confirming calibration, requesting an object, or explaining opt-out */
  spokenScaleNotice: string;
}

export const REFERENCE_OBJECT_DIMENSIONS_MM: Record<DetectedScaleObject, number | null> = {
  us_quarter: 24.26,
  coin: 24.0,
  credit_card: 85.6,
  human_thumb: 20.0,
  ruler: null,
  webxr_depth: null,
  none: null,
};

export const SCALE_CALIBRATION_PROMPT_GUIDE =
  'KNOWN REFERENCE DIMENSIONS FOR PIXEL-RATIO MEASUREMENT:\n' +
  '- US Quarter ("us_quarter"): 24.26 mm diameter\n' +
  '- Standard Coin ("coin"): ~24.0 mm diameter\n' +
  '- Credit / Debit / ID Card ("credit_card"): 85.60 mm wide x 53.98 mm tall\n' +
  '- Adult Human Thumb ("human_thumb"): ~20.0 mm nail/pad width\n' +
  '- Ruler / Tape Measure ("ruler"): read markings directly\n' +
  'When any reference object is clearly visible on the same depth plane next to the target part, measure the target part width/head diameter as a ratio of the reference object, compute estimatedPartSizeMm, write a 1-sentence scaleMeasurementNote proving the measurement (e.g., "Compared to the 24.26 mm quarter, the bolt head is ~40% as wide (~10 mm), matching a 10mm socket"), and return anchorBox as [ymin, xmin, ymax, xmax] in 0..1000 coordinates.';

export const WHY_SCALE_MATTERS_SUMMARY =
  'Camera lenses distort close-up distance and magnification, so a tiny screw can look identical to a much larger bolt. Placing a known-size object like a quarter, credit card, or your thumb beside the part lets us measure real dimensions and avoid recommending the wrong tool size.';

export const WHY_SCALE_MATTERS_SPOKEN =
  "No problem, you can continue without scaling. Just keep in mind that camera lenses distort close-up size, so without a quarter, credit card, or your thumb beside the part, tool sizes are approximate—test the fit gently before turning.";

export const SCALE_REQUEST_BANNER =
  'Hold a quarter, credit card, or your thumb right beside the part and try again so we can confirm exact size—or choose Continue Without Scaling.';

export const SCALE_REQUEST_SPOKEN =
  'Please place a quarter, credit card, or your thumb next to the part so I can calibrate scale and confirm the exact tool size—or let me know if you prefer to continue without scaling.';

/**
 * Normalizes model-reported scale object strings into a strict union.
 */
export function normalizeDetectedScaleObject(raw?: string | null): DetectedScaleObject {
  if (!raw || typeof raw !== 'string') return 'none';
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (
    cleaned === 'none' ||
    cleaned === 'null' ||
    cleaned === 'unknown' ||
    cleaned === 'no_object' ||
    cleaned === 'not_found'
  ) {
    return 'none';
  }
  if (cleaned.includes('webxr') || cleaned.includes('depth')) return 'webxr_depth';
  if (cleaned.includes('quarter')) return 'us_quarter';
  if (cleaned.includes('coin') || cleaned.includes('penny') || cleaned.includes('dime') || cleaned.includes('nickel') || cleaned.includes('euro')) {
    return 'coin';
  }
  if (
    cleaned.includes('credit_card') ||
    cleaned.includes('bank_card') ||
    cleaned.includes('debit_card') ||
    cleaned.includes('id_card') ||
    cleaned === 'card'
  ) {
    return 'credit_card';
  }
  if (
    cleaned.includes('thumb') ||
    cleaned.includes('finger') ||
    cleaned.includes('hand')
  ) {
    return 'human_thumb';
  }
  if (
    cleaned.includes('ruler') ||
    cleaned.includes('tape_measure') ||
    cleaned.includes('caliper') ||
    cleaned.includes('measuring')
  ) {
    return 'ruler';
  }
  return 'none';
}

export function formatScaleObjectLabel(obj: DetectedScaleObject): string {
  switch (obj) {
    case 'us_quarter':
      return 'quarter coin (24.26 mm)';
    case 'coin':
      return 'coin (~24 mm)';
    case 'credit_card':
      return 'credit card (85.6 mm)';
    case 'human_thumb':
      return 'your thumb (~20 mm)';
    case 'ruler':
      return 'ruler';
    case 'webxr_depth':
      return 'depth sensor';
    default:
      return 'reference object';
  }
}

export function mapDetectedObjectToScaleAnchor(obj: DetectedScaleObject): ScaleAnchorType {
  switch (obj) {
    case 'us_quarter':
    case 'coin':
      return 'us_quarter';
    case 'credit_card':
      return 'credit_card';
    case 'human_thumb':
    case 'ruler':
      return 'human_thumb';
    case 'webxr_depth':
      return 'webxr_depth';
    default:
      return 'none';
  }
}

/**
 * Deterministic multilingual heuristic checking whether the user explicitly said
 * they do not want to use a scale reference object. Supplements `gemini-4-neon`'s
 * structured `userDeclinedScale` classification.
 */
const DECLINE_SCALE_PATTERNS: readonly RegExp[] = [
  /\b(don'?t|do not|dont)\s+(want|need|have)\s+(to\s+)?(scale|calibrate|an?\s+object|a\s+quarter|a\s+card|a\s+coin)\b/i,
  /\b(skip|ignore|bypass|disable|no)\s+(the\s+)?(scal(e|ing)|calibrat(e|ion)|reference\s+object|scale\s+object)\b/i,
  /\b(continue|proceed|go\s+ahead|just\s+help|keep\s+going)\s+without\s+(scal(e|ing)|an?\s+object|a\s+quarter|a\s+card|calibrat(e|ion))\b/i,
  /\bwithout\s+(scal(e|ing)|using\s+an?\s+object|a\s+reference\s+object)\b/i,
  /\bno\s+quiero\s+(usar\s+)?(escala|escalar|un\s+objeto|moneda|tarjeta)\b/i,
  /\bsin\s+(escala|escalar|objeto\s+de\s+referencia)\b/i,
  /\b(sans|pas\s+d['’])\s*(échelle|objet\s+de\s+référence|calibrage)\b/i,
  /\b(ohne|nicht)\s+(skalier(en|ung)|maßstab|referenzobjekt)\b/i,
  /\b(sem|não\s+quero)\s+(escala|escalar|objeto\s+de\s+referência)\b/i,
];

export function detectScaleDeclineIntent(transcript?: string | null): boolean {
  if (!transcript || typeof transcript !== 'string') return false;
  const text = transcript.trim();
  if (text.length < 4) return false;
  return DECLINE_SCALE_PATTERNS.some((pattern) => pattern.test(text));
}

export interface ResolveScaleCalibrationInput {
  detectedObject?: string | null;
  scaleCalibrated?: boolean;
  scaleConfidence?: number;
  estimatedPartSizeMm?: number | null;
  scaleMeasurementNote?: string | null;
  anchorBox?: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
  explicitOptOut?: boolean;
  userDeclinedInSpeech?: boolean;
  userTranscript?: string | null;
  hasWebXRDepth?: boolean;
  clientScaleAnchor?: ScaleAnchorType;
  localizedWhyScaleMatters?: string | null;
}

/**
 * Resolves the authoritative Scale Calibration state for both Scan Problem
 * and Hold to Explain flows:
 *   1. `calibrated`   — confirmed physical anchor or WebXR depth detected in frame
 *   2. `opted_out`    — user declined scaling (via button or voice); continues as-is
 *                       with both written & spoken explanation of why scaling matters
 *   3. `needs_anchor` — no anchor visible; exact tool sizes redacted and user is
 *                       guided (text + voice) to place a quarter, card, or thumb
 */
export function resolveScaleCalibration(
  input: ResolveScaleCalibrationInput
): ScaleCalibrationResult {
  const normalizedDetected = normalizeDetectedScaleObject(input.detectedObject);
  const clientAnchor =
    input.clientScaleAnchor && input.clientScaleAnchor !== 'none'
      ? normalizeDetectedScaleObject(input.clientScaleAnchor)
      : 'none';

  const resolvedObject: DetectedScaleObject = input.hasWebXRDepth
    ? 'webxr_depth'
    : normalizedDetected !== 'none'
      ? normalizedDetected
      : clientAnchor;

  const confidence =
    typeof input.scaleConfidence === 'number' && Number.isFinite(input.scaleConfidence)
      ? Math.max(0, Math.min(1, Number(input.scaleConfidence.toFixed(2))))
      : resolvedObject !== 'none'
        ? 0.9
        : 0;

  const isVisuallyCalibrated =
    Boolean(input.hasWebXRDepth) ||
    clientAnchor !== 'none' ||
    (Boolean(input.scaleCalibrated) && normalizedDetected !== 'none' && confidence >= 0.55);

  const whyScaleMatters =
    input.localizedWhyScaleMatters?.trim() || WHY_SCALE_MATTERS_SUMMARY;

  const estimatedPartSizeMm =
    typeof input.estimatedPartSizeMm === 'number' &&
    Number.isFinite(input.estimatedPartSizeMm) &&
    input.estimatedPartSizeMm > 0
      ? Math.round(input.estimatedPartSizeMm * 10) / 10
      : null;

  const scaleMeasurementNote =
    typeof input.scaleMeasurementNote === 'string' && input.scaleMeasurementNote.trim()
      ? input.scaleMeasurementNote.trim()
      : null;

  if (isVisuallyCalibrated && resolvedObject !== 'none') {
    const label = formatScaleObjectLabel(resolvedObject);
    const refMm = REFERENCE_OBJECT_DIMENSIONS_MM[resolvedObject];
    const sizePhrase = estimatedPartSizeMm ? ` (~${estimatedPartSizeMm} mm part measured)` : '';
    const bannerText =
      scaleMeasurementNote ||
      `We calibrated scale using the ${label} next to the part${sizePhrase}. Exact tool sizes are unlocked for this repair.`;

    return {
      status: 'calibrated',
      detectedObject: resolvedObject,
      detectedObjectLabel: label,
      referenceDimensionMm: refMm,
      estimatedPartSizeMm,
      scaleMeasurementNote,
      anchorBox: input.anchorBox ?? null,
      confidence,
      confirmed: true,
      optedOut: false,
      userDeclinedInSpeech: false,
      bannerTitle: `Scale Confirmed (${label})`,
      bannerText,
      whyScaleMatters,
      spokenScaleNotice: `Scale confirmed using the ${label}${sizePhrase}.`,
    };
  }

  const declinedInSpeech =
    Boolean(input.userDeclinedInSpeech) || detectScaleDeclineIntent(input.userTranscript);
  const optedOut = Boolean(input.explicitOptOut) || declinedInSpeech;

  if (optedOut) {
    return {
      status: 'opted_out',
      detectedObject: 'none',
      detectedObjectLabel: 'none',
      referenceDimensionMm: null,
      estimatedPartSizeMm: null,
      scaleMeasurementNote: null,
      anchorBox: null,
      confidence: 0,
      confirmed: false,
      optedOut: true,
      userDeclinedInSpeech: declinedInSpeech,
      bannerTitle: 'Continuing Without Scale Object',
      bannerText: whyScaleMatters,
      whyScaleMatters,
      spokenScaleNotice: WHY_SCALE_MATTERS_SPOKEN,
    };
  }

  return {
    status: 'needs_anchor',
    detectedObject: 'none',
    detectedObjectLabel: 'none',
    referenceDimensionMm: null,
    estimatedPartSizeMm: null,
    scaleMeasurementNote: null,
    anchorBox: null,
    confidence: 0,
    confirmed: false,
    optedOut: false,
    userDeclinedInSpeech: false,
    bannerTitle: 'Place a Scale Object Next to the Part',
    bannerText: SCALE_REQUEST_BANNER,
    whyScaleMatters,
    spokenScaleNotice: SCALE_REQUEST_SPOKEN,
  };
}
