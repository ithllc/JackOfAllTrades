/**
 * MakerLens — Pure Two-Way Multilingual Audio Helpers (AGPL-3.0-only)
 * Handles MIME normalization, Base64 data-URL parsing, payload validation,
 * BCP-47 language normalization, MediaRecorder codec selection, and
 * multilingual 3-sentence spoken response capping.
 */

export const EXPERT_MECHANIC_SYSTEM_PROMPT =
  "You are an expert mechanic. Detect the exact spoken language of the user's audio query and respond in that exact same language using the visual context provided. Keep your spoken response under 3 sentences. Be direct and actionable.";

export const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB ceiling

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
]);

const SHORT_LANGUAGE_DEFAULTS: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ar: 'ar-EG',
  hi: 'hi-IN',
  ru: 'ru-RU',
  nl: 'nl-NL',
  pl: 'pl-PL',
  tr: 'tr-TR',
  vi: 'vi-VN',
  th: 'th-TH',
  id: 'id-ID',
  uk: 'uk-UA',
  sv: 'sv-SE',
};

/**
 * Normalizes a detected language tag (e.g. "es", "es_MX", "ja-jp", "fr-CA")
 * into a clean BCP-47 locale tag suitable for Gemini 3.8 TTS `speech_config.language`.
 */
export function normalizeBcp47Language(
  rawCode: string | undefined,
  fallback = 'en-US'
): string {
  const safeFallback = /^[a-z]{2,3}-[A-Z]{2}$/.test(fallback) ? fallback : 'en-US';
  if (!rawCode || typeof rawCode !== 'string') return safeFallback;

  const cleaned = rawCode.trim().replace(/_/g, '-');
  if (!cleaned) return safeFallback;

  // Handle bare 2-letter ISO-639-1 code (e.g. "es" -> "es-ES", "ja" -> "ja-JP")
  const lower = cleaned.toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) {
    return SHORT_LANGUAGE_DEFAULTS[lower] ?? `${lower}-${lower.toUpperCase()}`;
  }

  // Handle full BCP-47 tags like "es-mx", "zh-Hans-CN", "pt-BR"
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 2 && /^[a-z]{2,3}$/i.test(parts[0]) && /^[a-z0-9]{2,4}$/i.test(parts[1])) {
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }
  if (
    parts.length === 3 &&
    /^[a-z]{2,3}$/i.test(parts[0]) &&
    /^[a-z]{4}$/i.test(parts[1]) &&
    /^[a-z]{2}$/i.test(parts[2])
  ) {
    // Collapse script subtags like zh-Hans-CN -> zh-CN for broad TTS locale compatibility
    return `${parts[0].toLowerCase()}-${parts[2].toUpperCase()}`;
  }

  return safeFallback;
}

/**
 * Normalizes browser MediaRecorder MIME strings (e.g. "audio/webm;codecs=opus")
 * into clean IANA audio MIME types expected by the Gemini Multimodal API.
 */
export function normalizeAudioMimeType(rawMime: string | undefined): string {
  if (!rawMime || typeof rawMime !== 'string') return 'audio/webm';
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-wav') return 'audio/wav';
  if (SUPPORTED_AUDIO_MIME_TYPES.has(base)) return base;
  return 'audio/webm';
}

/**
 * Extracts raw Base64 bytes and normalized MIME type from either a data URL
 * ("data:audio/webm;codecs=opus;base64,GkXf...") or a raw Base64 string.
 */
export function stripAudioDataUrl(
  input: string,
  fallbackMime = 'audio/webm'
): { mimeType: string; base64: string } {
  const trimmed = String(input || '').trim();
  const match = trimmed.match(/^data:([^,]+);base64,(.+)$/i);
  if (match) {
    return {
      mimeType: normalizeAudioMimeType(match[1]),
      base64: match[2].replace(/\s+/g, ''),
    };
  }
  return {
    mimeType: normalizeAudioMimeType(fallbackMime),
    base64: trimmed.replace(/\s+/g, ''),
  };
}

/**
 * Validates that a Base64-encoded audio payload is non-empty and within
 * the server-side byte limit before sending it to the Gemini API.
 */
export function validateAudioPayload(
  base64: string,
  maxBytes: number = MAX_AUDIO_UPLOAD_BYTES
): { ok: boolean; byteLength: number; error?: string } {
  const clean = String(base64 || '').replace(/\s+/g, '');
  if (clean.length < 16) {
    return {
      ok: false,
      byteLength: 0,
      error: 'Recording was too short. Hold the button while speaking your question.',
    };
  }

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((clean.length * 3) / 4) - padding);

  if (byteLength > maxBytes) {
    return {
      ok: false,
      byteLength,
      error: 'Audio clip is too long. Keep your explanation brief and try again.',
    };
  }

  return { ok: true, byteLength };
}

/**
 * Strips markdown formatting and caps the mechanic's spoken script to at most
 * 3 direct sentences across Latin, CJK (。！？), Arabic (؟), and Devanagari (।) scripts.
 */
export function enforceThreeSentenceCap(rawText: string): string {
  const cleaned = String(rawText || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Hold the camera steady with a bit more light and describe what feels stuck.';
  }

  const sentences = cleaned.match(/[^.!?。！？؟।]+[.!?。！？؟।]+|[^.!?。！？؟।]+$/g) ?? [cleaned];
  const capped = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');

  return capped || cleaned;
}

/**
 * Picks the highest-compatibility MediaRecorder MIME type supported by the browser.
 */
export function pickBestRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean
): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Ignore browser quirks
    }
  }
  return '';
}

/**
 * Formats elapsed push-to-talk duration in milliseconds as m:ss (e.g. "0:04").
 */
export function formatRecordingDuration(durationMs: number): string {
  const safeSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
