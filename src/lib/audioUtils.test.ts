import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPERT_MECHANIC_SYSTEM_PROMPT,
  enforceThreeSentenceCap,
  formatRecordingDuration,
  normalizeAudioMimeType,
  normalizeBcp47Language,
  pickBestRecorderMimeType,
  stripAudioDataUrl,
  validateAudioPayload,
} from './audioUtils.ts';

test('normalizeAudioMimeType strips codec suffixes and falls back safely', () => {
  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('AUDIO/MP4; codecs=mp4a.40.2'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType('audio/x-wav'), 'audio/wav');
  assert.equal(normalizeAudioMimeType('application/octet-stream'), 'audio/webm');
  assert.equal(normalizeAudioMimeType(undefined), 'audio/webm');
});

test('normalizeBcp47Language resolves ISO-639-1, underscore, and script subtags cleanly', () => {
  assert.equal(normalizeBcp47Language('es'), 'es-ES');
  assert.equal(normalizeBcp47Language('es_mx'), 'es-MX');
  assert.equal(normalizeBcp47Language('fr-CA'), 'fr-CA');
  assert.equal(normalizeBcp47Language('ja'), 'ja-JP');
  assert.equal(normalizeBcp47Language('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeBcp47Language('pt'), 'pt-BR');
  assert.equal(normalizeBcp47Language('', 'fr-FR'), 'fr-FR');
  assert.equal(normalizeBcp47Language('invalid!!!', 'en-US'), 'en-US');
});

test('stripAudioDataUrl extracts clean base64 and normalized MIME from data URLs', () => {
  const parsed = stripAudioDataUrl('data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQ==');
  assert.equal(parsed.mimeType, 'audio/webm');
  assert.equal(parsed.base64, 'GkXfo59ChoEBQveBAULygQ==');

  const raw = stripAudioDataUrl('UklGRiQAAABXQVZF', 'audio/wav');
  assert.equal(raw.mimeType, 'audio/wav');
  assert.equal(raw.base64, 'UklGRiQAAABXQVZF');
});

test('validateAudioPayload rejects empty clips and oversized uploads', () => {
  const shortRes = validateAudioPayload('abc');
  assert.equal(shortRes.ok, false);

  const okRes = validateAudioPayload('UklGRiQAAABXQVZFZm10IBAAAAABAAEA');
  assert.equal(okRes.ok, true);
  assert.ok(okRes.byteLength > 0);

  const bigBase64 = 'A'.repeat(200);
  const overRes = validateAudioPayload(bigBase64, 64);
  assert.equal(overRes.ok, false);
});

test('enforceThreeSentenceCap strips markdown and caps spoken output to 3 sentences across scripts', () => {
  const raw =
    '**Loosen** the center Phillips screw counterclockwise. Slide the hinge plate 2mm left. Tighten snugly without stripping the threads. Also check the bottom cabinet door later.';
  assert.equal(
    enforceThreeSentenceCap(raw),
    'Loosen the center Phillips screw counterclockwise. Slide the hinge plate 2mm left. Tighten snugly without stripping the threads.'
  );

  const jaRaw =
    'まず中央のネジを反時計回りに緩めてください。次にプレートを左へ2ミリ動かします。最後に軽く締め直してください。他のネジも確認しましょう。';
  assert.equal(
    enforceThreeSentenceCap(jaRaw),
    'まず中央のネジを反時計回りに緩めてください。 次にプレートを左へ2ミリ動かします。 最後に軽く締め直してください。'
  );

  assert.ok(EXPERT_MECHANIC_SYSTEM_PROMPT.includes('under 3 sentences'));
  assert.ok(EXPERT_MECHANIC_SYSTEM_PROMPT.includes('exact same language'));
});

test('pickBestRecorderMimeType prefers webm opus, then mp4, and handles unsupported browsers', () => {
  assert.equal(
    pickBestRecorderMimeType((m) => m === 'audio/webm;codecs=opus' || m === 'audio/mp4'),
    'audio/webm;codecs=opus'
  );
  assert.equal(
    pickBestRecorderMimeType((m) => m === 'audio/mp4'),
    'audio/mp4'
  );
  assert.equal(
    pickBestRecorderMimeType(() => false),
    ''
  );
});

test('formatRecordingDuration renders clean m:ss timers', () => {
  assert.equal(formatRecordingDuration(0), '0:00');
  assert.equal(formatRecordingDuration(4200), '0:04');
  assert.equal(formatRecordingDuration(65000), '1:05');
});
