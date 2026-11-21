/**
 * Jack of All Trades — Guided Demo Narration Scripts & Sequencer (AGPL-3.0-only)
 * Pure data + state transitions synchronizing spoken demo voiceover with
 * on-screen wording and animated visual guide phases.
 */

export type DemoNarrationCueId = 'intro' | 'step-1' | 'step-2' | 'step-3';

export type DemoVisualPhase = 'loop' | 'press' | 'slide' | 'open';

export interface DemoNarrationCue {
  id: DemoNarrationCueId;
  /** Exact text spoken aloud by Gemini TTS / SpeechSynthesis fallback */
  spokenText: string;
  /** Concise caption synced with the active audio cue */
  caption: string;
  /** Which numbered instruction step (1..3) is highlighted while speaking */
  activeStepNumber: number | null;
  /** Which visual animation phase the battery-compartment canvas emphasizes */
  visualPhase: DemoVisualPhase;
}

export const DEMO_NARRATION_CUES: Record<DemoNarrationCueId, DemoNarrationCue> = {
  intro: {
    id: 'intro',
    spokenText:
      'Welcome to Jack of All Trades. This is a quick interactive demo showing how visual repair guidance works. Tap the highlighted battery latch on screen to see step-by-step instructions.',
    caption: 'Interactive demo · Tap the highlighted battery latch to begin.',
    activeStepNumber: null,
    visualPhase: 'loop',
  },
  'step-1': {
    id: 'step-1',
    spokenText:
      'Step one: Press down gently with your thumb on the ridged release latch near the top of the cover.',
    caption: 'Step 1 of 3 · Press down on the ridged latch',
    activeStepNumber: 1,
    visualPhase: 'press',
  },
  'step-2': {
    id: 'step-2',
    spokenText:
      'Step two: Keep light pressure and slide the cover straight down toward the molded arrow until it clicks loose.',
    caption: 'Step 2 of 3 · Slide the cover toward the arrow',
    activeStepNumber: 2,
    visualPhase: 'slide',
  },
  'step-3': {
    id: 'step-3',
    spokenText:
      'Step three: Lift the cover up to reveal the batteries. You are all set—tap Got It, Open Camera whenever you are ready for a live repair.',
    caption: 'Step 3 of 3 · Lift cover to reveal batteries · Ready for camera',
    activeStepNumber: 3,
    visualPhase: 'open',
  },
};

export const DEMO_STEP_SEQUENCE: readonly DemoNarrationCueId[] = [
  'step-1',
  'step-2',
  'step-3',
];

export function isValidDemoCueId(value: string | undefined): value is DemoNarrationCueId {
  return value === 'intro' || value === 'step-1' || value === 'step-2' || value === 'step-3';
}

/**
 * Returns the next narration cue in the step-by-step walkthrough so audio flows
 * automatically from Step 1 -> Step 2 -> Step 3 after the user taps the latch.
 */
export function getNextDemoCue(currentId: DemoNarrationCueId): DemoNarrationCueId | null {
  if (currentId === 'step-1') return 'step-2';
  if (currentId === 'step-2') return 'step-3';
  return null;
}

/**
 * Maps a 1-based instruction step tap in the bottom sheet back to its audio cue.
 */
export function getDemoCueForStepNumber(stepNumber: number): DemoNarrationCueId | null {
  if (stepNumber === 1) return 'step-1';
  if (stepNumber === 2) return 'step-2';
  if (stepNumber === 3) return 'step-3';
  return null;
}
