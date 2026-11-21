import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_NARRATION_CUES,
  getDemoCueForStepNumber,
  getNextDemoCue,
  isValidDemoCueId,
} from './demoNarration';

test('intro cue identifies the interactive demo and prompts tapping the battery latch', () => {
  const intro = DEMO_NARRATION_CUES.intro;
  assert.match(intro.spokenText, /Jack of All Trades/i);
  assert.match(intro.spokenText, /demo/i);
  assert.match(intro.spokenText, /battery latch/i);
  assert.equal(intro.activeStepNumber, null);
  assert.equal(intro.visualPhase, 'loop');
});

test('step sequence flows smoothly from step-1 -> step-2 -> step-3 and aligns visual phases', () => {
  assert.equal(getNextDemoCue('intro'), null);
  assert.equal(getNextDemoCue('step-1'), 'step-2');
  assert.equal(getNextDemoCue('step-2'), 'step-3');
  assert.equal(getNextDemoCue('step-3'), null);

  assert.equal(DEMO_NARRATION_CUES['step-1'].visualPhase, 'press');
  assert.equal(DEMO_NARRATION_CUES['step-2'].visualPhase, 'slide');
  assert.equal(DEMO_NARRATION_CUES['step-3'].visualPhase, 'open');
  assert.equal(DEMO_NARRATION_CUES['step-1'].activeStepNumber, 1);
  assert.equal(DEMO_NARRATION_CUES['step-2'].activeStepNumber, 2);
  assert.equal(DEMO_NARRATION_CUES['step-3'].activeStepNumber, 3);
});

test('step number lookup and cue ID validation handle valid and invalid inputs safely', () => {
  assert.equal(getDemoCueForStepNumber(1), 'step-1');
  assert.equal(getDemoCueForStepNumber(2), 'step-2');
  assert.equal(getDemoCueForStepNumber(3), 'step-3');
  assert.equal(getDemoCueForStepNumber(99), null);

  assert.equal(isValidDemoCueId('intro'), true);
  assert.equal(isValidDemoCueId('step-2'), true);
  assert.equal(isValidDemoCueId('unknown'), false);
  assert.equal(isValidDemoCueId(undefined), false);
});
