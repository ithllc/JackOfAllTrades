/**
 * Jack of All Trades — Brand Logo Lockup (Jack of Spades Holding a Hammer)
 * License: GNU Affero General Public License v3.0 (AGPL-3.0-only)
 */

import React, { useState } from 'react';

export const JACK_OF_SPADES_LOGO_URL =
  '/src/assets/images/jack_of_spades_logo_1795301467945.jpg';

interface BrandMarkProps {
  compact?: boolean;
  subtitle?: string;
  onClick?: () => void;
  title?: string;
}

/**
 * Renders the Jack of Spades playing-card emblem (with the Jack holding a hammer)
 * paired with the "Jack of All Trades" wordmark. Includes a vector SVG playing-card
 * fallback so the logo never renders a broken image frame.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  compact = false,
  subtitle,
  onClick,
  title,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const innerContent = (
    <>
      <div
        className={`relative shrink-0 overflow-hidden rounded-[5px] bg-[#FAF6EE] border border-white/30 shadow-md shadow-black/50 ${
          compact ? 'h-9 w-[27px]' : 'h-10 w-[30px] sm:h-11 sm:w-[33px]'
        }`}
      >
        {!imgFailed ? (
          <img
            src={JACK_OF_SPADES_LOGO_URL}
            alt="Jack of All Trades logo — Jack of Spades card holding a hammer"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <svg
            viewBox="0 0 60 80"
            role="img"
            aria-label="Jack of All Trades logo — Jack of Spades card holding a hammer"
            className="h-full w-full"
          >
            <rect x="1" y="1" width="58" height="78" rx="5" fill="#FAF6EE" stroke="#111318" strokeWidth="2" />
            <text x="6" y="15" fontSize="12" fontWeight="700" fill="#111318" fontFamily="serif">J</text>
            <path d="M10 19 C7 22, 6 24, 10 25 C14 24, 13 22, 10 19 Z M9 25 L11 25 L11.5 28 L8.5 28 Z" fill="#111318" />
            {/* Stylized Hammer */}
            <rect x="28" y="34" width="4" height="26" rx="1.5" fill="#B5832D" />
            <path d="M21 30 H38 C40 30 42 33 41 36 L37 34 H21 Z" fill="#374151" stroke="#111318" strokeWidth="1.2" />
            {/* Center Spade */}
            <path d="M30 16 C23 23, 21 28, 30 30 C39 28, 37 23, 30 16 Z" fill="#111318" />
            <text x="54" y="69" fontSize="12" fontWeight="700" fill="#111318" fontFamily="serif" textAnchor="end">J</text>
          </svg>
        )}
      </div>

      <div className="flex flex-col min-w-0">
        <span
          className={`font-bold tracking-tight text-white leading-tight whitespace-nowrap ${
            compact ? 'text-[15px] sm:text-base' : 'text-[15px] sm:text-lg'
          }`}
        >
          Jack of All Trades
        </span>
        {subtitle && (
          <span className="text-[11px] sm:text-xs text-neutral-300 leading-tight whitespace-nowrap">
            {subtitle}
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title || 'Jack of All Trades'}
        aria-label={title || 'Jack of All Trades'}
        className="group flex items-center gap-2 sm:gap-2.5 min-w-0 text-left cursor-pointer rounded-lg pr-1.5 py-0.5 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        {innerContent}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
      {innerContent}
    </div>
  );
};
