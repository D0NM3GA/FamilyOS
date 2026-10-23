"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fill, pickLine, type LineContext } from "@/lib/pet/voice";
import type { Species } from "@/lib/pet/state";
import type { Mood, Pose } from "@/lib/pet/motion";

/**
 * Phase 47: the pet's reactions: a speech line over the room, a moment's change of face and
 * pose, and hearts floating up. Lines come from lib/pet/voice.ts, never the same twice in a
 * row. Every timer is cleared when the screen goes, so nothing updates after it's gone.
 */
export function useReactions(pet: { name: string; species: Species }) {
  const [line, setLine] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ mood: Mood; pose: Pose } | null>(null);
  const [floaters, setFloaters] = useState<number[]>([]);
  const lastLine = useRef<string | null>(null);
  const timers = useRef(new Set<number>());
  const nextFloater = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  }, []);

  /** One line from a pool, filled in for this pet. */
  const say = useCallback(
    (pool: readonly string[], extra: Partial<LineContext> = {}) => {
      const picked = pickLine(pool, Math.random, lastLine.current);
      lastLine.current = picked;
      return fill(picked, { name: pet.name, species: pet.species, ...extra });
    },
    [pet.name, pet.species],
  );

  const show = useCallback(
    (text: string, mood?: Mood, pose?: Pose) => {
      setLine(text);
      if (mood) {
        setFlash({ mood, pose: pose ?? "hop" });
        later(1800, () => setFlash(null));
      }
      later(3000, () => setLine((current) => (current === text ? null : current)));
    },
    [later],
  );

  /** A quick face and pose with no words: a tap on the pet. */
  const pose = useCallback(
    (mood: Mood, next: Pose, ms = 1200) => {
      setFlash({ mood, pose: next });
      later(ms, () => setFlash(null));
    },
    [later],
  );

  const burst = useCallback(
    (count: number) => {
      const ids = Array.from({ length: count }, () => nextFloater.current++);
      setFloaters((current) => [...current, ...ids]);
      later(1300, () => setFloaters((current) => current.filter((id) => !ids.includes(id))));
    },
    [later],
  );

  return { line, flash, floaters, say, show, pose, burst };
}
