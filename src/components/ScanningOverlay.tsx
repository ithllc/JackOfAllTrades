import React, { useEffect, useState } from 'react';
import { getScanningMessage } from '../lib/makerLensState';

interface ScanningOverlayProps {
  /** Optional custom status line; defaults to cycling human-readable repair phrases */
  customMessage?: string;
}

/**
 * Clear, non-technical scanning state:
 * Softly blurs the live camera viewfinder behind a crisp iOS-style translucent card
 * with a clean spinner and friendly status copy ("Analyzing the threads...").
 */
export const ScanningOverlay: React.FC<ScanningOverlayProps> = ({ customMessage }) => {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (customMessage) return undefined;
    const timer = window.setInterval(() => {
      setMessageIndex((prev) => prev + 1);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [customMessage]);

  const activeMessage = customMessage || getScanningMessage(messageIndex);

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/50 backdrop-blur-xl px-6 transition-opacity duration-200"
    >
      <div className="flex flex-col items-center rounded-3xl bg-neutral-900/85 border border-white/15 px-8 py-7 text-center shadow-2xl max-w-xs w-full">
        {/* High-contrast accessible ring spinner */}
        <div className="relative h-12 w-12" aria-hidden="true">
          <span className="absolute inset-0 rounded-full border-[3px] border-white/15" />
          <span className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-amber-400 animate-spin" />
        </div>

        <p className="mt-5 text-base font-semibold tracking-tight text-white">
          {activeMessage}
        </p>
        <p className="mt-1.5 text-xs text-neutral-300 leading-relaxed">
          Hold your camera steady for just a moment.
        </p>
      </div>
    </div>
  );
};
