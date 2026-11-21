import React from 'react';
import { CheckCircle2, Play, RotateCcw, Wrench, X } from 'lucide-react';
import type { HighlightHotspot } from '../lib/makerLensState';

interface InstructionSheetProps {
  hotspot: HighlightHotspot;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onClose: () => void;
  isDemo?: boolean;
  motionVideoUrl?: string | null;
  loadingMotionVideo?: boolean;
  onRequestMotionVideo?: () => void;
}

/**
 * Accessible iOS-style bottom sheet presenting plain-English, step-by-step
 * repair instructions once the user taps a highlighted area.
 */
export const InstructionSheet: React.FC<InstructionSheetProps> = ({
  hotspot,
  primaryActionLabel,
  onPrimaryAction,
  onClose,
  isDemo = false,
  motionVideoUrl,
  loadingMotionVideo = false,
  onRequestMotionVideo,
}) => {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-6 sm:pb-6 pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="instruction-sheet-title"
    >
      <div className="pointer-events-auto w-full max-w-lg rounded-3xl bg-neutral-950/95 border border-white/15 text-white shadow-2xl backdrop-blur-2xl overflow-hidden">
        {/* Drag handle affordance */}
        <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <div className="px-5 pt-2 pb-5 sm:px-6 sm:pb-6 max-h-[75dvh] overflow-y-auto">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-amber-400">
                {isDemo ? 'Guided Practice · Step-by-Step' : 'Repair Guide'}
              </p>
              <h2
                id="instruction-sheet-title"
                className="mt-0.5 text-xl font-bold tracking-tight text-white text-balance"
              >
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

          <p className="mt-2.5 text-sm leading-relaxed text-neutral-200">
            {hotspot.summary}
          </p>

          {/* Plain-language tool line (no pill clutter) */}
          <div className="mt-3.5 flex items-center gap-2 border-y border-white/10 py-2.5 text-xs text-neutral-300">
            <Wrench className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              What you need: <strong className="font-semibold text-white">{hotspot.toolNeeded}</strong>
            </span>
          </div>

          {/* Optional visual motion loop preview */}
          {motionVideoUrl && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                src={motionVideoUrl}
                autoPlay
                loop
                muted
                playsInline
                className="aspect-video w-full object-cover"
              />
            </div>
          )}

          {/* Numbered Steps */}
          <ol className="mt-4 space-y-3.5">
            {hotspot.steps.map((step) => (
              <li key={step.number} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-neutral-950 tabular-nums">
                  {step.number}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-300">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* Bottom Actions */}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            {!isDemo && onRequestMotionVideo && !motionVideoUrl && (
              <button
                type="button"
                onClick={onRequestMotionVideo}
                disabled={loadingMotionVideo}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/15 transition-colors disabled:opacity-60 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {loadingMotionVideo ? 'Creating visual clip...' : 'Show Me How'}
              </button>
            )}

            <button
              type="button"
              onClick={onPrimaryAction}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-neutral-950 shadow-lg hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
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
};
