"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fill, pickLine, type LineContext } from "@/lib/pet/voice";
import type { Species } from "@/lib/pet/state";
import type { Mood, Pose } from "@/lib/pet/motion";
import type { Effect, EffectKind, RoomPoint } from "./effects";

/**
 * Phase 47: the pet's reactions: a speech line over the room, a moment's change of face and
 * pose, and (Phase 54) the room's effects: bursts of hearts, sparkles, crumbs or bubbles, and
 * food flying to the pet. Lines come from lib/pet/voice.ts, never the same twice in a row.
 * Every timer is cleared when the screen goes, so nothing updates after it's gone.
 */
export function useReactions(pet: { name: string; species: Species }) {
  const [line, setLine] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ mood: Mood; pose: Pose } | null>(null);
  const [effects, setEffects] = useState<Effect[]>([]);
  const lastLine = useRef<string | null>(null);
  const timers = useRef(new Set<number>());
  const nextEffect = useRef(0);

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

  /** A quick face and pose with no words: a tap on the pet, a trick. */
  const pose = useCallback(
    (mood: Mood, next: Pose, ms = 1200) => {
      setFlash({ mood, pose: next });
      later(ms, () => setFlash(null));
    },
    [later],
  );

  const add = useCallback(
    (made: Omit<Effect, "id">[], lifeMs: number) => {
      const added = made.map((effect) => ({ ...effect, id: nextEffect.current++ }));
      const ids = new Set(added.map((effect) => effect.id));
      setEffects((current) => [...current, ...added]);
      later(lifeMs, () => setEffects((current) => current.filter((effect) => !ids.has(effect.id))));
    },
    [later],
  );

  /** A burst of `count` from a point, spreading out (sparkles), up (hearts, bubbles) or down (crumbs). */
  const burst = useCallback(
    (kind: Exclude<EffectKind, "food">, at: RoomPoint, count: number) => {
      add(
        Array.from({ length: count }, (_, i) => {
          const angle = (i / count) * Math.PI * 2;
          const spread = kind === "sparkle" ? 12 : 6;
          const rise = kind === "crumb" ? 8 : kind === "sparkle" ? Math.sin(angle) * spread : -22;
          return { kind, at, move: { x: Math.cos(angle) * spread, y: rise }, delay: i * 70 };
        }),
        1500 + count * 70,
      );
    },
    [add],
  );

  /** Food arcing from one point to another (the bowl to the pet), then crumbs where it lands. */
  const fly = useCallback(
    (emoji: string, from: RoomPoint, to: RoomPoint) => {
      add([{ kind: "food", emoji, at: from, move: { x: to.x - from.x, y: to.y - from.y }, delay: 0 }], 700);
      later(550, () => burst("crumb", to, 5));
    },
    [add, burst, later],
  );

  return { line, flash, effects, say, show, pose, burst, fly };
}
