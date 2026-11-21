import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Hand,
  Mic,
  Play,
  RotateCcw,
  ScanSearch,
  Square,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';

// =============================================================================
// MakerLens — Standalone React + Tailwind PWA Frontend (`App.jsx`)
//
// UX Architecture:
//   1. "Magic Window" Live Camera: Full-screen camera feed with zero technical
//      settings — ONLY a Flashlight toggle at the top and a large pill-shaped
//      "Scan Problem" button at the bottom.
//   2. Interactive Onboarding (<DemoMode />): Runs automatically on the user's
//      first visit, looping a placeholder video of opening a battery compartment
//      with a tappable AI bounding box and tooltip:
//      "Tap the highlighted area to see instructions."
//   3. Human-Readable States: Blurred camera backdrop with a crisp spinner
//      displaying friendly messages ("Analyzing the threads...") instead of
//      technical API status strings.
// =============================================================================

const ONBOARDING_STORAGE_KEY = 'makerlens_onboarding_completed';

// Placeholder video URL for the battery-compartment walkthrough.
// If the MP4 cannot be reached (e.g. offline/first run), DemoMode seamlessly
// displays a looping HTML5 canvas animation of a battery compartment behind it.
const DEMO_VIDEO_PLACEHOLDER_URL =
  'https://example.com/makerlens/demo-battery-compartment.mp4';

const SCANNING_MESSAGES = [
  'Analyzing the threads...',
  'Checking how the parts fit together...',
  'Finding the safest next step...',
];

const DEMO_BATTERY_HOTSPOT = {
  id: 'battery-release-latch',
  label: 'Battery Latch',
  xPct: 37,
  yPct: 44,
  wPct: 26,
  hPct: 20,
  summary:
    'Press the ridged latch inward and slide the cover down to open the battery compartment.',
  toolNeeded: 'No tools needed (thumb press)',
  steps: [
    {
      number: 1,
      title: 'Press the ridged release tab',
      detail:
        'Place your thumb on the textured groove inside the highlighted box and press gently inward.',
    },
    {
      number: 2,
      title: 'Slide the cover downward',
      detail:
        'While holding light inward pressure, glide the plastic door toward the bottom edge until it clicks free.',
    },
    {
      number: 3,
      title: 'Lift and check polarity',
      detail:
        'Lift the cover away and match the + and − symbols printed inside the tray when replacing batteries.',
    },
  ],
};

// -----------------------------------------------------------------------------
// State Management: Switching Cleanly Between Demo Mode & Live Camera Mode
// -----------------------------------------------------------------------------
// We store the entire app lifecycle in a single predictable reducer so that:
//   - `mode` is strictly `'demo'` (first visit) or `'live'` (Magic Window).
//   - Leaving `'demo'` via `COMPLETE_DEMO` sets `hasCompletedOnboarding = true`
//     (persisted to localStorage) and resets any transient scan state before
//     <LiveCameraView /> mounts and requests MediaDevices camera permission.
//   - Returning visitors skip <DemoMode /> immediately and open straight into
//     the Live Camera feed (unless `?demo=1` is passed in the URL).
// -----------------------------------------------------------------------------
function resolveInitialMode() {
  if (typeof window === 'undefined') return { mode: 'demo', hasCompletedOnboarding: false };
  const params = new URLSearchParams(window.location.search);
  let completed = false;
  try {
    completed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    completed = false;
  }

  if (params.get('demo') === '1') {
    return { mode: 'demo', hasCompletedOnboarding: completed };
  }
  if (params.get('autostart') === '1' || completed) {
    return { mode: 'live', hasCompletedOnboarding: completed };
  }
  return { mode: 'demo', hasCompletedOnboarding: false };
}

function createInitialState() {
  const { mode, hasCompletedOnboarding } = resolveInitialMode();
  return {
    mode, // 'demo' | 'live'
    hasCompletedOnboarding,
    flashlightOn: false,
    scanPhase: 'idle', // 'idle' | 'scanning' | 'result' | 'error'
    activeHotspot: null,
    errorMessage: null,
  };
}

function makerLensReducer(state, action) {
  switch (action.type) {
    case 'COMPLETE_DEMO':
      // Transition from Demo Mode -> Live Camera Mode and mark onboarding done.
      // Because <DemoMode /> unmounts and <LiveCameraView /> mounts on this transition,
      // the browser only prompts for real camera permissions after onboarding completes.
      return {
        ...state,
        mode: 'live',
        hasCompletedOnboarding: true,
        scanPhase: 'idle',
        activeHotspot: null,
        errorMessage: null,
      };
    case 'ENTER_DEMO':
      // Safe switch back to Demo Mode: automatically turns off flashlight & clears scans.
      return {
        ...state,
        mode: 'demo',
        flashlightOn: false,
        scanPhase: 'idle',
        activeHotspot: null,
        errorMessage: null,
      };
    case 'TOGGLE_FLASHLIGHT':
      return { ...state, flashlightOn: !state.flashlightOn };
    case 'START_SCAN':
      return { ...state, scanPhase: 'scanning', activeHotspot: null, errorMessage: null };
    case 'SCAN_SUCCEEDED':
      return { ...state, scanPhase: 'result', activeHotspot: action.hotspot, errorMessage: null };
    case 'SCAN_FAILED':
      return { ...state, scanPhase: 'error', activeHotspot: null, errorMessage: action.message };
    case 'RESET_SCAN':
      return { ...state, scanPhase: 'idle', activeHotspot: null, errorMessage: null };
    default:
      return state;
  }
}

// -----------------------------------------------------------------------------
// Component 1: Human-Readable Blurred Scanning Overlay
// -----------------------------------------------------------------------------
function ScanningOverlay() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % SCANNING_MESSAGES.length);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xl px-6"
    >
      <div className="flex flex-col items-center rounded-3xl bg-neutral-900/85 border border-white/15 px-8 py-7 text-center shadow-2xl max-w-xs w-full">
        <div className="relative h-12 w-12" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border-[3px] border-white/15" />
          <span className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-amber-400 animate-spin" />
        </div>
        <p className="mt-5 text-base font-semibold tracking-tight text-white">
          {SCANNING_MESSAGES[messageIndex]}
        </p>
        <p className="mt-1.5 text-xs text-neutral-300 leading-relaxed">
          Hold your camera steady for just a moment.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component 2: iOS-Style Step-by-Step Repair Instruction Sheet
// -----------------------------------------------------------------------------
function InstructionSheet({
  hotspot,
  primaryActionLabel,
  onPrimaryAction,
  onClose,
  isDemo = false,
  motionVideoUrl = null,
  loadingMotionVideo = false,
  onRequestMotionVideo = null,
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="makerlens-sheet-title"
    >
      <div className="pointer-events-auto w-full max-w-lg rounded-3xl bg-neutral-950/95 border border-white/15 text-white shadow-2xl backdrop-blur-2xl overflow-hidden">
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <div className="px-5 pt-2 pb-5 sm:px-6 sm:pb-6 max-h-[75dvh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-amber-400">
                {isDemo ? 'Guided Practice · Step-by-Step' : 'Repair Guide'}
              </p>
              <h2 id="makerlens-sheet-title" className="mt-0.5 text-xl font-bold tracking-tight text-white">
                {hotspot.label}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close instructions"
              className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-neutral-200">{hotspot.summary}</p>

          <div className="mt-3.5 flex items-center gap-2 border-y border-white/10 py-2.5 text-xs text-neutral-300">
            <Wrench className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              What you need: <strong className="font-semibold text-white">{hotspot.toolNeeded}</strong>
            </span>
          </div>

          {motionVideoUrl && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video src={motionVideoUrl} autoPlay loop muted playsInline className="aspect-video w-full object-cover" />
            </div>
          )}

          <ol className="mt-4 space-y-3.5">
            {hotspot.steps.map((step) => (
              <li key={step.number} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-neutral-950">
                  {step.number}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-300">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            {!isDemo && onRequestMotionVideo && !motionVideoUrl && (
              <button
                type="button"
                onClick={onRequestMotionVideo}
                disabled={loadingMotionVideo}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15 transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {loadingMotionVideo ? 'Creating visual clip...' : 'Show Me How'}
              </button>
            )}
            <button
              type="button"
              onClick={onPrimaryAction}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-neutral-950 shadow-lg hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap"
            >
              {isDemo ? (
                <CheckCircle2 className="h-4 w-4 text-neutral-950" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4 text-neutral-950" aria-hidden="true" />
              )}
              {primaryActionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component 3: Interactive Onboarding Demo (<DemoMode />)
// -----------------------------------------------------------------------------
function DemoMode({ onComplete }) {
  const canvasRef = useRef(null);
  const [videoReady, setVideoReady] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Looping battery-compartment animation acts as a resilient fallback behind the
  // placeholder <video> so users never see an empty black frame if the mock MP4 fails.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let lastDraw = 0;
    const startTime = performance.now();

    const drawFrame = (now) => {
      if (now - lastDraw >= 50 || lastDraw === 0) {
        lastDraw = now;
        const elapsed = (now - startTime) / 1000;
        const w = canvas.clientWidth || 1280;
        const h = canvas.clientHeight || 720;

        if (canvas.width !== Math.floor(w) || canvas.height !== Math.floor(h)) {
          canvas.width = Math.floor(w);
          canvas.height = Math.floor(h);
        }

        ctx.save();
        const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
        bg.addColorStop(0, '#2a2622');
        bg.addColorStop(0.55, '#191715');
        bg.addColorStop(1, '#0d0c0b');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const bodyW = Math.min(w * 0.62, 340);
        const bodyH = Math.min(h * 0.66, 440);
        const bodyX = (w - bodyW) / 2;
        const bodyY = (h - bodyH) / 2 - 8;

        ctx.fillStyle = '#24272d';
        ctx.beginPath();
        ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 34);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const cycle = (elapsed % 4.5) / 4.5;
        const slideProgress =
          cycle < 0.25
            ? 0
            : cycle < 0.55
              ? Math.sin(((cycle - 0.25) / 0.3) * (Math.PI / 2))
              : cycle < 0.8
                ? 1
                : Math.cos(((cycle - 0.8) / 0.2) * (Math.PI / 2));

        const bayW = bodyW * 0.68;
        const bayH = bodyH * 0.54;
        const bayX = (w - bayW) / 2;
        const bayY = bodyY + bodyH * 0.28;
        const doorY = bayY + slideProgress * 30;

        ctx.fillStyle = '#111317';
        ctx.beginPath();
        ctx.roundRect(bayX, bayY, bayW, bayH, 16);
        ctx.fill();

        ctx.fillStyle = '#343942';
        ctx.beginPath();
        ctx.roundRect(bayX, doorY, bayW, bayH, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.stroke();

        const latchW = Math.min(bayW * 0.44, 86);
        const latchX = w / 2 - latchW / 2;
        const latchY = doorY + 26;
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(255,255,255,0.34)';
          ctx.beginPath();
          ctx.roundRect(latchX, latchY + i * 8, latchW, 3.5, 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (!instructionsOpen) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [instructionsOpen]);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      {/* Looping mock video of opening a battery compartment */}
      <video
        src={DEMO_VIDEO_PLACEHOLDER_URL}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setVideoReady(true)}
        onError={() => setVideoReady(false)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          videoReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/35 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-5 sm:px-8 sm:pt-6">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <img
            src="/src/assets/images/jack_of_spades_logo_1795301467945.jpg"
            alt="Jack of All Trades logo — Jack of Spades card holding a hammer"
            referrerPolicy="no-referrer"
            className="h-10 w-[30px] sm:h-11 sm:w-[33px] shrink-0 rounded-[5px] border border-white/30 object-cover shadow-md shadow-black/50"
          />
          <div className="flex flex-col min-w-0">
            <span className="text-[15px] sm:text-lg font-bold tracking-tight text-white leading-tight whitespace-nowrap">
              Jack of All Trades
            </span>
            <span className="text-[11px] sm:text-xs text-neutral-300 leading-tight whitespace-nowrap">
              Practice Guide
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onComplete}
          aria-label="Skip to Live Camera"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-black/55 border border-white/15 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/15 transition-colors whitespace-nowrap"
        >
          <span className="sm:hidden">Skip</span>
          <span className="hidden sm:inline">Skip to Camera</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>

      {/* Mock AI Bounding Box + Onboarding Tooltip */}
      <div className="absolute left-1/2 top-[43%] z-20 -translate-x-1/2 w-[196px] sm:w-[220px] h-[138px]">
        {!instructionsOpen && (
          <div
            role="note"
            className="pointer-events-none absolute bottom-full left-1/2 mb-4 -translate-x-1/2 w-max max-w-[260px] sm:max-w-xs"
          >
            <div className="relative rounded-2xl bg-neutral-950/90 border border-amber-400/50 px-4 py-2.5 text-center shadow-xl backdrop-blur-md">
              <p className="text-xs sm:text-sm font-medium text-white leading-snug">
                Tap the highlighted area to see instructions.
              </p>
              <span
                className="absolute left-1/2 top-full -translate-x-1/2 border-x-[7px] border-t-[7px] border-x-transparent border-t-neutral-950/90"
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setInstructionsOpen(true)}
          aria-label="Battery Latch — Tap the highlighted area to see instructions"
          className="relative h-full w-full min-h-[56px] min-w-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/15 hover:bg-amber-400/25 transition-all cursor-pointer"
        >
          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-lg bg-black/80 px-2.5 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap">
            <Hand className="h-3.5 w-3.5" aria-hidden="true" />
            {DEMO_BATTERY_HOTSPOT.label}
          </span>
        </button>
      </div>

      {!instructionsOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-6 pb-8 sm:pb-10">
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-neutral-950 shadow-xl hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap"
          >
            Start Live Camera
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {instructionsOpen && (
        <InstructionSheet
          hotspot={DEMO_BATTERY_HOTSPOT}
          isDemo
          primaryActionLabel="Got It — Open Live Camera"
          onPrimaryAction={onComplete}
          onClose={() => setInstructionsOpen(false)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component 4: The "Magic Window" Live Camera Screen
// -----------------------------------------------------------------------------
function LiveCameraView({
  flashlightOn,
  scanPhase,
  activeHotspot,
  errorMessage,
  onToggleFlashlight,
  onStartScan,
  onScanSucceeded,
  onScanFailed,
  onResetScan,
}) {
  const videoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Start rear camera when Live Camera Mode mounts; release tracks automatically on unmount
  useEffect(() => {
    let active = true;
    const initCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track?.getCapabilities?.()?.torch) setTorchSupported(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch {
        if (active) setCameraReady(false);
      }
    };
    void initCamera();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
      if (responseAudioUrlRef.current) URL.revokeObjectURL(responseAudioUrlRef.current);
    };
  }, []);

  // Rolling buffer of recent JPEG frames + MediaRecorder & <audio> refs for Push-to-Talk
  const frameBufferRef = useRef([]);
  const micStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordStartMsRef = useRef(0);
  const recordTimerRef = useRef(null);
  const isHoldingRef = useRef(false);
  const audioPlayerRef = useRef(null);
  const responseAudioUrlRef = useRef(null);

  const [voicePhase, setVoicePhase] = useState('idle'); // 'idle' | 'recording' | 'thinking' | 'speaking'
  const [recordingMs, setRecordingMs] = useState(0);
  const [spokenReply, setSpokenReply] = useState(null);
  const [spokenLanguage, setSpokenLanguage] = useState(null);
  const [voiceNotice, setVoiceNotice] = useState(null);
  const [hasReplyAudio, setHasReplyAudio] = useState(false);

  // Sync hardware flashlight torch when supported
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !torchSupported) return;
    track.applyConstraints({ advanced: [{ torch: flashlightOn }] }).catch(() => {});
  }, [flashlightOn, torchSupported]);

  // Capture a 640x360 JPEG snapshot from the live camera feed
  const captureFrameDataUrl = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) return null;
    const canvas = captureCanvasRef.current || document.createElement('canvas');
    captureCanvasRef.current = canvas;
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(videoRef.current, 0, 0, 640, 360);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  // Keep a lightweight rolling buffer of up to 4 frames for Push-to-Talk visual context
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (scanPhase === 'scanning' || voicePhase === 'thinking' || sheetOpen) return;
      const dataUrl = captureFrameDataUrl();
      if (!dataUrl) return;
      frameBufferRef.current = [...frameBufferRef.current, { timestampMs: Date.now(), dataUrl }].slice(-4);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [captureFrameDataUrl, scanPhase, voicePhase, sheetOpen]);

  // Encode MediaRecorder audio Blob -> Base64 data URL for JSON transport to Express
  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Audio encode failed'));
      reader.onerror = () => reject(new Error('Audio read failed'));
      reader.readAsDataURL(blob);
    });

  const stopAudioPlayback = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
    }
    setVoicePhase((prev) => (prev === 'speaking' ? 'idle' : prev));
  }, []);

  const handleReplayAudio = useCallback(async () => {
    if (!audioPlayerRef.current || !responseAudioUrlRef.current) return;
    try {
      audioPlayerRef.current.currentTime = 0;
      setVoicePhase('speaking');
      await audioPlayerRef.current.play();
    } catch {
      setVoicePhase('idle');
    }
  }, []);

  // Package recorded audio Blob + rolling video buffer -> POST /api/voice-assist -> play binary WAV
  const sendVoiceExplainPayload = useCallback(
    async (audioBlob) => {
      setVoicePhase('thinking');
      setVoiceNotice(null);
      try {
        // 1. Encode binary MediaRecorder Blob into a Base64 data URL
        const audioDataUrl = await blobToDataUrl(audioBlob);
        const latest = captureFrameDataUrl();
        const frames = [...frameBufferRef.current, ...(latest ? [{ timestampMs: Date.now(), dataUrl: latest }] : [])].slice(-4);

        // 2. Request a binary `audio/wav` stream directly from Express (`Accept: audio/wav`)
        const resp = await fetch('/api/voice-assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
          body: JSON.stringify({
            frames,
            preferredLanguage: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            audio: { data: audioDataUrl, mimeType: audioBlob.type || 'audio/webm' },
          }),
        });
        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.error || "Couldn't hear that clearly. Hold the button a moment longer.");
        }

        // 3. Receive binary WAV Blob and bind it to the hidden <audio> player via URL.createObjectURL
        const wavBlob = await resp.blob();
        const objectUrl = URL.createObjectURL(wavBlob);
        const headerTranscript = resp.headers.get('X-MakerLens-Transcript');
        const headerLangName = resp.headers.get('X-MakerLens-Language-Name');
        if (headerTranscript) setSpokenReply(decodeURIComponent(headerTranscript));
        setSpokenLanguage(headerLangName ? decodeURIComponent(headerLangName) : null);

        if (responseAudioUrlRef.current) URL.revokeObjectURL(responseAudioUrlRef.current);
        responseAudioUrlRef.current = objectUrl;
        setHasReplyAudio(true);

        if (audioPlayerRef.current) {
          audioPlayerRef.current.src = objectUrl;
          setVoicePhase('speaking');
          await audioPlayerRef.current.play().catch(() => setVoicePhase('idle'));
        } else {
          setVoicePhase('idle');
        }
      } catch (err) {
        setVoicePhase('idle');
        setVoiceNotice(err?.message || 'Hold the button while speaking and try again.');
      }
    },
    [captureFrameDataUrl]
  );

  // Push-to-Talk PRESS: start capturing microphone audio via MediaRecorder
  const handleStartTalking = useCallback(async () => {
    if (isHoldingRef.current || scanPhase === 'scanning' || voicePhase === 'thinking') return;
    isHoldingRef.current = true;
    setVoiceNotice(null);
    stopAudioPlayback();

    try {
      let micStream = micStreamRef.current;
      if (!micStream || !micStream.getAudioTracks().some((t) => t.readyState === 'live')) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        micStreamRef.current = micStream;
      }
      if (!isHoldingRef.current) return;

      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported?.(m)
      );
      const recorder = preferredMime
        ? new MediaRecorder(micStream, { mimeType: preferredMime })
        : new MediaRecorder(micStream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
        const elapsed = Date.now() - recordStartMsRef.current;
        setRecordingMs(0);
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || preferredMime || 'audio/webm' });
        audioChunksRef.current = [];
        if (elapsed < 350 || blob.size < 256) {
          setVoicePhase('idle');
          setVoiceNotice('Hold the button down while speaking, then release.');
          return;
        }
        void sendVoiceExplainPayload(blob);
      };

      mediaRecorderRef.current = recorder;
      recordStartMsRef.current = Date.now();
      setVoicePhase('recording');
      recorder.start(150);
      recordTimerRef.current = window.setInterval(() => setRecordingMs(Date.now() - recordStartMsRef.current), 200);
    } catch {
      isHoldingRef.current = false;
      setVoicePhase('idle');
      setVoiceNotice('Please allow microphone access to explain the problem out loud.');
    }
  }, [scanPhase, sendVoiceExplainPayload, stopAudioPlayback, voicePhase]);

  // Push-to-Talk RELEASE: stop MediaRecorder (triggers onstop -> upload -> WAV speech playback)
  const handleStopTalking = useCallback(() => {
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      setVoicePhase('idle');
    }
  }, []);

  const handleScanProblem = async () => {
    stopAudioPlayback();
    setVoiceNotice(null);
    setSheetOpen(false);
    onStartScan();

    const frameDataUrl = captureFrameDataUrl();

    try {
      const resp = await fetch('/api/analyze-buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: frameDataUrl ? [{ timestampMs: Date.now(), dataUrl: frameDataUrl }] : [],
          ingestMode: 'webrtc_15fps',
          scaleAnchor: 'none',
          hasWebXRDepth: false,
          stillDurationMs: 3200,
          userQuestion: 'Identify the main part and explain the safest next step simply.',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error('Scan failed');

      const diag = data.diagnosis || {};
      onScanSucceeded({
        id: 'live-hotspot',
        label: diag.componentName || 'Highlighted Area',
        xPct: 32,
        yPct: 33,
        wPct: 36,
        hPct: 26,
        summary: diag.diagnosisSummary || 'Check the highlighted part carefully before turning.',
        toolNeeded: diag.toolRequired || 'No special tools needed',
        steps: [
          { number: 1, title: 'Inspect the part', detail: diag.diagnosisSummary || 'Align cleanly.' },
          { number: 2, title: 'Follow the next step', detail: diag.nextStepInstruction || 'Turn gently clockwise.' },
        ],
      });
      setSheetOpen(true);
    } catch {
      onScanFailed(
        "We couldn't get a clear look just now. Add a little more light, hold steady, and tap Scan Problem again."
      );
    }
  };

  const isScanning = scanPhase === 'scanning';
  const isThinkingVoice = voicePhase === 'thinking';
  const isRecording = voicePhase === 'recording';
  const isSpeaking = voicePhase === 'speaking';
  const isBusy = isScanning || isThinkingVoice;
  const formattedTimer = `${Math.floor(recordingMs / 60000)}:${String(Math.floor((recordingMs / 1000) % 60)).padStart(2, '0')}`;

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
      {/* Hidden <audio> element automatically plays the binary WAV stream returned by Express */}
      <audio
        ref={audioPlayerRef}
        className="hidden"
        onEnded={() => setVoicePhase('idle')}
        onError={() => setVoicePhase('idle')}
      />

      {/* Full-Screen Camera Viewfinder (blurs cleanly while analyzing) */}
      <div className={`absolute inset-0 transition-all duration-300 ${isBusy ? 'scale-105 blur-md' : 'scale-100 blur-0'}`}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${cameraReady ? 'opacity-100' : 'opacity-40'}`}
        />
      </div>

      {/* Screen-fill light fallback when hardware torch isn't available */}
      {flashlightOn && !torchSupported && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 border-[10px] border-amber-100/40 shadow-[inset_0_0_90px_rgba(255,248,220,0.28)]"
        />
      )}

      {/* Top & bottom contrast scrims */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* Top Control: Brand Logo + Flashlight Toggle */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-5 pt-5 sm:px-8 sm:pt-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/src/assets/images/jack_of_spades_logo_1795301467945.jpg"
            alt="Jack of All Trades logo — Jack of Spades card holding a hammer"
            referrerPolicy="no-referrer"
            className="h-9 w-[27px] shrink-0 rounded-[5px] border border-white/30 object-cover shadow-md shadow-black/50"
          />
          <span className="text-base font-bold tracking-tight text-white/95 whitespace-nowrap truncate">
            Jack of All Trades
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleFlashlight}
          aria-pressed={flashlightOn}
          aria-label={flashlightOn ? 'Turn flashlight off' : 'Turn flashlight on'}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all ${
            flashlightOn
              ? 'bg-amber-400 text-neutral-950 shadow-lg shadow-amber-400/25'
              : 'bg-black/55 border border-white/15 text-white hover:bg-black/70'
          }`}
        >
          {flashlightOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
          <span>{flashlightOn ? 'Flashlight On' : 'Flashlight'}</span>
        </button>
      </header>

      {/* Highlighted Part Overlay */}
      {scanPhase === 'result' && activeHotspot && (
        <div
          className="absolute z-20"
          style={{
            left: `${activeHotspot.xPct}%`,
            top: `${activeHotspot.yPct}%`,
            width: `${activeHotspot.wPct}%`,
            height: `${activeHotspot.hPct}%`,
          }}
        >
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="relative h-full w-full min-h-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/15 hover:bg-amber-400/25 transition-colors"
          >
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap">
              {activeHotspot.label}
            </span>
          </button>
        </div>
      )}

      {/* Human-Readable Blurred Scanning / Voice Processing State */}
      {isScanning && <ScanningOverlay />}
      {isThinkingVoice && <ScanningOverlay customMessage="Listening to your question..." />}

      {/* Live Recording Cue */}
      {isRecording && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-4 bottom-28 z-20 mx-auto flex max-w-xs items-center justify-center gap-2.5 rounded-full bg-red-600/95 px-5 py-2.5 text-sm font-semibold text-white shadow-2xl"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping" />
          <span className="tabular-nums">{formattedTimer}</span>
          <span>Release when finished</span>
        </div>
      )}

      {/* Spoken AI Mechanic Caption Card + Replay/Stop Control */}
      {!sheetOpen && !isRecording && !isBusy && spokenReply && (
        <div className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-md rounded-2xl bg-neutral-950/90 border border-white/15 px-4 py-3.5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => (isSpeaking ? stopAudioPlayback() : void handleReplayAudio())}
              disabled={!hasReplyAudio}
              aria-label={isSpeaking ? 'Stop spoken response' : 'Replay spoken response'}
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                isSpeaking ? 'bg-amber-400 text-neutral-950 animate-pulse' : 'bg-white/12 text-amber-400'
              }`}
            >
              {isSpeaking ? <Square className="h-4 w-4 fill-current" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                {isSpeaking ? 'Speaking' : 'Mechanic Guidance'}
                {spokenLanguage ? ` · ${spokenLanguage}` : ''}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-white">{spokenReply}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                stopAudioPlayback();
                setSpokenReply(null);
              }}
              aria-label="Dismiss spoken response"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Plain-English Error Notice */}
      {!isRecording && !isBusy && (voiceNotice || (scanPhase === 'error' && errorMessage)) && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-sm rounded-2xl bg-neutral-950/90 border border-white/15 px-5 py-4 text-center shadow-2xl backdrop-blur-xl"
        >
          <p className="text-sm font-medium text-white leading-relaxed">{voiceNotice || errorMessage}</p>
        </div>
      )}

      {/* Bottom Dock: "Scan Problem" + Push-to-Talk "Hold to Explain" */}
      {!sheetOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-7 sm:px-6 sm:pb-10">
          <div className="flex w-full max-w-md items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void handleScanProblem()}
              disabled={isBusy || isRecording}
              className="inline-flex min-h-[56px] flex-1 items-center justify-center gap-2.5 rounded-full bg-white px-5 py-3.5 text-sm sm:text-base font-bold tracking-tight text-neutral-950 shadow-2xl hover:bg-neutral-100 active:scale-[0.97] transition-all disabled:opacity-55 whitespace-nowrap"
            >
              <ScanSearch className="h-5 w-5 text-neutral-950" aria-hidden="true" />
              <span>{isScanning ? 'Scanning...' : 'Scan Problem'}</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                void handleStartTalking();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                handleStopTalking();
              }}
              onPointerCancel={() => handleStopTalking()}
              disabled={isBusy}
              aria-pressed={isRecording}
              className={`touch-none inline-flex min-h-[56px] flex-1 items-center justify-center gap-2.5 rounded-full px-5 py-3.5 text-sm sm:text-base font-bold tracking-tight shadow-2xl transition-all disabled:opacity-55 whitespace-nowrap ${
                isRecording
                  ? 'scale-[1.03] bg-red-500 text-white shadow-red-500/40 ring-4 ring-red-400/35'
                  : 'border border-white/25 bg-black/70 text-white backdrop-blur-xl hover:bg-black/85'
              }`}
            >
              <Mic className={`h-5 w-5 ${isRecording ? 'text-white' : 'text-amber-400'}`} aria-hidden="true" />
              <span>{isRecording ? `Listening ${formattedTimer}` : isThinkingVoice ? 'Thinking...' : 'Hold to Explain'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Repair Instruction Sheet */}
      {scanPhase === 'result' && activeHotspot && sheetOpen && (
        <InstructionSheet
          hotspot={activeHotspot}
          primaryActionLabel="Scan Again"
          onPrimaryAction={() => {
            setSheetOpen(false);
            onResetScan();
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Root Component: Orchestrates Demo Mode <-> Live Camera Mode State
// -----------------------------------------------------------------------------
export default function App() {
  // Lazy initializer reads localStorage once on mount to decide whether this is
  // the user's first visit ('demo') or a returning visit ('live').
  const [state, dispatch] = useReducer(makerLensReducer, undefined, createInitialState);

  // Persist onboarding completion to localStorage as soon as the user finishes Demo Mode.
  useEffect(() => {
    if (!state.hasCompletedOnboarding) return;
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch {
      // Ignore private-browsing storage errors
    }
  }, [state.hasCompletedOnboarding]);

  const handleCompleteDemo = useCallback(() => dispatch({ type: 'COMPLETE_DEMO' }), []);

  return (
    <main className="h-dvh w-screen overflow-hidden bg-black">
      {state.mode === 'demo' ? (
        // First visit: safe interactive practice before requesting camera access
        <DemoMode onComplete={handleCompleteDemo} />
      ) : (
        // Returning visit (or after Demo completion): full-screen Magic Window camera
        <LiveCameraView
          flashlightOn={state.flashlightOn}
          scanPhase={state.scanPhase}
          activeHotspot={state.activeHotspot}
          errorMessage={state.errorMessage}
          onToggleFlashlight={() => dispatch({ type: 'TOGGLE_FLASHLIGHT' })}
          onStartScan={() => dispatch({ type: 'START_SCAN' })}
          onScanSucceeded={(hotspot) => dispatch({ type: 'SCAN_SUCCEEDED', hotspot })}
          onScanFailed={(message) => dispatch({ type: 'SCAN_FAILED', message })}
          onResetScan={() => dispatch({ type: 'RESET_SCAN' })}
        />
      )}
    </main>
  );
}
