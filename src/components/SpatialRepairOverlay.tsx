import React from 'react';
import { Expand, Ruler, X } from 'lucide-react';
import type { HighlightHotspot, RepairStep } from '../lib/makerLensState';
import type { RepairMotionCue } from '../lib/ontologyMapper';

interface SpatialRepairOverlayProps {
  hotspot: HighlightHotspot;
  currentStepNumber: number;
  sheetOpen: boolean;
  activeStepVideoUrl?: string | null;
  onOpenSheet: () => void;
  onCloseMiniPip?: () => void;
}

const MOTION_CUE_LABELS: Record<RepairMotionCue, string> = {
  rotate_cw: 'Turn Clockwise',
  rotate_ccw: 'Turn Counter-Clockwise',
  slide: 'Slide Smoothly',
  lift: 'Lift Upward',
  press: 'Press Inward',
  align: 'Align Here',
  inspect: 'Inspect Area',
};

const MotionCueGraphic: React.FC<{ cue: RepairMotionCue }> = ({ cue }) => {
  switch (cue) {
    case 'rotate_cw':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <path
            d="M32 10 A22 22 0 1 1 13 43"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray="6 4"
          />
          <polygon points="32,3 44,12 31,19" fill="currentColor" />
          <circle cx="32" cy="32" r="4" fill="currentColor" />
        </svg>
      );
    case 'rotate_ccw':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <path
            d="M32 10 A22 22 0 1 0 51 43"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray="6 4"
          />
          <polygon points="32,3 20,12 33,19" fill="currentColor" />
          <circle cx="32" cy="32" r="4" fill="currentColor" />
        </svg>
      );
    case 'slide':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] animate-pulse"
          aria-hidden="true"
        >
          <line x1="12" y1="32" x2="46" y2="32" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
          <polyline
            points="36,20 50,32 36,44"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="22,22 32,32 22,42"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.65"
          />
        </svg>
      );
    case 'lift':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] animate-bounce"
          aria-hidden="true"
        >
          <line x1="32" y1="50" x2="32" y2="18" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
          <polyline
            points="18,28 32,14 46,28"
            fill="none"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'press':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] animate-pulse"
          aria-hidden="true"
        >
          <circle cx="32" cy="36" r="16" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.65" />
          <circle cx="32" cy="36" r="8" fill="none" stroke="currentColor" strokeWidth="3.5" />
          <line x1="32" y1="8" x2="32" y2="28" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <polyline
            points="24,20 32,29 40,20"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'align':
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-12 w-12 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="5 4" />
          <line x1="32" y1="8" x2="32" y2="22" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="32" y1="42" x2="32" y2="56" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="8" y1="32" x2="22" y2="32" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="42" y1="32" x2="56" y2="32" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="32" cy="32" r="3.5" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 64 64"
          className="h-11 w-11 text-amber-300 drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <circle cx="29" cy="29" r="15" fill="none" stroke="currentColor" strokeWidth="3.5" />
          <line x1="40" y1="40" x2="53" y2="53" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      );
  }
};

/**
 * Live AR Spatial Repair Overlay rendered directly over the Magic Window camera feed.
 * Shows the active step's bounding reticle, animated directional motion cue, verified
 * scale-anchor reference box, and an optional floating corner Mini-PiP loop when the
 * bottom instruction sheet is collapsed.
 */
export const SpatialRepairOverlay: React.FC<SpatialRepairOverlayProps> = ({
  hotspot,
  currentStepNumber,
  sheetOpen,
  activeStepVideoUrl,
  onOpenSheet,
  onCloseMiniPip,
}) => {
  const totalSteps = Math.max(1, hotspot.steps.length);
  const activeStep: RepairStep | undefined =
    hotspot.steps.find((s) => s.number === currentStepNumber) ?? hotspot.steps[0];

  const targetBox = activeStep?.targetBox ?? {
    xPct: hotspot.xPct,
    yPct: hotspot.yPct,
    wPct: hotspot.wPct,
    hPct: hotspot.hPct,
  };

  // When the bottom instruction sheet is expanded, shift very low targets upward
  // slightly in visual presentation only if needed so the AR reticle stays visible above the sheet.
  const clampedTopPct = sheetOpen ? Math.min(targetBox.yPct, 22) : targetBox.yPct;
  const activeCue: RepairMotionCue = activeStep?.motionCue ?? hotspot.motionCue ?? 'inspect';
  const anchorBox = hotspot.anchorBox ?? hotspot.scaleCalibration?.anchorBox ?? null;
  const scaleCal = hotspot.scaleCalibration;

  return (
    <div
      data-testid="spatial-repair-overlay"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      {/* Verified Scale Anchor Reference Box (Emerald dashed outline) */}
      {anchorBox && scaleCal?.status === 'calibrated' && (
        <div
          data-testid="scale-anchor-box"
          className="absolute rounded-xl border-2 border-dashed border-emerald-400/90 bg-emerald-400/10 shadow-[0_0_24px_rgba(16,185,129,0.28)] transition-all duration-300"
          style={{
            left: `${anchorBox.xPct}%`,
            top: `${anchorBox.yPct}%`,
            width: `${anchorBox.wPct}%`,
            height: `${anchorBox.hPct}%`,
          }}
        >
          <span
            className={`absolute -top-7 inline-flex items-center gap-1 rounded-md bg-emerald-950/90 border border-emerald-400/50 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 whitespace-nowrap shadow-lg ${
              anchorBox.xPct > 45 ? 'right-0' : 'left-0'
            }`}
          >
            <Ruler className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
            <span>
              Scale: {scaleCal.referenceDimensionMm ? `${scaleCal.referenceDimensionMm} mm` : scaleCal.detectedObjectLabel}
            </span>
          </span>
        </div>
      )}

      {/* Active Step Target AR Reticle + Animated Directional Motion Cue */}
      <div
        data-testid="ar-target-reticle"
        className="pointer-events-auto absolute transition-all duration-300"
        style={{
          left: `${targetBox.xPct}%`,
          top: `${clampedTopPct}%`,
          width: `${targetBox.wPct}%`,
          height: `${targetBox.hPct}%`,
        }}
      >
        <button
          type="button"
          onClick={onOpenSheet}
          aria-label={`Step ${currentStepNumber} of ${totalSteps}: ${activeStep?.title || hotspot.label}. Tap to open repair guide.`}
          className="group relative flex h-full w-full min-h-[84px] min-w-[110px] items-center justify-center rounded-2xl border-2 border-amber-400/90 bg-amber-400/12 shadow-[0_0_32px_rgba(251,191,36,0.28)] hover:bg-amber-400/20 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          {/* Corner Brackets for Tactical AR Precision */}
          <span className="pointer-events-none absolute -top-1 -left-1 h-4 w-4 rounded-tl-md border-t-[3px] border-l-[3px] border-amber-300" />
          <span className="pointer-events-none absolute -top-1 -right-1 h-4 w-4 rounded-tr-md border-t-[3px] border-r-[3px] border-amber-300" />
          <span className="pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 rounded-bl-md border-b-[3px] border-l-[3px] border-amber-300" />
          <span className="pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 rounded-br-md border-b-[3px] border-r-[3px] border-amber-300" />

          {/* Top Floating AR Label */}
          <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-lg bg-neutral-950/90 border border-amber-400/50 px-3 py-1 text-xs font-semibold text-amber-200 whitespace-nowrap shadow-xl">
            <span className="font-mono text-amber-400 tabular-nums">
              Step {currentStepNumber}/{totalSteps}
            </span>
            <span className="text-white/40">·</span>
            <span className="text-white max-w-[180px] truncate">{hotspot.label}</span>
          </span>

          {/* Animated Directional Motion Cue */}
          <MotionCueGraphic cue={activeCue} />

          {/* Bottom Motion Action Cue Tag */}
          <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-md bg-neutral-950/90 border border-white/15 px-2.5 py-0.5 text-[11px] font-medium text-neutral-100 whitespace-nowrap shadow-lg">
            {MOTION_CUE_LABELS[activeCue]}
            {scaleCal?.estimatedPartSizeMm ? ` · ~${scaleCal.estimatedPartSizeMm} mm` : ''}
          </span>
        </button>
      </div>

      {/* Floating Corner Mini-PiP Window (visible when sheet is collapsed & step video exists) */}
      {!sheetOpen && activeStepVideoUrl && (
        <div
          data-testid="floating-mini-pip"
          className="pointer-events-auto absolute top-20 right-4 sm:right-8 z-30 w-44 sm:w-56 overflow-hidden rounded-2xl border border-amber-400/50 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-1.5">
            <span className="text-[11px] font-semibold text-amber-300 truncate">
              Step {currentStepNumber} Motion
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onOpenSheet}
                aria-label="Expand repair instructions"
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 hover:bg-white/15 hover:text-white cursor-pointer"
              >
                <Expand className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {onCloseMiniPip && (
                <button
                  type="button"
                  onClick={onCloseMiniPip}
                  aria-label="Hide motion preview"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-300 hover:bg-white/15 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <video
            src={activeStepVideoUrl}
            autoPlay
            loop
            muted
            playsInline
            className="aspect-video w-full bg-black object-cover"
          />
        </div>
      )}
    </div>
  );
};
