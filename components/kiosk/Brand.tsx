/* -------------------------------------------------------------------------
   Innovation City brand elements for the kiosk.

   Assets (public/brand/):
     ic-mark.png            the gradient circle mark, transparent cut-out
     ic-wordmark-white.png  "INNOVATION CITY" in white, for dark screens
   These were extracted from a small logo image -- replace them with the
   official SVG/white versions from the brand team when you have them
   (same file names, or update the paths below).

   The mark on the welcome screen and the circle of the countdown share the
   view-transition name "ic-mark": when the countdown ends, the browser
   flies that circle up and grows it into the welcome logo (see
   finishVisit() in page.tsx and ::view-transition-* in globals.css).
   ------------------------------------------------------------------------- */
import type { CSSProperties } from "react";

export const MARK_SRC = "/brand/ic-mark.png";
export const WORDMARK_SRC = "/brand/ic-wordmark-white.png";
export const TAGLINE = "The Free zone of the future";

const MARK_TRANSITION = { viewTransitionName: "ic-mark" } as CSSProperties;
const WORDMARK_TRANSITION = { viewTransitionName: "ic-wordmark" } as CSSProperties;

/** Big logo + tagline on the welcome / check-in screen. */
export function BrandHero() {
  return (
    <div className="brand-hero">
      <img alt="" className="brand-hero-mark" src={MARK_SRC} style={MARK_TRANSITION} />
      <img alt="Innovation City" className="brand-hero-wordmark" src={WORDMARK_SRC} style={WORDMARK_TRANSITION} />
      <span className="brand-tagline">{TAGLINE}</span>
    </div>
  );
}

/**
 * Small logo centred in the header, between weather and time. Its mark and
 * wordmark share names with the welcome logo, so moving past the welcome
 * screen glides the big logo up into this one (and back on reset).
 * `morphMark` is off while the logo countdown is showing -- its circle
 * owns the "ic-mark" name then, and names must be unique on the page.
 */
export function HeaderBrand({ morphMark = true }: { morphMark?: boolean }) {
  return (
    <div className="header-brand">
      <img alt="" src={MARK_SRC} style={morphMark ? MARK_TRANSITION : undefined} />
      <img alt="Innovation City" className="wm" src={WORDMARK_SRC} style={WORDMARK_TRANSITION} />
    </div>
  );
}

/** Mini mark used in place of the dot inside the label pill. */
export function EyebrowMark() {
  return <img alt="" className="eyebrow-mark" src={MARK_SRC} />;
}

/** Tagline line at the foot of the panel. */
export function PanelBrand() {
  return (
    <>
      <p className="panel-footer">
        <img alt="" src={MARK_SRC} />
        Innovation City · {TAGLINE}
      </p>
    </>
  );
}

/**
 * Countdown that ends as the logo. The mark is drawn in the logo image's
 * own geometry (620 x 445: same circle, cut-out and bar as ic-mark.png),
 * and the countdown line is an extension of the logo's bar. The extension
 * drains away over `seconds`, so at zero what's left is exactly the
 * original logo -- which then flies up into the welcome logo (shared
 * view-transition name "ic-mark" on the mark only).
 */
export function LogoCountdown({ secondsLeft, seconds }: { secondsLeft: number; seconds: number }) {
  return (
    <div className="logo-countdown" role="timer" aria-live="polite">
      <div className="lc-row">
        <svg aria-hidden className="lc-logo" preserveAspectRatio="none" style={MARK_TRANSITION} viewBox="0 0 620 445">
          <defs>
            {/* sampled from the logo: cyan on the left, easing into purple */}
            <linearGradient gradientUnits="userSpaceOnUse" id="lc-grad" x1="0" x2="445" y1="0" y2="0">
              <stop offset="0.27" stopColor="#84d0da" />
              <stop offset="0.5" stopColor="#7eb0cd" />
              <stop offset="0.67" stopColor="#7583b9" />
              <stop offset="0.85" stopColor="#7f63aa" />
              <stop offset="1" stopColor="#8a5fa8" />
            </linearGradient>
            <mask id="lc-cut">
              <rect fill="#fff" height="445" width="620" />
              <rect fill="#000" height="86" width="184" x="261" y="180" />
            </mask>
          </defs>
          <circle cx="222.5" cy="222.5" fill="url(#lc-grad)" mask="url(#lc-cut)" r="222.5" />
          <rect fill="#5752a3" height="86" width="175" x="445" y="180" />
        </svg>
        {/* The countdown line is ONE bar lying exactly over the logo's own
            bar and extending right. It drains until it's exactly the logo
            bar's length -- one piece, so there's never a seam. (The logo's
            own bar stays underneath for the flight back to the welcome logo.) */}
        <svg aria-hidden className="lc-ext" preserveAspectRatio="none" viewBox="0 0 100 445">
          <rect className="lc-ext-track" height="86" width="100" x="0" y="180" />
          {/* 2 units taller top and bottom (<1px) so it fully covers the
              soft edges of the logo's own bar underneath -- no hairline. */}
          <rect className="lc-ext-bar" fill="#5752a3" height="90" style={{ animationDuration: `${seconds}s` }} width="100" x="0" y="178" />
        </svg>
      </div>
      <p className="lc-label">
        Returning to the start screen in <b>{secondsLeft}</b>
      </p>
    </div>
  );
}