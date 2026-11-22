import React from 'react';
import {
  CheckCircle2,
  Info,
  Play,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Square,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
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
  /** Optional 1-based step currently being narrated aloud so text & voice stay in sync */
  activeStepNumber?: number | null;
  /** Whether voice guidance is actively speaking */
  isSpeaking?: boolean;
  /** Whether guided demo voice narration is muted */
  isAudioMuted?: boolean;
  /** Toggle guided demo voice narration on/off */
  onToggleAudio?: () => void;
  /** Live-mode audio playback controls */
  hasAudio?: boolean;
  onReplayAudio?: () => void;
  onStopAudio?: () => void;
  /** Replay or jump narration to a specific step when tapped */
  onSelectStep?: (stepNumber: number) => void;
  /** Scale Anchor enforcement actions (Live Camera mode) */
  onRescanWithAnchor?: () => void;
  onOptOutScale?: () => void;
  onReenableScale?: () => void;
}

/**
 * Accessible iOS-style bottom sheet presenting plain-English, step-by-step
 * repair instructions for BOTH Scan Problem and Hold to Explain flows,
 * including real-time Scale Anchor calibration confirmation or opt-out guidance.
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
  activeStepNumber = null,
  isSpeaking = false,
  isAudioMuted = false,
  onToggleAudio,
  hasAudio = false,
  onReplayAudio,
  onStopAudio,
  onSelectStep,
  onRescanWithAnchor,
  onOptOutScale,
  onReenableScale,
}) => {
  const scaleCal = !isDemo ? hotspot.scaleCalibration : null;

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-400">
                {isDemo
                  ? isSpeaking && activeStepNumber
                    ? `Interactive Demo · Speaking Step ${activeStepNumber} of ${hotspot.steps.length}`
                    : 'Interactive Demo · Step-by-Step Guide'
                  : hotspot.sourceMode === 'voice'
                    ? `Voice Repair Guide${hotspot.spokenLanguage ? ` · ${hotspot.spokenLanguage}` : ''}`
                    : 'AI Repair Guide'}
              </p>
              <h2
                id="instruction-sheet-title"
                className="mt-0.5 text-xl font-bold tracking-tight text-white text-balance"
              >
                {hotspot.label}
              </h2>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isDemo && onToggleAudio && (
                <button
                  type="button"
                  onClick={onToggleAudio}
                  aria-label={isAudioMuted ? 'Unmute guided demo voice' : 'Mute guided demo voice'}
                  aria-pressed={!isAudioMuted}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                    isAudioMuted
                      ? 'bg-white/10 text-neutral-400 hover:bg-white/20 hover:text-white'
                      : 'bg-amber-400/20 text-amber-300 border border-amber-400/40 hover:bg-amber-400/30'
                  }`}
                >
                  {isAudioMuted ? (
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}

              {!isDemo && hasAudio && (onReplayAudio || onStopAudio) && (
                <button
                  type="button"
                  onClick={() => (isSpeaking ? onStopAudio?.() : onReplayAudio?.())}
                  aria-label={isSpeaking ? 'Stop spoken repair guidance' : 'Replay spoken repair guidance'}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                    isSpeaking
                      ? 'bg-amber-400 text-neutral-950 animate-pulse'
                      : 'bg-white/10 text-amber-300 border border-amber-400/35 hover:bg-white/20'
                  }`}
                >
                  {isSpeaking ? (
                    <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close instructions"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {hotspot.userTranscript && (
            <p className="mt-2 rounded-xl bg-white/6 px-3 py-2 text-xs text-neutral-300 italic">
              You asked: “{hotspot.userTranscript}”
            </p>
          )}

          {/* Scale Anchor Calibration Status Banner (Enforced across Scan & Hold-to-Explain) */}
          {scaleCal && scaleCal.status === 'calibrated' && (
            <div
              role="status"
              className="mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/12 px-3.5 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-300">
                    {scaleCal.bannerTitle}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-emerald-100/90">
                    {scaleCal.bannerText}
                  </p>
                </div>
              </div>
            </div>
          )}

          {scaleCal && scaleCal.status === 'needs_anchor' && (
            <div
              role="status"
              className="mt-3 rounded-2xl border border-amber-400/45 bg-amber-400/12 px-3.5 py-3"
            >
              <div className="flex items-start gap-2.5">
                <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-300">
                    {scaleCal.bannerTitle}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-100/90">
                    {scaleCal.bannerText}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {onRescanWithAnchor && (
                      <button
                        type="button"
                        onClick={onRescanWithAnchor}
                        className="inline-flex min-h-[38px] items-center justify-center rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-amber-300 transition-colors cursor-pointer"
                      >
                        Re-Scan with Object
                      </button>
                    )}
                    {onOptOutScale && (
                      <button
                        type="button"
                        onClick={onOptOutScale}
                        className="inline-flex min-h-[38px] items-center justify-center rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer"
                      >
                        Continue Without Scaling
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {scaleCal && scaleCal.status === 'opted_out' && (
            <div
              role="note"
              className="mt-3 rounded-2xl border border-white/20 bg-white/8 px-3.5 py-3"
            >
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">
                    {scaleCal.bannerTitle} — Why Using a Scale Object Matters
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-200">
                    {scaleCal.whyScaleMatters}
                  </p>
                  {onReenableScale && (
                    <button
                      type="button"
                      onClick={onReenableScale}
                      className="mt-2 text-xs font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200 cursor-pointer"
                    >
                      Use a quarter, credit card, or thumb instead
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="mt-3 text-sm leading-relaxed text-neutral-200">
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

          {/* Numbered Steps — Synchronized with Guided Audio */}
          <ol className="mt-4 space-y-2.5">
            {hotspot.steps.map((step) => {
              const isActive = activeStepNumber === step.number;
              const isCompleted =
                activeStepNumber !== null && step.number < activeStepNumber;

              const rowClasses = `flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ${
                isActive
                  ? 'bg-amber-400/14 border border-amber-400/60 shadow-sm'
                  : 'border border-transparent hover:bg-white/5'
              }`;

              const content = (
                <>
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums transition-colors ${
                      isActive
                        ? 'bg-amber-400 text-neutral-950'
                        : isCompleted
                          ? 'bg-emerald-400/90 text-neutral-950'
                          : 'bg-white/15 text-white'
                    }`}
                  >
                    {step.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`text-sm font-semibold ${
                          isActive ? 'text-amber-200' : 'text-white'
                        }`}
                      >
                        {step.title}
                      </p>
                      {isActive && isSpeaking && !isAudioMuted && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 whitespace-nowrap shrink-0">
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Speaking
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 text-xs leading-relaxed ${
                        isActive ? 'text-neutral-100' : 'text-neutral-300'
                      }`}
                    >
                      {step.detail}
                    </p>
                  </div>
                </>
              );

              return (
                <li key={step.number}>
                  {onSelectStep ? (
                    <button
                      type="button"
                      onClick={() => onSelectStep(step.number)}
                      aria-current={isActive ? 'step' : undefined}
                      aria-label={`Play audio for step ${step.number}: ${step.title}`}
                      className={`${rowClasses} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={rowClasses}>{content}</div>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Bottom Actions */}
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
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
