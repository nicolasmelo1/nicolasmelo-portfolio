import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nicolas Melo / Portfolio",
  description: "An interactive, text-only portfolio that rewrites itself from conversation.",
};

/**
 * `children` is typed here rather than through Next's generated `LayoutProps`.
 * That global lives in `.next/types`, so `tsc --noEmit` only passed after a
 * build — which held locally, where `.next` always existed, and failed in CI
 * where the typecheck runs first. A typecheck should work on a fresh clone.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
        Browser extensions inject attributes onto <body> before React hydrates —
        the reported mismatch was `data-testim-main-word-scripts-loaded`, added by
        an extension, on a <body> that this component renders with no attributes
        at all. suppressHydrationWarning applies to this element's own
        attributes and text only, never to its descendants, so a real mismatch
        inside the app still reports (one did, and was fixed).
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
