import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Info,
  Play,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Square,
  ThumbsUp,
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
  /** Legacy single motion video fallback (kept for compatibility) */
  motionVideoUrl?: string | null;
  loadingMotionVideo?: boolean;
  onRequestMotionVideo?: () => void;
  /** Per-step cached PiP video URLs keyed by 1-based step number */
  stepVideos?: Record<number, string>;
  /** 1-based step currently generating a PiP motion clip */
  loadingStepVideo?: number | null;
  /** On-demand PiP clip generator for a specific step */
  onRequestStepMotionVideo?: (stepNumber: number, prompt: string) => void;
  /** 1-based step currently active (highlighted in sheet & synced to AR overlay) */
  activeStepNumber?: number | null;
  /** Completed 1-based step numbers */
  completedSteps?: number[];
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
  /** Read a single step aloud in live camera mode */
  onReadStepAloud?: (stepNumber: number) => void;
  /** Select / advance to a specific step */
  onSelectStep?: (stepNumber: number) => void;
  /** Collapse sheet to inspect the live AR overlay clearly */
  onViewOverlay?: () => void;
  /** Scale Anchor enforcement actions (Live Camera mode) */
  onRescanWithAnchor?: () => void;
  onOptOutScale?: () => void;
  onReenableScale?: () => void;
  /** End-user self-learning Cloud SQL feedback controls */
  fixConfirmed?: boolean;
  confirmingFix?: boolean;
  onConfirmFix?: () => void;
  correctionSaved?: boolean;
  submittingCorrection?: boolean;
  onSubmitCorrection?: (correctedName: string, tag: string) => void;
}

/**
 * Accessible iOS-style bottom sheet presenting plain-English, multi-step repair
 * instructions for BOTH Scan Problem and Hold to Explain flows, with:
 * - Compact viewport height + "View AR Overlay" peek button so the AR overlay is always accessible
 * - Multi-step stepper (Prev / Next / tap any step) synced to the live AR reticle
 * - On-demand per-step PiP motion video generation & caching ("Show Step N Motion")
 * - Real-time Scale Anchor millimeter comparison confirmation or opt-out guidance
 * - End-user Self-Learning Cloud SQL controls ("Done — This Fixed It!" & "Wrong Part or Size?")
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
  stepVideos = {},
  loadingStepVideo = null,
  onRequestStepMotionVideo,
  activeStepNumber = 1,
  completedSteps = [],
  isSpeaking = false,
  isAudioMuted = false,
  onToggleAudio,
  hasAudio = false,
  onReplayAudio,
  onStopAudio,
  onReadStepAloud,
  onSelectStep,
  onViewOverlay,
  onRescanWithAnchor,
  onOptOutScale,
  onReenableScale,
  fixConfirmed = false,
  confirmingFix = false,
  onConfirmFix,
  correctionSaved = false,
  submittingCorrection = false,
  onSubmitCorrection,
}) => {
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctedPartInput, setCorrectedPartInput] = useState('');
  const [correctionTag, setCorrectionTag] = useState('Wrong Part Name');

  const scaleCal = !isDemo ? hotspot.scaleCalibration : null;
  const totalSteps = Math.max(1, hotspot.steps.length);
  const currentStep = Math.min(Math.max(activeStepNumber ?? 1, 1), totalSteps);
  const activeStepObj =
    hotspot.steps.find((s) => s.number === currentStep) ?? hotspot.steps[0];

  const activeVideoUrl = stepVideos[currentStep] || motionVideoUrl || null;
  const isGeneratingActiveStepVideo =
    loadingStepVideo === currentStep || loadingMotionVideo;

  const activeStepTool = activeStepObj?.toolNeeded || hotspot.toolNeeded;

  const handleRequestCurrentStepVideo = () => {
    if (onRequestStepMotionVideo && activeStepObj) {
      const prompt =
        activeStepObj.pipMotionPrompt ||
        hotspot.motionPrompt ||
        `Close-up steady hands demonstrating Step ${currentStep} on ${hotspot.label}: ${activeStepObj.title}. ${activeStepObj.detail}`;
      onRequestStepMotionVideo(currentStep, prompt);
    } else if (onRequestMotionVideo) {
      onRequestMotionVideo();
    }
  };

  const handleSubmitCorrectionForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = correctedPartInput.trim();
    if (!trimmed || !onSubmitCorrection) return;
    onSubmitCorrection(trimmed, correctionTag);
    setShowCorrectionForm(false);
    setCorrectedPartInput('');
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-6 sm:pb-5 pointer-events-none"
      role="dialog"
      aria-modal="false"
      aria-labelledby="instruction-sheet-title"
    >
      <div className="pointer-events-auto w-full max-w-lg rounded-3xl bg-neutral-950/95 border border-white/15 text-white shadow-2xl backdrop-blur-2xl overflow-hidden">
        {/* Drag handle affordance */}
        <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <div className="px-5 pt-1.5 pb-5 sm:px-6 sm:pb-6 max-h-[56dvh] sm:max-h-[60dvh] overflow-y-auto">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-400">
                {isDemo
                  ? isSpeaking && activeStepNumber
                    ? `Interactive Demo · Speaking Step ${activeStepNumber} of ${totalSteps}`
                    : 'Interactive Demo · Step-by-Step Guide'
                  : hotspot.sourceMode === 'voice'
                    ? `Voice Repair Guide${hotspot.spokenLanguage ? ` · ${hotspot.spokenLanguage}` : ''} · Step ${currentStep} of ${totalSteps}`
                    : `AI Repair Guide · Step ${currentStep} of ${totalSteps}`}
              </p>
              <h2
                id="instruction-sheet-title"
                className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-white text-balance"
              >
                {hotspot.label}
              </h2>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isDemo && onViewOverlay && (
                <button
                  type="button"
                  onClick={onViewOverlay}
                  aria-label="Collapse guide to view full AR camera overlay"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/25 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>View AR</span>
                </button>
              )}

              {isDemo && onToggleAudio && (
                <button
                  type="button"
                  onClick={onToggleAudio}
                  aria-label={isAudioMuted ? 'Unmute guided demo voice' : 'Mute guided demo voice'}
                  aria-pressed={!isAudioMuted}
                  className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
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
                  className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
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
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
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
                    {scaleCal.estimatedPartSizeMm ? ` · ~${scaleCal.estimatedPartSizeMm} mm part` : ''}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-emerald-100/90">
                    {scaleCal.scaleMeasurementNote || scaleCal.bannerText}
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
                        className="inline-flex min-h-[36px] items-center justify-center rounded-full bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-amber-300 transition-colors cursor-pointer"
                      >
                        Re-Scan with Object
                      </button>
                    )}
                    {onOptOutScale && (
                      <button
                        type="button"
                        onClick={onOptOutScale}
                        className="inline-flex min-h-[36px] items-center justify-center rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer"
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

          {/* Plain-language tool line */}
          <div className="mt-3 flex items-center gap-2 border-y border-white/10 py-2 text-xs text-neutral-300">
            <Wrench className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span>
              What you need: <strong className="font-semibold text-white">{activeStepTool}</strong>
            </span>
          </div>

          {/* Active Step Cached PiP Motion Loop */}
          {activeVideoUrl && (
            <div className="mt-3.5 overflow-hidden rounded-2xl border border-amber-400/35 bg-black">
              <div className="flex items-center justify-between bg-neutral-900/90 px-3 py-1.5 text-[11px] font-medium text-amber-300">
                <span>Step {currentStep} Hand-Motion Loop</span>
                {!isDemo && onViewOverlay && (
                  <button
                    type="button"
                    onClick={onViewOverlay}
                    className="text-neutral-300 underline underline-offset-2 hover:text-white cursor-pointer"
                  >
                    Pin over camera
                  </button>
                )}
              </div>
              <video
                key={activeVideoUrl}
                src={activeVideoUrl}
                autoPlay
                loop
                muted
                playsInline
                className="aspect-video w-full object-cover"
              />
            </div>
          )}

          {/* Multi-Step Stepper Navigation (Live Mode) */}
          {!isDemo && totalSteps > 1 && onSelectStep && (
            <div className="mt-3.5 flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <button
                type="button"
                onClick={() => onSelectStep(Math.max(1, currentStep - 1))}
                disabled={currentStep <= 1}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-35 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Prev
              </button>

              <span className="font-mono text-xs font-semibold text-amber-300 tabular-nums">
                Step {currentStep} of {totalSteps}
              </span>

              <button
                type="button"
                onClick={() => onSelectStep(Math.min(totalSteps, currentStep + 1))}
                disabled={currentStep >= totalSteps}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-400/30 disabled:opacity-35 cursor-pointer"
              >
                Next Step
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Numbered Steps — Synchronized with AR Overlay, Audio & Per-Step PiP */}
          <ol className="mt-3.5 space-y-2">
            {hotspot.steps.map((step) => {
              const isActive = currentStep === step.number;
              const isCompleted =
                completedSteps.includes(step.number) ||
                (isDemo && activeStepNumber !== null && step.number < activeStepNumber);
              const hasCachedStepVideo = Boolean(stepVideos[step.number]);

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
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasCachedStepVideo && (
                          <span className="text-[10px] font-medium text-emerald-300">
                            Clip Ready
                          </span>
                        )}
                        {isActive && isSpeaking && !isAudioMuted && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 whitespace-nowrap">
                            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Speaking
                          </span>
                        )}
                      </div>
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
                      aria-label={`Select step ${step.number}: ${step.title}`}
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

          {/* Per-Step Action Strip: Show Step N Motion (PiP) + Read Step Aloud */}
          {!isDemo && (onRequestStepMotionVideo || onRequestMotionVideo || onReadStepAloud) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(onRequestStepMotionVideo || onRequestMotionVideo) && !activeVideoUrl && (
                <button
                  type="button"
                  onClick={handleRequestCurrentStepVideo}
                  disabled={isGeneratingActiveStepVideo}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border border-amber-400/45 bg-amber-400/15 px-4 py-2 text-xs sm:text-sm font-semibold text-amber-200 hover:bg-amber-400/25 transition-colors disabled:opacity-60 whitespace-nowrap cursor-pointer"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {isGeneratingActiveStepVideo
                    ? `Creating Step ${currentStep} clip...`
                    : totalSteps > 1
                      ? `Show Step ${currentStep} Motion`
                      : 'Show Me How (PiP)'}
                </button>
              )}

              {onReadStepAloud && (
                <button
                  type="button"
                  onClick={() => onReadStepAloud(currentStep)}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/15 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                  Read Step {currentStep}
                </button>
              )}
            </div>
          )}

          {/* Self-Learning Ontology Controls (Live Mode -> Writes to Cloud SQL) */}
          {!isDemo && (onConfirmFix || onSubmitCorrection) && (
            <div className="mt-4 rounded-2xl border border-white/12 bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {onConfirmFix && (
                  <button
                    type="button"
                    onClick={onConfirmFix}
                    disabled={fixConfirmed || confirmingFix}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      fixConfirmed
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                        : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400'
                    }`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                    {fixConfirmed
                      ? 'Saved — This Fixed It!'
                      : confirmingFix
                        ? 'Saving...'
                        : 'Done — This Fixed It!'}
                  </button>
                )}

                {onSubmitCorrection && (
                  <button
                    type="button"
                    onClick={() => setShowCorrectionForm((prev) => !prev)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    <Flag className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                    {correctionSaved ? 'Correction Saved' : 'Wrong Part or Size?'}
                  </button>
                )}
              </div>

              {fixConfirmed && (
                <p className="mt-2 text-[11px] text-emerald-200/90">
                  Logged to the repair ontology so future repairs on this part get even faster.
                </p>
              )}

              {correctionSaved && !showCorrectionForm && (
                <p className="mt-2 text-[11px] text-amber-200/90">
                  Thank you — your correction updated the Cloud SQL ontology embedding.
                </p>
              )}

              {showCorrectionForm && onSubmitCorrection && (
                <form onSubmit={handleSubmitCorrectionForm} className="mt-3 space-y-2.5 border-t border-white/10 pt-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-neutral-300">
                      What is this part or exact size actually called?
                    </span>
                    <input
                      type="text"
                      value={correctedPartInput}
                      onChange={(e) => setCorrectedPartInput(e.target.value)}
                      placeholder="e.g., M4 Hex Bolt (7mm head) or 1/2-inch P-Trap Nut"
                      className="mt-1 w-full rounded-xl border border-white/20 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-neutral-500 focus:border-amber-400 focus:outline-none"
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <select
                      value={correctionTag}
                      onChange={(e) => setCorrectionTag(e.target.value)}
                      aria-label="Correction reason"
                      className="rounded-lg border border-white/20 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200"
                    >
                      <option value="Wrong Part Name">Wrong Part Name</option>
                      <option value="Wrong Tool Size">Wrong Tool Size</option>
                      <option value="Missing Step">Missing Step</option>
                    </select>

                    <button
                      type="submit"
                      disabled={!correctedPartInput.trim() || submittingCorrection}
                      className="inline-flex min-h-[34px] items-center rounded-full bg-amber-400 px-4 py-1 text-xs font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-50 cursor-pointer"
                    >
                      {submittingCorrection ? 'Saving...' : 'Teach Ontology'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Bottom Primary Action */}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={onPrimaryAction}
              className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-neutral-950 shadow-lg hover:bg-neutral-100 active:scale-[0.98] transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 cursor-pointer"
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
