import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flashlight, FlashlightOff, ScanSearch } from 'lucide-react';
import {
  buildHotspotFromDiagnosis,
  type HighlightHotspot,
  type ScanPhase,
} from '../lib/makerLensState';
import { ScanningOverlay } from './ScanningOverlay';
import { InstructionSheet } from './InstructionSheet';

interface LiveCameraViewProps {
  flashlightOn: boolean;
  scanPhase: ScanPhase;
  activeHotspot: HighlightHotspot | null;
  errorMessage: string | null;
  onToggleFlashlight: () => void;
  onStartScan: () => void;
  onScanSucceeded: (hotspot: HighlightHotspot) => void;
  onScanFailed: (message: string) => void;
  onResetScan: () => void;
}

/**
 * The "Magic Window" Live Camera Screen:
 * Full-screen camera feed with zero technical settings.
 * The ONLY on-screen controls are:
 *   1. Flashlight toggle at the top
 *   2. Large pill-shaped "Scan Problem" button at the bottom
 */
export const LiveCameraView: React.FC<LiveCameraViewProps> = ({
  flashlightOn,
  scanPhase,
  activeHotspot,
  errorMessage,
  onToggleFlashlight,
  onStartScan,
  onScanSucceeded,
  onScanFailed,
  onResetScan,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [motionVideoUrl, setMotionVideoUrl] = useState<string | null>(null);
  const [loadingMotionVideo, setLoadingMotionVideo] = useState(false);

  // Initialize live rear-facing camera via MediaDevices API on mount
  useEffect(() => {
    let active = true;

    const initCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraReady(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Check hardware torch capability (supported on modern mobile browsers)
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (caps?.torch) {
          setTorchSupported(true);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch {
        // Fall back gracefully to a realistic preview viewfinder when no camera hardware exists
        if (active) setCameraReady(false);
      }
    };

    void initCamera();

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Apply real hardware torch constraint whenever flashlightOn changes
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !torchSupported) return;

    track
      .applyConstraints({
        advanced: [{ torch: flashlightOn } as MediaTrackConstraintSet],
      })
      .catch(() => {
        // Silently rely on screen-fill light if device refuses torch constraint
      });
  }, [flashlightOn, torchSupported]);

  // Smooth preview viewfinder backdrop when device camera is unavailable (desktop/headless)
  // Throttled to ~15fps and paused while scanning/sheet is open for cool battery/CPU operation.
  useEffect(() => {
    if (cameraReady) return undefined;
    const canvas = fallbackCanvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let lastDraw = 0;
    const startTime = performance.now();

    const renderViewfinder = (now: number) => {
      if (now - lastDraw >= 66 || lastDraw === 0) {
        lastDraw = now;
        const t = (now - startTime) / 1000;
        const dpr = 1;
        const w = canvas.clientWidth || 1280;
        const h = canvas.clientHeight || 720;

        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Ambient home lighting (brightens smoothly when Flashlight is toggled on)
        const lightBoost = flashlightOn ? 1.38 : 1.0;
        const grad = ctx.createRadialGradient(w * 0.5, h * 0.45, 30, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
        grad.addColorStop(0, flashlightOn ? '#47433c' : '#25272b');
        grad.addColorStop(0.55, flashlightOn ? '#272521' : '#15171a');
        grad.addColorStop(1, '#090a0c');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Subtle natural handheld drift
        const driftX = Math.sin(t * 0.8) * 3;
        const driftY = Math.cos(t * 0.6) * 2;
        const cx = w * 0.5 + driftX;
        const cy = h * 0.46 + driftY;

        // Cabinet door hinge & recessed screw subject in viewfinder
        ctx.fillStyle = `rgba(${Math.round(58 * lightBoost)}, ${Math.round(62 * lightBoost)}, ${Math.round(70 * lightBoost)}, 1)`;
        ctx.beginPath();
        ctx.roundRect(cx - 110, cy - 72, 220, 144, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Brushed metal hinge plate
        const plateGrad = ctx.createLinearGradient(cx - 80, cy - 35, cx + 80, cy + 35);
        plateGrad.addColorStop(0, flashlightOn ? '#b9c0ca' : '#7f8794');
        plateGrad.addColorStop(0.5, flashlightOn ? '#e2e7ee' : '#a7b0be');
        plateGrad.addColorStop(1, flashlightOn ? '#8b93a0' : '#5e6673');
        ctx.fillStyle = plateGrad;
        ctx.beginPath();
        ctx.roundRect(cx - 82, cy - 38, 164, 76, 10);
        ctx.fill();

        // Center Phillips fastener head
        ctx.fillStyle = flashlightOn ? '#f3f5f8' : '#cfd6e0';
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3b424d';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();

        // Flashlight beam cone overlay when active without physical torch
        if (flashlightOn) {
          const beam = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.45, Math.min(w, h) * 0.55);
          beam.addColorStop(0, 'rgba(255, 250, 232, 0.22)');
          beam.addColorStop(1, 'rgba(255, 250, 232, 0)');
          ctx.fillStyle = beam;
          ctx.fillRect(0, 0, w, h);
        }

        ctx.restore();
      }

      if (scanPhase !== 'scanning' && !sheetOpen) {
        rafId = window.requestAnimationFrame(renderViewfinder);
      }
    };

    rafId = window.requestAnimationFrame(renderViewfinder);
    return () => window.cancelAnimationFrame(rafId);
  }, [cameraReady, flashlightOn, scanPhase, sheetOpen]);

  // Capture a snapshot frame from live camera or preview canvas
  const captureFrameDataUrl = useCallback((): string | null => {
    let canvas = captureCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      captureCanvasRef.current = canvas;
    }
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (cameraReady && videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, 640, 360);
    } else if (fallbackCanvasRef.current) {
      ctx.drawImage(fallbackCanvasRef.current, 0, 0, 640, 360);
    } else {
      return null;
    }
    return canvas.toDataURL('image/jpeg', 0.82);
  }, [cameraReady]);

  // Primary "Scan Problem" handler: blurs camera with human-readable spinner and calls backend
  const handleScanProblem = async () => {
    setMotionVideoUrl(null);
    setSheetOpen(false);
    onStartScan();

    const frame = captureFrameDataUrl();
    if (!frame) {
      onScanFailed("We couldn't capture a clear image. Hold steady and try again.");
      return;
    }

    try {
      const resp = await fetch('/api/analyze-buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: [{ timestampMs: Date.now(), dataUrl: frame }],
          ingestMode: 'webrtc_15fps',
          scaleAnchor: 'none',
          hasWebXRDepth: false,
          stillDurationMs: 3200,
          userQuestion: 'Identify the main part and explain the safest next step in simple everyday terms.',
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error('Could not complete the scan right now.');
      }

      const hotspot = buildHotspotFromDiagnosis(data);
      onScanSucceeded(hotspot);
      setSheetOpen(true);
    } catch {
      onScanFailed(
        "We couldn't get a clear look just now. Add a little more light, hold steady, and tap Scan Problem again."
      );
    }
  };

  // Optional "Show Me How" motion clip from backend
  const handleRequestMotionVideo = async () => {
    if (!activeHotspot?.motionPrompt) return;
    setLoadingMotionVideo(true);
    try {
      const frame = captureFrameDataUrl();
      const resp = await fetch('/api/generate-pip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activeHotspot.motionPrompt,
          referenceFrameDataUrl: frame,
          duration: '6s',
        }),
      });
      const data = await resp.json();
      if (resp.ok && (data.videoDataUrl || data.videoUri)) {
        setMotionVideoUrl(data.videoDataUrl || data.videoUri);
      }
    } finally {
      setLoadingMotionVideo(false);
    }
  };

  const isScanning = scanPhase === 'scanning';

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
      {/* Full-Screen "Magic Window" Camera Feed (blurs smoothly while scanning) */}
      <div
        className={`absolute inset-0 transition-all duration-300 ${
          isScanning ? 'scale-105 blur-md' : 'scale-100 blur-0'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover ${
            cameraReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {!cameraReady && (
          <canvas
            ref={fallbackCanvasRef}
            data-testid="live-camera-canvas"
            aria-label="Live repair viewfinder"
            className="absolute inset-0 h-full w-full"
          />
        )}
      </div>

      {/* Soft screen-fill light ring when Flashlight is toggled on a device without hardware torch */}
      {flashlightOn && !torchSupported && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 border-[10px] border-amber-100/40 shadow-[inset_0_0_90px_rgba(255,248,220,0.28)] transition-opacity duration-200"
        />
      )}

      {/* Measured top & bottom scrims for crisp iOS-camera contrast */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-t from-black/80 via-black/35 to-transparent"
        aria-hidden="true"
      />

      {/* TOP CONTROL: Strictly the Flashlight Toggle (zero technical settings) */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6">
        <span className="text-base font-bold tracking-tight text-white/95">MakerLens</span>

        <button
          type="button"
          onClick={onToggleFlashlight}
          aria-pressed={flashlightOn}
          aria-label={flashlightOn ? 'Turn flashlight off' : 'Turn flashlight on'}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            flashlightOn
              ? 'bg-amber-400 text-neutral-950 shadow-lg shadow-amber-400/25'
              : 'bg-black/55 border border-white/15 text-white hover:bg-black/70'
          }`}
        >
          {flashlightOn ? (
            <Flashlight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <FlashlightOff className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="whitespace-nowrap">{flashlightOn ? 'Flashlight On' : 'Flashlight'}</span>
        </button>
      </header>

      {/* Highlighted Part Overlay after a successful scan */}
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
            aria-label={`View repair instructions for ${activeHotspot.label}`}
            className="relative h-full w-full min-h-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/15 hover:bg-amber-400/25 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap shadow-md">
              {activeHotspot.label}
            </span>
          </button>
        </div>
      )}

      {/* Human-Readable Blurred Scanning Overlay ("Analyzing the threads...") */}
      {isScanning && <ScanningOverlay />}

      {/* Plain-English Recovery Notice when scan couldn't complete */}
      {scanPhase === 'error' && errorMessage && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-28 z-20 mx-auto max-w-sm rounded-2xl bg-neutral-950/90 border border-white/15 px-5 py-4 text-center shadow-2xl backdrop-blur-xl"
        >
          <p className="text-sm font-medium text-white leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* BOTTOM CONTROL: Strictly the large, pill-shaped "Scan Problem" button */}
      {!sheetOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-6 pb-8 sm:pb-10">
          <button
            type="button"
            onClick={() => void handleScanProblem()}
            disabled={isScanning}
            className="inline-flex min-h-[58px] min-w-[230px] items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-base font-bold tracking-tight text-neutral-950 shadow-2xl shadow-black/50 hover:bg-neutral-100 active:scale-[0.97] transition-all disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400"
          >
            <ScanSearch className="h-5 w-5 text-neutral-950" aria-hidden="true" />
            {isScanning ? 'Scanning...' : 'Scan Problem'}
          </button>
        </div>
      )}

      {/* Step-by-Step Repair Instruction Sheet */}
      {scanPhase === 'result' && activeHotspot && sheetOpen && (
        <InstructionSheet
          hotspot={activeHotspot}
          primaryActionLabel="Scan Again"
          onPrimaryAction={() => {
            setSheetOpen(false);
            setMotionVideoUrl(null);
            onResetScan();
          }}
          onClose={() => setSheetOpen(false)}
          motionVideoUrl={motionVideoUrl}
          loadingMotionVideo={loadingMotionVideo}
          onRequestMotionVideo={activeHotspot.motionPrompt ? () => void handleRequestMotionVideo() : undefined}
        />
      )}
    </div>
  );
};
