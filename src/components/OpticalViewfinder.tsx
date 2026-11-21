/**
 * JackOfAllTrades — Optical Viewfinder, Wasm Motion Gate, Burst Capture & PiP Guidance
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 *
 * Renders either the live MediaDevices WebRTC camera feed or a deterministic synthetic
 * workshop bench canvas (with real animated hand motion, glare/water droplets, scale
 * anchor markers, and pixel-delta motion detection) plus tappable WebXR bounding boxes
 * and the Picture-in-Picture (PiP) motion guidance overlay.
 */

import React, { useEffect, useRef } from 'react';
import {
  Camera,
  CheckCircle2,
  Expand,
  Film,
  Hand,
  Minimize2,
  Play,
  RotateCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type { BenchScenario } from '../lib/benchScenarios';
import type { MediaIngestDecision, ScaleAnchorType } from '../lib/routingLogic';

export interface CapturedFrame {
  timestampMs: number;
  dataUrl: string;
}

export interface PipGuidanceState {
  visible: boolean;
  expanded: boolean;
  loading: boolean;
  videoUrl: string | null;
  error: string | null;
}

interface OpticalViewfinderProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  syntheticCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraActive: boolean;
  scenario: BenchScenario;
  ingestDecision: MediaIngestDecision;
  scaleAnchor: ScaleAnchorType;
  hasWebXRDepth: boolean;
  simulateHandStill: boolean;
  glareNoiseActive: boolean;
  stillMs: number;
  ringBufferCount: number;
  burstPhotos: CapturedFrame[];
  detectedLabel: string;
  detectedComponentId: number;
  correctionApplied: boolean;
  pipState: PipGuidanceState;
  activeInstruction: string;
  onTapBoundingBox: () => void;
  onTogglePipVisible: () => void;
  onTogglePipExpanded: () => void;
  onGenerateOmniPip: () => void;
  onCaptureBurst: () => void;
}

export const OpticalViewfinder: React.FC<OpticalViewfinderProps> = ({
  videoRef,
  syntheticCanvasRef,
  cameraActive,
  scenario,
  ingestDecision,
  scaleAnchor,
  hasWebXRDepth,
  simulateHandStill,
  glareNoiseActive,
  stillMs,
  ringBufferCount,
  burstPhotos,
  detectedLabel,
  correctionApplied,
  pipState,
  activeInstruction,
  onTapBoundingBox,
  onTogglePipVisible,
  onTogglePipExpanded,
  onGenerateOmniPip,
  onCaptureBurst,
}) => {
  const animPhaseRef = useRef(0);

  // Render deterministic workshop bench canvas when live webcam isn't active
  // (also feeds real pixel frames into the client-side motion detector and 15s ring buffer)
  useEffect(() => {
    if (cameraActive) return undefined;
    const canvas = syntheticCanvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let rafId = 0;
    let lastTick = performance.now();

    const drawFrame = (now: number) => {
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      // When hands are stationary, pause motion phase so the Wasm motion gate sees < 2.2% pixel delta!
      if (!simulateHandStill) {
        animPhaseRef.current += dt * 2.2;
      }
      const t = animPhaseRef.current;

      const w = canvas.width;
      const h = canvas.height;

      // Dark matte optical bench background
      ctx.fillStyle = '#0D1117';
      ctx.fillRect(0, 0, w, h);

      // Subtle millimeter calibration grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.11)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const cx = w * 0.35;
      const cy = h * 0.5;

      // Scenario-specific hardware subject geometry
      if (scenario.id === 'm4_screw') {
        // Brushed steel hinge mounting plate
        ctx.fillStyle = '#1E293B';
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 2;
        ctx.fillRect(cx - 190, cy - 110, 380, 220);
        ctx.strokeRect(cx - 190, cy - 110, 380, 220);

        // Pilot bore holes
        for (const ox of [-130, 130]) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy, 14, 0, Math.PI * 2);
          ctx.fillStyle = '#090D12';
          ctx.fill();
          ctx.strokeStyle = '#94A3B8';
          ctx.stroke();
        }

        // Central M4 machine screw (fine 0.7mm pitch threads + pan socket head)
        const screwOffset = simulateHandStill ? 0 : Math.sin(t * 2.4) * 18;
        ctx.save();
        ctx.translate(cx + screwOffset, cy);
        ctx.fillStyle = '#CBD5E1';
        ctx.fillRect(-16, -24, 32, 68);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        for (let ty = -16; ty <= 36; ty += 7) {
          ctx.beginPath();
          ctx.moveTo(-16, ty);
          ctx.lineTo(16, ty + 3);
          ctx.stroke();
        }
        // Screw head
        ctx.beginPath();
        ctx.arc(0, -34, 28, 0, Math.PI * 2);
        ctx.fillStyle = '#E2E8F0';
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3;
        ctx.stroke();
        // Hex socket recess
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = (Math.PI / 3) * i;
          const px = Math.cos(ang) * 11;
          const py = -34 + Math.sin(ang) * 11;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = '#0F172A';
        ctx.fill();
        ctx.restore();
      } else if (scenario.id === 'under_sink') {
        // Vertical chrome tailpiece & J-bend P-trap
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 42;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, 50);
        ctx.lineTo(cx, cy + 50);
        ctx.arc(cx + 62, cy + 50, 62, Math.PI, 0, true);
        ctx.lineTo(cx + 124, cy - 10);
        ctx.lineTo(cx + 220, cy - 10);
        ctx.stroke();

        // Chrome slip-joint compression nut
        const nutWobble = simulateHandStill ? 0 : Math.sin(t * 2.8) * 10;
        ctx.fillStyle = '#E2E8F0';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 3;
        ctx.fillRect(cx - 34 + nutWobble, cy - 34, 68, 34);
        ctx.strokeRect(cx - 34 + nutWobble, cy - 34, 68, 34);
      } else if (scenario.id === 'cabinet_hinge') {
        // Mounting plate fixed to frame
        ctx.fillStyle = '#334155';
        ctx.fillRect(cx - 170, cy - 30, 120, 60);
        ctx.strokeStyle = '#94A3B8';
        ctx.strokeRect(cx - 170, cy - 30, 120, 60);

        // Articulated 110-deg hinge arm tilted at angle
        const tiltRad = simulateHandStill
          ? -0.26
          : -0.26 + Math.sin(t * 2.1) * 0.14;
        ctx.save();
        ctx.translate(cx - 50, cy);
        ctx.rotate(tiltRad);
        ctx.fillStyle = '#CBD5E1';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.fillRect(0, -22, 190, 44);
        ctx.strokeRect(0, -22, 190, 44);
        // Cam adjustment screws
        ctx.beginPath();
        ctx.arc(64, 0, 10, 0, Math.PI * 2);
        ctx.arc(132, 0, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#1E293B';
        ctx.fill();
        ctx.restore();
      } else {
        // Dishwasher sump basin + clockwise snap-lock retaining clip
        ctx.beginPath();
        ctx.arc(cx, cy, 125, 0, Math.PI * 2);
        ctx.fillStyle = '#1E293B';
        ctx.fill();
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Impeller vanes
        const spin = simulateHandStill ? 0 : t * 1.4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 10;
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.lineTo(78, 12);
          ctx.stroke();
        }
        ctx.restore();

        // Polymer retaining clip with clockwise wear ramp arrow
        ctx.beginPath();
        ctx.arc(cx, cy, 96, -0.6, 0.9);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 14;
        ctx.stroke();
      }

      // Moving hand / tool silhouette when NOT stationary (creates strong pixel delta > 2.2%)
      if (!simulateHandStill) {
        const hx = cx + 125 + Math.cos(t * 3.1) * 95;
        const hy = cy + 48 + Math.sin(t * 2.4) * 65;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(Math.sin(t * 2.8) * 0.5);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.strokeStyle = '#FCD34D';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-56, -24, 156, 48, 14);
        ctx.fill();
        ctx.stroke();
        // Tool shaft
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(-130, -7, 78, 14);
        ctx.restore();
      }

      // Break 2 Physical Scale Anchor graphic drawn into frame when active
      if (scaleAnchor !== 'none' || hasWebXRDepth) {
        const ax = 126;
        const ay = h - 98;
        ctx.save();
        if (scaleAnchor === 'us_quarter') {
          ctx.beginPath();
          ctx.arc(ax, ay, 34, 0, Math.PI * 2);
          ctx.fillStyle = '#CBD5E1';
          ctx.fill();
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = '#0F172A';
          ctx.font = '600 11px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('24.26mm', ax, ay + 4);
        } else if (scaleAnchor === 'credit_card') {
          ctx.fillStyle = '#1E293B';
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 3;
          ctx.fillRect(ax - 54, ay - 32, 108, 64);
          ctx.strokeRect(ax - 54, ay - 32, 108, 64);
          ctx.fillStyle = '#E2E8F0';
          ctx.font = '600 11px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('ISO 85.6mm', ax, ay + 4);
        } else {
          ctx.beginPath();
          ctx.roundRect(ax - 36, ay - 22, 72, 44, 18);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
          ctx.fill();
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.fillStyle = '#A7F3D0';
          ctx.font = '600 11px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(hasWebXRDepth ? 'WebXR DEPTH' : 'THUMB REF', ax, ay + 4);
        }
        ctx.restore();
      }

      // Hardest Input simulation: harsh specular flashlight glare + water droplets
      if (glareNoiseActive) {
        const glare = ctx.createRadialGradient(cx + 24, cy - 16, 8, cx + 24, cy - 16, 195);
        glare.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
        glare.addColorStop(0.35, 'rgba(226, 232, 240, 0.55)');
        glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = glare;
        ctx.fillRect(0, 0, w, h);

        // Lens water droplets
        for (let i = 0; i < 14; i++) {
          const dx = ((i * 97) % (w - 80)) + 40;
          const dy = ((i * 61) % (h - 80)) + 40;
          ctx.beginPath();
          ctx.arc(dx, dy, 10 + (i % 5) * 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Corner optical reticle marks
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
      ctx.lineWidth = 2;
      const m = 22;
      const l = 24;
      // Top-left
      ctx.beginPath(); ctx.moveTo(m, m + l); ctx.lineTo(m, m); ctx.lineTo(m + l, m); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(w - m - l, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + l); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(m, h - m - l); ctx.lineTo(m, h - m); ctx.lineTo(m + l, h - m); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(w - m - l, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - l); ctx.stroke();

      rafId = window.requestAnimationFrame(drawFrame);
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [cameraActive, scenario, scaleAnchor, hasWebXRDepth, simulateHandStill, glareNoiseActive, syntheticCanvasRef]);

  const stillSeconds = (stillMs / 1000).toFixed(1);
  const stillPct = Math.min(100, (stillMs / 3000) * 100);
  const hasScaleLock = hasWebXRDepth || scaleAnchor !== 'none';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#0D1117]">
      {/* Optical Stage */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#0D1117]" data-testid="optical-viewfinder">
        {/* Live Camera Feed (MediaDevices API) */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
        />

        {/* Deterministic Workshop Bench Stream (when camera isn't mounted) */}
        <canvas
          ref={syntheticCanvasRef}
          width={960}
          height={600}
          className={`h-full w-full object-cover ${cameraActive ? 'hidden' : 'block'}`}
          aria-label={`Simulated workbench stream for ${scenario.label}`}
        />

        {/* Top Scrim Telemetry Strip (clean unboxed text, high legibility) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-4 py-3 text-xs text-slate-200">
          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
            <span className="font-semibold text-white">
              {cameraActive ? 'LIVE WEBRTC CAMERA' : 'WORKBENCH STREAM'}
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span>
              {ingestDecision.mode === 'burst_photo_3x'
                ? '3-Shot Burst Mode'
                : `${ingestDecision.targetFps} fps`}
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span>15s Buffer ({ringBufferCount} frames)</span>
          </div>
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span className={hasScaleLock ? 'text-emerald-300' : 'text-amber-300'}>
              {hasScaleLock
                ? `Scale locked (${hasWebXRDepth ? 'WebXR depth' : scaleAnchor.replace('_', ' ')})`
                : 'Scale anchor absent — tool sizes gated'}
            </span>
          </div>
        </div>

        {/* Tappable WebXR Spatial Bounding Box (Test Case 2: Tap to correct M6 -> M4) */}
        <button
          type="button"
          onClick={onTapBoundingBox}
          aria-label={`Inspect or correct detected component ${detectedLabel}`}
          style={{
            left: `${scenario.boundingBox.xPct}%`,
            top: `${scenario.boundingBox.yPct}%`,
            width: `${scenario.boundingBox.wPct}%`,
            height: `${scenario.boundingBox.hPct}%`,
          }}
          className={`group absolute rounded-md border-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
            correctionApplied
              ? 'border-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
              : 'border-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
          }`}
        >
          <span
            className={`absolute -top-8 left-0 inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] font-medium whitespace-nowrap shadow-sm ${
              correctionApplied
                ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-500/50'
                : 'bg-slate-950/90 text-amber-200 border border-amber-400/60'
            }`}
          >
            {correctionApplied ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            <span>{detectedLabel}</span>
            <span className="text-slate-400">· Tap to correct</span>
          </span>
        </button>

        {/* Adaptive Burst Mode Overlay Banner (Test Case 1 & Hardest Input) */}
        {ingestDecision.requiresBurstCapture && (
          <div className="absolute left-4 bottom-4 z-10 max-w-sm rounded-lg border border-amber-400/50 bg-slate-950/90 p-3.5 text-slate-100 backdrop-blur-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-amber-300">
                  Adaptive Degradation Active · 3-Shot Burst Fallback
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {ingestDecision.voicePrompt || ingestDecision.reason}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={onCaptureBurst}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                Capture 3-Shot Burst ({burstPhotos.length}/3)
              </button>
            </div>
          </div>
        )}

        {/* Picture-in-Picture (PiP) Spatial Guidance Overlay — Desktop floating dock */}
        {pipState.visible ? (
          <aside
            aria-label="Picture-in-Picture Repair Guidance"
            className={`hidden sm:block absolute right-3 bottom-3 z-20 overflow-hidden rounded-lg border border-slate-700 bg-[#161B22]/95 text-slate-100 shadow-lg backdrop-blur-xs transition-all ${
              pipState.expanded ? 'w-80' : 'w-60'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100 whitespace-nowrap">
                <Film className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>PiP Motion Guide</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onTogglePipExpanded}
                  aria-label={pipState.expanded ? 'Minimize PiP guidance' : 'Expand PiP guidance'}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  {pipState.expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={onTogglePipVisible}
                  aria-label="Hide PiP guidance"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="p-2.5">
              {pipState.videoUrl ? (
                <video
                  src={pipState.videoUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  className="aspect-video w-full rounded border border-slate-700 bg-black object-cover"
                />
              ) : (
                <div className="relative flex h-24 w-full flex-col items-center justify-center overflow-hidden rounded border border-slate-800 bg-[#0D1117] px-2.5 text-center">
                  <div className="flex items-center gap-1.5 text-amber-400">
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    <span className="font-mono text-[11px] font-medium">
                      {scenario.motionCue.direction.toUpperCase()} · {scenario.motionCue.angleDeg}°
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-slate-200 leading-snug">
                    {scenario.motionCue.actionLabel}
                  </p>
                  {pipState.loading && (
                    <p className="mt-1 font-mono text-[10px] text-amber-300">
                      Rendering 6s clip via gemini-omni-1.2-flash...
                    </p>
                  )}
                </div>
              )}

              <p className="mt-2 text-[11px] leading-relaxed text-slate-300 line-clamp-3">
                {activeInstruction}
              </p>

              {pipState.error && (
                <p role="alert" className="mt-1.5 text-[11px] leading-snug text-rose-300">
                  {pipState.error}
                </p>
              )}

              <button
                type="button"
                disabled={pipState.loading}
                onClick={onGenerateOmniPip}
                className="mt-2 inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
              >
                {pipState.loading ? (
                  <>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Generating PiP Loop...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Generate Omni Flash PiP Video
                  </>
                )}
              </button>
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={onTogglePipVisible}
            className="absolute right-3 bottom-3 z-20 inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Film className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            Show PiP Guide
          </button>
        )}
      </div>

      {/* Mobile Docked PiP Guidance Panel (prevents clipping over small mobile viewports) */}
      {pipState.visible && (
        <div className="block sm:hidden border-t border-slate-800 bg-[#161B22] p-3.5 text-slate-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Film className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>PiP Motion Guide · {scenario.motionCue.angleDeg}°</span>
            </div>
            <button
              type="button"
              onClick={onTogglePipVisible}
              aria-label="Hide mobile PiP guidance"
              className="text-xs text-slate-400 hover:text-white"
            >
              Hide
            </button>
          </div>
          {pipState.videoUrl && (
            <video
              src={pipState.videoUrl}
              autoPlay
              loop
              muted
              playsInline
              controls
              className="mt-2 aspect-video w-full rounded border border-slate-700 bg-black object-cover"
            />
          )}
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{activeInstruction}</p>
          {pipState.error && (
            <p role="alert" className="mt-1.5 text-xs text-rose-300">
              {pipState.error}
            </p>
          )}
          <button
            type="button"
            disabled={pipState.loading}
            onClick={onGenerateOmniPip}
            className="mt-2.5 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {pipState.loading ? 'Generating PiP Loop...' : 'Generate Omni Flash PiP Video'}
          </button>
        </div>
      )}

      {/* Bottom Viewfinder Meter Bar: Wasm Motion Hesitation Gate (Break 1 / Test Case 3) */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 bg-[#11161D] px-4 py-3 text-xs text-slate-300">
        <div className="flex items-center gap-3 min-w-[220px] flex-1">
          <Hand className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="flex-1">
            <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
              <span>Wasm Hesitation Gate (3.0s stillness triggers Decisions API)</span>
              <span className={stillMs >= 3000 ? 'text-amber-300 font-semibold' : 'text-slate-400'}>
                {stillSeconds}s / 3.0s
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-200 ${
                  stillMs >= 3000 ? 'bg-amber-400' : 'bg-sky-500'
                }`}
                style={{ width: `${stillPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Captured 3-Shot Burst Thumbnails when burst fallback ran */}
        {burstPhotos.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-slate-400">Burst Shots:</span>
            {burstPhotos.map((shot, idx) => (
              <img
                key={shot.timestampMs + idx}
                src={shot.dataUrl}
                alt={`High-contrast burst photo ${idx + 1}`}
                className="h-8 w-12 rounded border border-slate-700 object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
