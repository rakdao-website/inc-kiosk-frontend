import { flushSync } from "react-dom";

/* -------------------------------------------------------------------------
   Animated screen changes (View Transitions API, Chrome/Edge 111+).

   The browser snapshots the kiosk, applies the update, then animates from
   the old picture to the new one:
     - elements with a matching view-transition-name morph between their
       old and new position/size (the Innovation City logo: big on the
       welcome screen -> small in the header, and back);
     - the screen content ("screen") slides out and the next one slides in;
     - everything else (header, bottom bar) just stays put.

   Direction is set on <html data-nav="..."> for the CSS:
     "forward" (default), "back" (Back / Home), "reset" (visit finished),
     "overlay" (something opens on top -- the screen behind stays still).
   Browsers without View Transitions, and reduced-motion, just update.
   ------------------------------------------------------------------------- */

export type NavDirection = "forward" | "back" | "reset" | "overlay";

type ViewTransitionLike = { finished: Promise<void> };
type DocumentWithVT = Document & { startViewTransition?: (update: () => void) => ViewTransitionLike };

let updating = false;
let pendingDirection: NavDirection | null = null;

/** Mark the next screen change as going back (Back button, Home). */
export function navigateBack() {
  pendingDirection = "back";
}

/**
 * @param logoGrows the Innovation City logo ends up BIGGER on the new screen
 *   (e.g. header -> thank-you countdown); the browser then shows the new,
 *   larger picture of it so it stays sharp. Implied for "overlay" and "reset".
 */
export function withViewTransition(update: () => void, direction?: NavDirection, logoGrows = false) {
  const doc = document as DocumentWithVT;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Already inside a transition's update (e.g. a reset that changes the
  // step), or no support: apply directly.
  if (updating || !doc.startViewTransition || reduceMotion) {
    update();
    return;
  }

  const dir = direction ?? pendingDirection ?? "forward";
  pendingDirection = null;
  document.documentElement.dataset.nav = dir;
  document.documentElement.dataset.logo = logoGrows || dir === "overlay" || dir === "reset" ? "grow" : "shrink";

  const transition = doc.startViewTransition(() => {
    updating = true;
    try {
      flushSync(update);
    } finally {
      updating = false;
    }
  });
  transition.finished.finally(() => {
    if (document.documentElement.dataset.nav === dir) {
      delete document.documentElement.dataset.nav;
      delete document.documentElement.dataset.logo;
    }
  });
}