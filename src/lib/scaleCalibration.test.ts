import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectScaleDeclineIntent,
  mapDetectedObjectToScaleAnchor,
  normalizeDetectedScaleObject,
  resolveScaleCalibration,
  WHY_SCALE_MATTERS_SPOKEN,
  WHY_SCALE_MATTERS_SUMMARY,
} from './scaleCalibration.ts';

test('normalizeDetectedScaleObject maps coins, cards, thumbs, rulers, and none safely', () => {
  assert.equal(normalizeDetectedScaleObject('US Quarter'), 'us_quarter');
  assert.equal(normalizeDetectedScaleObject('credit-card'), 'credit_card');
  assert.equal(normalizeDetectedScaleObject('card'), 'credit_card');
  assert.equal(normalizeDetectedScaleObject('human thumb'), 'human_thumb');
  assert.equal(normalizeDetectedScaleObject('ruler'), 'ruler');
  assert.equal(normalizeDetectedScaleObject('none'), 'none');
  assert.equal(normalizeDetectedScaleObject(''), 'none');
});

test('resolveScaleCalibration confirms scale when a known object is clearly detected', () => {
  const result = resolveScaleCalibration({
    detectedObject: 'us_quarter',
    scaleCalibrated: true,
    scaleConfidence: 0.92,
  });

  assert.equal(result.status, 'calibrated');
  assert.equal(result.confirmed, true);
  assert.equal(result.optedOut, false);
  assert.equal(result.detectedObject, 'us_quarter');
  assert.equal(mapDetectedObjectToScaleAnchor(result.detectedObject), 'us_quarter');
  assert.match(result.bannerTitle, /Scale Confirmed/i);
  assert.match(result.spokenScaleNotice, /quarter coin/i);
});

test('resolveScaleCalibration requests a quarter, credit card, or thumb when no scale object is present', () => {
  const result = resolveScaleCalibration({
    detectedObject: 'none',
    scaleCalibrated: false,
    scaleConfidence: 0.1,
  });

  assert.equal(result.status, 'needs_anchor');
  assert.equal(result.confirmed, false);
  assert.equal(result.optedOut, false);
  assert.match(result.bannerText, /quarter/i);
  assert.match(result.bannerText, /credit card/i);
  assert.match(result.bannerText, /thumb/i);
  assert.match(result.spokenScaleNotice, /quarter, credit card, or your thumb/i);
});

test('resolveScaleCalibration honors explicit opt-out and explains why scaling matters in text and speech', () => {
  const result = resolveScaleCalibration({
    detectedObject: 'none',
    scaleCalibrated: false,
    explicitOptOut: true,
  });

  assert.equal(result.status, 'opted_out');
  assert.equal(result.optedOut, true);
  assert.equal(result.confirmed, false);
  assert.equal(result.whyScaleMatters, WHY_SCALE_MATTERS_SUMMARY);
  assert.equal(result.spokenScaleNotice, WHY_SCALE_MATTERS_SPOKEN);
});

test('detectScaleDeclineIntent and resolveScaleCalibration recognize spoken opt-out across languages', () => {
  assert.equal(detectScaleDeclineIntent("I don't want to scale right now"), true);
  assert.equal(detectScaleDeclineIntent('Skip scaling and just help me fix this'), true);
  assert.equal(detectScaleDeclineIntent('No quiero escalar, sigue sin escala'), true);
  assert.equal(detectScaleDeclineIntent('This screw is stuck on my cabinet hinge'), false);

  const result = resolveScaleCalibration({
    detectedObject: 'none',
    scaleCalibrated: false,
    userTranscript: "I don't want to scale, just tell me how to loosen it",
  });

  assert.equal(result.status, 'opted_out');
  assert.equal(result.userDeclinedInSpeech, true);
  assert.equal(result.optedOut, true);
});
