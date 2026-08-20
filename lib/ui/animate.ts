"use client";

import { flushSync } from "react-dom";

type TransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * Animate a Δ.
 *
 * Every Δ replaces the view, so without this the page snaps: one document is
 * simply gone and another is in its place. The View Transitions API is the right
 * tool because it animates the *difference* — what left, what arrived, what
 * moved — which is precisely what a Δ is, and it needs no bookkeeping from us.
 *
 * `flushSync` is required: the callback has to leave the DOM in its final state
 * before it returns, and a plain React state update would still be queued.
 *
 * Unsupported browsers and anyone who asked for less motion get the update with
 * no animation, which is the same correctness with less decoration.
 */
export function withViewTransition(update: () => void) {
  const doc = typeof document === "undefined" ? null : (document as TransitionDocument);
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc?.startViewTransition || reduced) {
    update();
    return;
  }

  doc.startViewTransition(() => {
    flushSync(update);
  });
}
