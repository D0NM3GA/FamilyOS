"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Phase 47: `setTimeout` for a game, with every timer cleared when the game closes. Without it,
 * "Back to the room" just after a last move would still finish the round on a closed screen.
 */
export function useLater() {
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return useCallback((ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  }, []);
}
