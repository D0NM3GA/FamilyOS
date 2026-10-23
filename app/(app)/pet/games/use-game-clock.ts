"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phase 47.3: milliseconds since a round started, updated every animation frame while it runs,
 * with `onFrame` called from the frame itself (where a game advances its rules). Elapsed
 * time, not a frame counter, so a slow phone or a hidden tab doesn't slow the round down.
 */
export function useGameClock(running: boolean, onFrame?: (t: number) => void): number {
  const [t, setT] = useState(0);
  const latest = useRef(onFrame);
  useEffect(() => {
    latest.current = onFrame;
  });
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      setT(elapsed);
      latest.current?.(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return t;
}
