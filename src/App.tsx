/**
 * MakerLens — Intuitive Visual Repair Assistant ("Magic Window" PWA)
 *
 * State Management Overview (Demo Mode <-> Live Camera Mode):
 *  - On initial load, `readOnboardingCompletion()` inspects localStorage for
 *    `makerlens_onboarding_completed`.
 *  - First-time visitors initialize in `mode: 'demo'`, rendering <DemoMode />
 *    with a safe looping battery-compartment tutorial and tappable highlight.
 *  - When the user finishes or skips onboarding, `handleCompleteDemo()` writes
 *    the completion flag to localStorage and dispatches `COMPLETE_DEMO`, cleanly
 *    unmounting <DemoMode /> and mounting <LiveCameraView /> so the MediaDevices
 *    camera stream is requested only once the user enters Live Camera mode.
 *  - Deep links or automated runs passing `?autostart=1` jump directly to `'live'`.
 */

import React, { useCallback, useEffect, useReducer } from 'react';
import {
  createInitialSessionState,
  makerLensReducer,
  ONBOARDING_STORAGE_KEY,
  type HighlightHotspot,
} from './lib/makerLensState';
import { DemoMode } from './components/DemoMode';
import { LiveCameraView } from './components/LiveCameraView';

function readOnboardingCompletion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  // Single reducer owns the mode switch ('demo' | 'live'), flashlight toggle,
  // and human-readable scan lifecycle ('idle' | 'scanning' | 'result' | 'error').
  const [state, dispatch] = useReducer(
    makerLensReducer,
    undefined,
    () =>
      createInitialSessionState(
        readOnboardingCompletion(),
        typeof window !== 'undefined' ? window.location.search : ''
      )
  );

  // Persist onboarding completion so returning visits open directly into the Magic Window
  useEffect(() => {
    if (!state.hasCompletedOnboarding) return;
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage quota / private-browsing restrictions
    }
  }, [state.hasCompletedOnboarding]);

  const handleCompleteDemo = useCallback(() => {
    dispatch({ type: 'COMPLETE_DEMO' });
  }, []);

  const handleToggleFlashlight = useCallback(() => {
    dispatch({ type: 'TOGGLE_FLASHLIGHT' });
  }, []);

  const handleStartScan = useCallback(() => {
    dispatch({ type: 'START_SCAN' });
  }, []);

  const handleScanSucceeded = useCallback((hotspot: HighlightHotspot) => {
    dispatch({ type: 'SCAN_SUCCEEDED', hotspot });
  }, []);

  const handleScanFailed = useCallback((message: string) => {
    dispatch({ type: 'SCAN_FAILED', message });
  }, []);

  const handleResetScan = useCallback(() => {
    dispatch({ type: 'RESET_SCAN' });
  }, []);

  return (
    <main className="h-dvh w-screen overflow-hidden bg-black">
      {state.mode === 'demo' ? (
        <DemoMode onComplete={handleCompleteDemo} />
      ) : (
        <LiveCameraView
          flashlightOn={state.flashlightOn}
          scanPhase={state.scanPhase}
          activeHotspot={state.activeHotspot}
          errorMessage={state.errorMessage}
          onToggleFlashlight={handleToggleFlashlight}
          onStartScan={handleStartScan}
          onScanSucceeded={handleScanSucceeded}
          onScanFailed={handleScanFailed}
          onResetScan={handleResetScan}
        />
      )}
    </main>
  );
}
