"use client";

import { useEffect, useRef } from "react";

/**
 * Phase 44.1: a page's <h1> that takes focus when it appears, for pages that change in place
 * (the guided setup's steps): a keyboard or screen reader starts at the new step's title, not
 * wherever the old step's button was. Focus via script only (tabIndex -1), so it's no tab stop.
 */
export function FocusHeading({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={`${className} outline-none`}>
      {children}
    </h1>
  );
}
