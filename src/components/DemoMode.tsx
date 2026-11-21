import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Hand } from 'lucide-react';
import {
  DEMO_BATTERY_HOTSPOT,
  DEMO_VIDEO_PLACEHOLDER_URL,
} from '../lib/makerLensState';
import { InstructionSheet } from './InstructionSheet';

interface DemoModeProps {
  /** Called when the user finishes or skips onboarding to switch into Live Camera mode */
  onComplete: () => void;
}

/**
 * Interactive Onboarding Demo (<DemoMode />):
 * Runs on the user's first visit instead of the live camera.
 * Loops a placeholder video of opening a battery compartment (with an automatic
 * animated canvas fallback so the scene always renders smoothly even offline),
 * overlays an interactive AI bounding box and the tooltip:
 *   "Tap the highlighted area to see instructions."
 */
export const DemoMode: React.FC<DemoModeProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Smooth looping animation of a handheld remote's battery compartment (~20 fps for low thermal/CPU load).
  // Pauses cleanly while the instruction sheet is open.
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
        const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
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

        // Handheld device backplate centered in frame
        const bodyW = Math.min(w * 0.62, 340);
        const bodyH = Math.min(h * 0.66, 440);
        const bodyX = (w - bodyW) / 2;
        const bodyY = (h - bodyH) / 2 - 8;

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

        // Recessed battery bay (visible as cover slides smoothly down in a 4.5s loop)
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
        const slideOffset = slideProgress * 30;

        // Dark interior battery tray
        ctx.fillStyle = '#111317';
        ctx.beginPath();
        ctx.roundRect(bayX, bayY, bayW, bayH, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
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

        // Subtle recessed finger dish
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.roundRect(latchX - 10, latchY - 10, latchW + 20, 44, 10);
        ctx.fill();

        // Three grip ridges
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = 'rgba(255,255,255,0.34)';
          ctx.beginPath();
          ctx.roundRect(latchX, latchY + i * 8, latchW, 3.5, 2);
          ctx.fill();
        }

        // Molded downward slide arrow beneath the ridges
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.beginPath();
        ctx.moveTo(w / 2 - 9, latchY + 34);
        ctx.lineTo(w / 2 + 9, latchY + 34);
        ctx.lineTo(w / 2, latchY + 45);
        ctx.closePath();
        ctx.fill();

        // Subtle animated directional guide chevron below the latch
        const pulse = 0.45 + 0.45 * Math.sin(elapsed * 4);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.4 + pulse * 0.45})`;
        ctx.lineWidth = 2.5;
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

      if (!instructionsOpen) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [instructionsOpen]);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black text-white select-none">
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

      {/* Minimal Top Bar: Brand + Skip to Live Camera */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6">
        <div className="flex flex-col">
          <span className="text-lg font-bold tracking-tight text-white">MakerLens</span>
          <span className="text-xs text-neutral-300">Quick Interactive Practice</span>
        </div>

        <button
          type="button"
          onClick={onComplete}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-black/55 border border-white/15 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/15 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          Skip to Camera
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>

      {/* Interactive Mock AI Bounding Box centered tightly over the Battery Latch */}
      <div className="absolute left-1/2 top-[43%] z-20 -translate-x-1/2 w-[196px] sm:w-[220px] h-[138px]">
        {/* Text Tooltip anchored directly above the highlighted bounding box */}
        {!instructionsOpen && (
          <div
            role="note"
            className="pointer-events-none absolute bottom-full left-1/2 mb-4 -translate-x-1/2 w-max max-w-[260px] sm:max-w-xs"
          >
            <div className="relative rounded-2xl bg-neutral-950/90 border border-amber-400/50 px-4 py-2.5 text-center shadow-xl backdrop-blur-md">
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
        )}

        {/* Tappable High-Contrast iOS Focus Bounding Box */}
        <button
          type="button"
          onClick={() => setInstructionsOpen(true)}
          aria-label="Battery Latch — Tap the highlighted area to see instructions"
          className="group relative h-full w-full min-h-[56px] min-w-[56px] rounded-2xl border-2 border-amber-400 bg-amber-400/12 hover:bg-amber-400/22 transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          {/* Precision Camera Corner Reticles */}
          <span className="pointer-events-none absolute -top-0.5 -left-0.5 h-4 w-4 rounded-tl-xl border-t-[3px] border-l-[3px] border-amber-300" aria-hidden="true" />
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 h-4 w-4 rounded-tr-xl border-t-[3px] border-r-[3px] border-amber-300" aria-hidden="true" />
          <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-bl-xl border-b-[3px] border-l-[3px] border-amber-300" aria-hidden="true" />
          <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-br-xl border-b-[3px] border-r-[3px] border-amber-300" aria-hidden="true" />

          {/* Clean bottom label */}
          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-lg bg-black/85 px-2.5 py-1 text-xs font-semibold text-amber-300 whitespace-nowrap shadow-md">
            <Hand className="h-3.5 w-3.5" aria-hidden="true" />
            {DEMO_BATTERY_HOTSPOT.label}
          </span>
        </button>
      </div>

      {/* Bottom Action Area when sheet is closed */}
      {!instructionsOpen && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center px-6 pb-8 sm:pb-10">
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-neutral-950 shadow-xl hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            Start Live Camera
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Step-by-Step Instruction Sheet revealed when user taps the highlighted latch */}
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
};
