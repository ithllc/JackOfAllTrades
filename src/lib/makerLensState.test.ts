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

test('buildHotspotFromDiagnosis preserves multi-step AR boxes, filters coin-placement PiP prompts, and passes Cloud SQL IDs', () => {
  const hotspot = buildHotspotFromDiagnosis({
    diagnosis: {
      componentName: 'Sink P-Trap Slip Nut',
      diagnosisSummary: 'The plastic slip nut under the sink is weeping slightly.',
      nextStepInstruction: 'Turn the slip nut clockwise by hand one quarter turn.',
      toolRequired: 'Channel-lock pliers',
      toolSizeSpec: '1.5 inch',
      scaleGuardBlocked: false,
      targetBox: [200, 300, 500, 700],
      anchorBox: [600, 100, 750, 250],
      steps: [
        {
          number: 1,
          title: 'Place towel and dry the joint',
          detail: 'Wipe the slip nut dry so you can spot any remaining drip.',
          motionCue: 'inspect',
          pipMotionPrompt: 'Place a quarter next to the pipe to calibrate scale.',
        },
        {
          number: 2,
          title: 'Tighten slip nut clockwise',
          detail: 'Grip the ridged nut and turn clockwise one quarter turn until snug.',
          motionCue: 'rotate_cw',
          targetBox: [220, 320, 480, 680],
          pipMotionPrompt: 'Close-up hands turning a white PVC P-trap slip nut clockwise one quarter turn.',
        },
      ],
    },
    sessionId: 'sess-123',
    componentId: 42,
  });

  assert.equal(hotspot.steps.length, 2);
  assert.equal(hotspot.sessionId, 'sess-123');
  assert.equal(hotspot.componentId, 42);
  assert.equal(hotspot.xPct, 30);
  assert.equal(hotspot.yPct, 20);
  assert.ok(hotspot.anchorBox);
  assert.equal(hotspot.steps[1].motionCue, 'rotate_cw');
  assert.doesNotMatch(hotspot.steps[0].pipMotionPrompt || '', /place a quarter/i);
  assert.match(hotspot.steps[1].pipMotionPrompt || '', /turning a white PVC P-trap/i);
});

