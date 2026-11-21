import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHotspotFromDiagnosis,
  createInitialSessionState,
  DEMO_BATTERY_HOTSPOT,
  getScanningMessage,
  makerLensReducer,
  resolveInitialAppMode,
  SCANNING_MESSAGES,
} from './makerLensState';

test('first-time visitors start in interactive Demo Mode, returning visitors start in Live Camera', () => {
  assert.equal(resolveInitialAppMode({ hasCompletedOnboarding: false }), 'demo');
  assert.equal(resolveInitialAppMode({ hasCompletedOnboarding: true }), 'live');
  assert.equal(resolveInitialAppMode({ hasCompletedOnboarding: false, search: '?autostart=1' }), 'live');
  assert.equal(resolveInitialAppMode({ hasCompletedOnboarding: true, search: '?demo=1' }), 'demo');
});

test('mode transition from Demo Mode to Live Camera persists completion and clears scan state', () => {
  const initial = createInitialSessionState(false);
  assert.equal(initial.mode, 'demo');
  assert.equal(initial.hasCompletedOnboarding, false);

  const live = makerLensReducer(initial, { type: 'COMPLETE_DEMO' });
  assert.equal(live.mode, 'live');
  assert.equal(live.hasCompletedOnboarding, true);
  assert.equal(live.scanPhase, 'idle');
  assert.equal(live.activeHotspot, null);
});

test('flashlight toggles cleanly and automatically turns off when re-entering Demo Mode', () => {
  let state = createInitialSessionState(true);
  state = makerLensReducer(state, { type: 'TOGGLE_FLASHLIGHT' });
  assert.equal(state.flashlightOn, true);

  state = makerLensReducer(state, { type: 'ENTER_DEMO' });
  assert.equal(state.mode, 'demo');
  assert.equal(state.flashlightOn, false);
});

test('scan lifecycle transitions cleanly through scanning -> result -> idle and error recovery', () => {
  let state = createInitialSessionState(true);

  state = makerLensReducer(state, { type: 'START_SCAN' });
  assert.equal(state.scanPhase, 'scanning');
  assert.equal(state.errorMessage, null);

  state = makerLensReducer(state, { type: 'SCAN_SUCCEEDED', hotspot: DEMO_BATTERY_HOTSPOT });
  assert.equal(state.scanPhase, 'result');
  assert.equal(state.activeHotspot?.label, 'Battery Latch');

  state = makerLensReducer(state, { type: 'RESET_SCAN' });
  assert.equal(state.scanPhase, 'idle');
  assert.equal(state.activeHotspot, null);

  state = makerLensReducer(state, { type: 'SCAN_FAILED', message: 'Hold steady and try again.' });
  assert.equal(state.scanPhase, 'error');
  assert.equal(state.errorMessage, 'Hold steady and try again.');
});

test('scanning messages lead with "Analyzing the threads..." and avoid technical jargon', () => {
  assert.equal(getScanningMessage(0), 'Analyzing the threads...');
  assert.equal(getScanningMessage(SCANNING_MESSAGES.length), 'Analyzing the threads...');
  for (const msg of SCANNING_MESSAGES) {
    assert.doesNotMatch(msg, /API|JSON|HTTP|token|model|latency|server/i);
  }
});

test('buildHotspotFromDiagnosis maps backend diagnosis into plain-English steps', () => {
  const hotspot = buildHotspotFromDiagnosis({
    diagnosis: {
      componentName: 'Cabinet Hinge Screw',
      diagnosisSummary: 'The mounting screw sits slightly loose on the top plate.',
      nextStepInstruction: 'Turn the screw gently clockwise until snug.',
      toolRequired: 'Phillips Screwdriver',
      toolSizeSpec: '#2 Phillips',
      scaleGuardBlocked: false,
    },
  });
  assert.equal(hotspot.label, 'Cabinet Hinge Screw');
  assert.equal(hotspot.toolNeeded, 'Phillips Screwdriver (#2 Phillips)');
  assert.equal(hotspot.steps.length, 2);
});
