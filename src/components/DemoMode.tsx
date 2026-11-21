import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Hand, Volume2, VolumeX } from 'lucide-react';
import {
  DEMO_BATTERY_HOTSPOT,
  DEMO_VIDEO_PLACEHOLDER_URL,
} from '../lib/makerLensState';
import {
  DEMO_NARRATION_CUES,
  DEMO_STEP_SEQUENCE,
  getDemoCueForStepNumber,
  getNextDemoCue,
  type DemoNarrationCueId,
  type DemoVisualPhase,
} from '../lib/demoNarration';
import { InstructionSheet } from './InstructionSheet';
import { BrandMark } from './BrandMark';

interface DemoModeProps {
  /** Called when the user finishes or skips onboarding to switch into Live Camera mode */
  onComplete: () => void;
}

/**
 * Interactive Onboarding Demo (<DemoMode />):
 * Runs on the user's first visit instead of the live camera.
 * Features automated guided voice narration (powered by cached Gemini TTS WAVs
 * with instant browser SpeechSynthesis fallback) that clearly introduces the
 * demo and flows seamlessly with the on-screen words and animated visual guide:
 *   - Intro: Announces the interactive demo and prompts tapping the Battery Latch.
 *   - Step 1 -> Step 2 -> Step 3: Automatically narrates each step in sequence
 *     while illuminating the active step card and syncing the battery-door animation
 *     (press latch -> slide cover -> lift cover open).
 */
export const DemoMode: React.FC<DemoModeProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<DemoNarrationCueId, string>>(new Map());
  const pendingFetchRef = useRef<Map<DemoNarrationCueId, Promise<string | null>>>(new Map());
  const playbackTokenRef = useRef(0);
  const visualPhaseRef = useRef<DemoVisualPhase>('loop');
  const isMutedRef = useRef(false);

  const [videoReady, setVideoReady] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [activeCueId, setActiveCueId] = useState<DemoNarrationCueId>('intro');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  const activeCue = DEMO_NARRATION_CUES[activeCueId];

  // Keep canvas animation synced to the active narrated phase (loop / press / slide / open)
  useEffect(() => {
    visualPhaseRef.current = instructionsOpen ? activeCue.visualPhase : 'loop';
  }, [instructionsOpen, activeCue.visualPhase]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const stopAllAudio = useCallback(() => {
    playbackTokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser speech synthesis quirks
      }
    }
    setIsSpeaking(false);
  }, []);

  /**
   * Fetches (and caches as a local Object URL) the neural WAV for a demo cue
   * from `/api/demo-narration?cue=<id>`. Deduplicates concurrent requests.
   */
  const fetchCueAudioUrl = useCallback(
    async (cueId: DemoNarrationCueId): Promise<string | null> => {
      const cached = audioCacheRef.current.get(cueId);
      if (cached) return cached;

      const inflight = pendingFetchRef.current.get(cueId);
      if (inflight) return inflight;

      const reqPromise = (async () => {
        try {
          const resp = await fetch(`/api/demo-narration?cue=${encodeURIComponent(cueId)}`, {
            headers: { Accept: 'audio/wav' },
          });
          if (!resp.ok) return null;
          const contentType = resp.headers.get('content-type') || '';
          if (!contentType.includes('audio/')) return null;
          const blob = await resp.blob();
          if (blob.size < 64) return null;
          const objectUrl = URL.createObjectURL(blob);
          audioCacheRef.current.set(cueId, objectUrl);
          return objectUrl;
        } catch {
          return null;
        } finally {
          pendingFetchRef.current.delete(cueId);
        }
      })();

      pendingFetchRef.current.set(cueId, reqPromise);
      return reqPromise;
    },
    []
  );

  /**
   * Plays a specific guided narration cue and automatically chains to the next
   * step (`step-1` -> `step-2` -> `step-3`) when it completes.
   */
  const playCue = useCallback(
    async (cueId: DemoNarrationCueId, autoAdvance: boolean) => {
      stopAllAudio();
      const token = playbackTokenRef.current;
      setActiveCueId(cueId);

      if (isMutedRef.current) {
        setNeedsAudioUnlock(false);
        return;
      }

      const cue = DEMO_NARRATION_CUES[cueId];
      const handleCueFinished = () => {
        if (playbackTokenRef.current !== token) return;
        setIsSpeaking(false);
        if (autoAdvance) {
          const nextCue = getNextDemoCue(cueId);
          if (nextCue) {
            window.setTimeout(() => {
              if (playbackTokenRef.current === token && !isMutedRef.current) {
                void playCue(nextCue, true);
              }
            }, 350);
          }
        }
      };

      // Primary path: Natural neural WAV from Gemini TTS (`/api/demo-narration`)
      const wavUrl = await fetchCueAudioUrl(cueId);
      if (playbackTokenRef.current !== token || isMutedRef.current) return;

      if (wavUrl && audioRef.current) {
        const audioEl = audioRef.current;
        audioEl.src = wavUrl;
        audioEl.onended = handleCueFinished;
        audioEl.onerror = () => {
          if (playbackTokenRef.current !== token) return;
          setIsSpeaking(false);
        };
        try {
          await audioEl.play();
          if (playbackTokenRef.current !== token) return;
          setIsSpeaking(true);
          setNeedsAudioUnlock(false);
          return;
        } catch (err) {
          const errName = (err as Error)?.name || '';
          if (errName === 'NotAllowedError') {
            // Browser blocked autoplay before the first tap; arm one-tap unlock
            setNeedsAudioUnlock(true);
            setIsSpeaking(false);
            return;
          }
        }
      }

      // Seamless fallback: Browser SpeechSynthesis (works even offline)
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const utterance = new SpeechSynthesisUtterance(cue.spokenText);
          utterance.lang = 'en-US';
          utterance.rate = 0.98;
          utterance.onstart = () => {
            if (playbackTokenRef.current !== token) return;
            setIsSpeaking(true);
            setNeedsAudioUnlock(false);
          };
          utterance.onend = handleCueFinished;
          utterance.onerror = () => {
            if (playbackTokenRef.current !== token) return;
            setIsSpeaking(false);
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          setIsSpeaking(false);
        }
      }
    },
    [fetchCueAudioUrl, stopAllAudio]
  );

  // Start automated intro voiceover on mount + quietly prefetch Steps 1–3
  useEffect(() => {
    void playCue('intro', false);
    const prefetchTimer = window.setTimeout(() => {
      for (const stepCue of DEMO_STEP_SEQUENCE) {
        void fetchCueAudioUrl(stepCue);
      }
    }, 600);

    return () => {
      window.clearTimeout(prefetchTimer);
      stopAllAudio();
      for (const url of audioCacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      audioCacheRef.current.clear();
    };
  }, [fetchCueAudioUrl, playCue, stopAllAudio]);

  // If browser autoplay policy blocked the initial unmuted welcome, unlock cleanly on first gesture
  useEffect(() => {
    if (!needsAudioUnlock || isMuted) return undefined;
    const handleFirstGesture = () => {
      setNeedsAudioUnlock(false);
      void playCue(activeCueId, activeCueId !== 'intro');
    };
    window.addEventListener('pointerdown', handleFirstGesture, { once: true });
    return () => window.removeEventListener('pointerdown', handleFirstGesture);
  }, [needsAudioUnlock, isMuted, activeCueId, playCue]);

  const handleOpenInstructions = useCallback(() => {
    setInstructionsOpen(true);
    setNeedsAudioUnlock(false);
    void playCue('step-1', true);
  }, [playCue]);

  const handleCloseInstructions = useCallback(() => {
    setInstructionsOpen(false);
    stopAllAudio();
    setActiveCueId('intro');
  }, [stopAllAudio]);

  const handleSelectStep = useCallback(
    (stepNumber: number) => {
      const cueId = getDemoCueForStepNumber(stepNumber);
      if (!cueId) return;
      if (isMutedRef.current) {
        isMutedRef.current = false;
        setIsMuted(false);
      }
      setNeedsAudioUnlock(false);
      void playCue(cueId, true);
    },
    [playCue]
  );

  const handleToggleAudio = useCallback(() => {
    if (needsAudioUnlock) {
      isMutedRef.current = false;
      setIsMuted(false);
      setNeedsAudioUnlock(false);
      void playCue(activeCueId, activeCueId !== 'intro');
      return;
    }
    if (!isMutedRef.current) {
      isMutedRef.current = true;
      setIsMuted(true);
      stopAllAudio();
    } else {
      isMutedRef.current = false;
      setIsMuted(false);
      void playCue(activeCueId, activeCueId !== 'intro');
    }
  }, [activeCueId, needsAudioUnlock, playCue, stopAllAudio]);

  const handleCompleteWithAudioStop = useCallback(() => {
    stopAllAudio();
    onComplete();
  }, [onComplete, stopAllAudio]);

  // Smooth looping animation of a handheld remote's battery compartment (~20 fps).
  // Stays visually synchronized with the active narrated step:
  //   - 'loop'  : continuous full cycle
  //   - 'press' : highlights the ridged release latch with a warm press pulse
  //   - 'slide' : glides the cover downward along the illuminated arrow
  //   - 'open'  : holds the cover open revealing the AA batteries
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let lastDraw = 0;
    const startTime = performance.now();

    const drawFrame = (now: number) => {
      if (now - lastDraw >= 50 || lastDraw === 0) {
        lastDraw = now;
        const elapsed = (now - startTime) / 1000;
        const phase = visualPhaseRef.current;
        const dpr = 1;
        const w = canvas.clientWidth || 1280;
        const h = canvas.clientHeight || 720;

        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Warm dark workbench surface (natural overhead lighting feel)
        const bg = ctx.createRadialGradient(
          w * 0.5,
          h * 0.45,
          40,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.78
        );
        bg.addColorStop(0, '#2a2622');
        bg.addColorStop(0.55, '#191715');
        bg.addColorStop(1, '#0d0c0b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Subtle wood-grain workbench lines
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 1;
        for (let y = 24; y < h; y += 36) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(w * 0.35, y + 6, w * 0.65, y - 6, w, y + 2);
          ctx.stroke();
        }

        // Handheld device backplate centered in frame (shifts slightly upward when sheet is open)
        const bodyW = Math.min(w * 0.62, 340);
        const bodyH = Math.min(h * 0.66, 440);
        const bodyX = (w - bodyW) / 2;
        const bodyY = (h - bodyH) / 2 - (phase === 'loop' ? 8 : 74);

        // Drop shadow beneath device
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.roundRect(bodyX + 10, bodyY + 18, bodyW, bodyH, 34);
        ctx.fill();

        // Matte charcoal device shell
        const shellGrad = ctx.createLinearGradient(bodyX, bodyY, bodyX + bodyW, bodyY + bodyH);
        shellGrad.addColorStop(0, '#30343b');
        shellGrad.addColorStop(0.5, '#24272d');
        shellGrad.addColorStop(1, '#1b1e23');
        ctx.fillStyle = shellGrad;
        ctx.beginPath();
        ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 34);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Compute slideProgress based on active narrated visual phase
        let slideProgress = 0;
        if (phase === 'press') {
          slideProgress = 0.04 * (0.5 + 0.5 * Math.sin(elapsed * 5));
        } else if (phase === 'slide') {
          const slideCycle = (elapsed % 2.2) / 2.2;
          slideProgress = Math.min(1, Math.sin(slideCycle * Math.PI * 0.85));
        } else if (phase === 'open') {
          slideProgress = 1;
        } else {
          const cycle = (elapsed % 4.5) / 4.5;
          slideProgress =
            cycle < 0.25
              ? 0
              : cycle < 0.55
                ? Math.sin(((cycle - 0.25) / 0.3) * (Math.PI / 2))
                : cycle < 0.8
                  ? 1
                  : Math.cos(((cycle - 0.8) / 0.2) * (Math.PI / 2));
        }

        const bayW = bodyW * 0.68;
        const bayH = bodyH * 0.54;
        const bayX = (w - bayW) / 2;
        const bayY = bodyY + bodyH * 0.28;
        const slideOffset = slideProgress * (phase === 'open' ? 54 : 30);

        // Dark interior battery tray
        ctx.fillStyle = '#111317';
        ctx.beginPath();
        ctx.roundRect(bayX, bayY, bayW, bayH, 16);
        ctx.fill();
        ctx.strokeStyle =
          phase === 'open' ? 'rgba(251, 191, 36, 0.55)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = phase === 'open' ? 2 : 1;
        ctx.stroke();

        // Two AA battery cells peeking at the top of the bay when cover slides down
        const cellW = bayW * 0.36;
        const cellH = bayH * 0.72;
        const cellY = bayY + 14;
        [bayX + bayW * 0.1, bayX + bayW * 0.54].forEach((cx, idx) => {
          const cellGrad = ctx.createLinearGradient(cx, cellY, cx + cellW, cellY);
          cellGrad.addColorStop(0, '#444b57');
          cellGrad.addColorStop(0.5, '#687182');
          cellGrad.addColorStop(1, '#393f49');
          ctx.fillStyle = cellGrad;
          ctx.beginPath();
          ctx.roundRect(cx, cellY, cellW, cellH, 8);
          ctx.fill();

          // Copper band on AA battery top
          ctx.fillStyle = '#c8813c';
          ctx.fillRect(cx, cellY + 6, cellW, 18);

          // Polarity mark
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.font = '600 13px "DM Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(idx === 0 ? '+' : '−', cx + cellW / 2, cellY + 42);
        });

        // Sliding battery cover door
        const doorY = bayY + slideOffset;
        const doorGrad = ctx.createLinearGradient(bayX, doorY, bayX, doorY + bayH);
        doorGrad.addColorStop(0, '#3a3f47');
        doorGrad.addColorStop(1, '#262a31');
        ctx.fillStyle = doorGrad;
        ctx.beginPath();
        ctx.roundRect(bayX, doorY, bayW, bayH, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 1.25;
        ctx.stroke();

        // Textured thumb-release latch ridges near the top-center of the battery door
        const latchW = Math.min(bayW * 0.44, 86);
        const latchX = w / 2 - latchW / 2;
        const latchY = doorY + 26;

        // Subtle recessed finger dish (illuminated amber during Step 1: press)
        ctx.fillStyle =
          phase === 'press' ? 'rgba(251, 191, 36, 0.24)' : 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.roundRect(latchX - 10, latchY - 10, latchW + 20, 44, 10);
        ctx.fill();
        if (phase === 'press') {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Three grip ridges
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle =
            phase === 'press' ? 'rgba(253, 224, 71, 0.9)' : 'rgba(255,255,255,0.34)';
          ctx.beginPath();
          ctx.roundRect(latchX, latchY + i * 8, latchW, 3.5, 2);
          ctx.fill();
        }

        // Molded downward slide arrow beneath the ridges
        ctx.fillStyle =
          phase === 'slide' ? 'rgba(251, 191, 36, 0.95)' : 'rgba(255,255,255,0.42)';
        ctx.beginPath();
        ctx.moveTo(w / 2 - 9, latchY + 34);
        ctx.lineTo(w / 2 + 9, latchY + 34);
        ctx.lineTo(w / 2, latchY + 45);
        ctx.closePath();
        ctx.fill();

        // Subtle animated directional guide chevron below the latch
        const pulse = 0.45 + 0.45 * Math.sin(elapsed * 4);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.4 + pulse * 0.45})`;
        ctx.lineWidth = phase === 'slide' ? 3.5 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const arrowY = latchY + 58 + slideProgress * 10;
        ctx.beginPath();
        ctx.moveTo(w / 2 - 8, arrowY);
        ctx.lineTo(w / 2, arrowY + 7);
        ctx.lineTo(w / 2 + 8, arrowY);
        ctx.stroke();

        ctx.restore();
      }

      rafId = window.requestAnimationFrame(drawFrame);
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
      {/* Hidden audio element for natural Gemini TTS guided narration */}
      <audio ref={audioRef} playsInline className="hidden" aria-hidden="true" />

      {/* Animated battery compartment fallback layer (guarantees crisp visual loop even offline) */}
      <canvas
        ref={canvasRef}
        data-testid="demo-video-canvas"
        aria-label="Looping demonstration of opening a battery compartment"
        className="absolute inset-0 h-full w-full"
      />

      {/* Looping mock video element (plays seamlessly when a real MP4 is provided at the placeholder URL) */}
      <video
        src={DEMO_VIDEO_PLACEHOLDER_URL}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setVideoReady(true)}
        onError={() => setVideoReady(false)}
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          videoReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Top & bottom contrast scrims for legible iOS-native overlays */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/35 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        aria-hidden="true"
      />

      {/* Minimal Top Bar: Brand + Audio Guide Control + Skip to Live Camera */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-5 sm:px-8 sm:pt-6">
        <BrandMark subtitle="Interactive Demo" />

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleAudio}
            aria-label={
              needsAudioUnlock
                ? 'Play guided demo voice'
                : isMuted
                  ? 'Unmute guided demo voice'
                  : 'Mute guided demo voice'
            }
            aria-pressed={!isMuted && !needsAudioUnlock}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold backdrop-blur-md transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
              needsAudioUnlock
                ? 'bg-amber-400 text-neutral-950 border-amber-300 shadow-lg shadow-amber-400/20'
                : isMuted
                  ? 'bg-black/55 border-white/15 text-neutral-300 hover:bg-white/15'
                  : 'bg-black/55 border-amber-400/45 text-amber-300 hover:bg-white/15'
            }`}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
            {needsAudioUnlock && <span className="hidden sm:inline">Play Guide</span>}
          </button>

          <button
            type="button"
            onClick={handleCompleteWithAudioStop}
            aria-label="Skip to Live Camera"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-black/55 border border-white/15 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/15 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <span className="sm:hidden">Skip</span>
            <span className="hidden sm:inline">Skip to Camera</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Interactive Mock AI Bounding Box centered tightly over the Battery Latch */}
      {!instructionsOpen && (
        <div className="absolute left-1/2 top-[43%] z-20 -translate-x-1/2 w-[196px] sm:w-[220px] h-[138px]">
          {/* Text Tooltip anchored directly above the highlighted bounding box */}
          <div
            role="note"
            className="pointer-events-none absolute bottom-full left-1/2 mb-4 -translate-x-1/2 w-max max-w-[270px] sm:max-w-xs"
          >
            <div className="relative rounded-2xl bg-neutral-950/90 border border-amber-400/50 px-4 py-2.5 text-center shadow-xl backdrop-blur-md">
              <p className="text-[11px] font-medium text-amber-300 mb-0.5">
                {isSpeaking
                  ? 'Guided Demo · Speaking'
                  : needsAudioUnlock
                    ? 'Interactive Demo · Tap for Voice'
                    : 'Interactive Demo'}
              </p>
              <p className="text-xs sm:text-sm font-medium text-white leading-snug">
                Tap the highlighted area to see instructions.
              </p>
              {/* Tooltip pointer arrow */}
              <span
                className="absolute left-1/2 top-full -translate-x-1/2 border-x-[7px] border-t-[7px] border-x-transparent border-t-neutral-950/90"
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Tappable High-Contrast iOS Focus Bounding Box */}
          <button
            type="button"
            onClick={handleOpenInstructions}
            aria-label="Battery Latch — Tap the highlighted area to see instructions"
            className={`group relative h-full w-full min-h-[56px] min-w-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/12 hover:bg-amber-400/22 transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
              isSpeaking ? 'shadow-[0_0_28px_rgba(251,191,36,0.35)]' : ''
            }`}
          >
            {/* Precision Camera Corner Reticles */}
            <span
              className="pointer-events-none absolute -top-0.5 -left-0.5 h-4 w-4 rounded-tl-xl border-t-[3px] border-l-[3px] border-amber-300"
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute -top-0.5 -right-0.5 h-4 w-4 rounded-tr-xl border-t-[3px] border-r-[3px] border-amber-300"
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-bl-xl border-b-[3px] border-l-[3px] border-amber-300"
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-br-xl border-b-[3px] border-r-[3px] border-amber-300"
              aria-hidden="true"
            />

            {/* Clean bottom label */}
            <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-lg bg-black/85 px-2.5 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap shadow-md">
              <Hand className="h-3.5 w-3.5" aria-hidden="true" />
              {DEMO_BATTERY_HOTSPOT.label}
            </span>
          </button>
        </div>
      )}

      {/* Bottom Action Area when sheet is closed */}
      {!instructionsOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-6 pb-8 sm:pb-10">
          <button
            type="button"
            onClick={handleCompleteWithAudioStop}
            className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-full bg-white px-7 py-3 text-sm font-semibold text-neutral-950 shadow-2xl hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            Start Live Camera
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Plain-English Guided Instruction Sheet synchronized with Step 1 -> Step 2 -> Step 3 audio */}
      {instructionsOpen && (
        <InstructionSheet
          hotspot={DEMO_BATTERY_HOTSPOT}
          isDemo
          activeStepNumber={activeCue.activeStepNumber}
          isSpeaking={isSpeaking}
          isAudioMuted={isMuted}
          onToggleAudio={handleToggleAudio}
          onSelectStep={handleSelectStep}
          primaryActionLabel="Got It, Open Camera"
          onPrimaryAction={handleCompleteWithAudioStop}
          onClose={handleCloseInstructions}
        />
      )}
    </div>
  );
};
