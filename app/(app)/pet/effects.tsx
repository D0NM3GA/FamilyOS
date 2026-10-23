"use client";

import { ROOM_H, ROOM_W } from "@/lib/pet/room";

/**
 * Phase 54: the room's little bursts of feedback ("juice"): hearts, sparkles, crumbs, bubbles
 * and food flying from the bowl to the pet. Each is a short CSS animation (app/globals.css,
 * `pet-fx-*`) from a point in the room, given as percentages so it lines up with the room at
 * any size. Reduced motion finishes them at once, so they never get in the way.
 */

export type EffectKind = "heart" | "sparkle" | "crumb" | "bubble" | "food";

/** A point in the room, as percentages across and down. */
export type RoomPoint = { x: number; y: number };

export type Effect = {
  id: number;
  kind: EffectKind;
  at: RoomPoint;
  /** Where it heads, relative to `at`, in percent of the room: drift for a burst, the target for food. */
  move: RoomPoint;
  delay: number;
  emoji?: string;
};

/** Room units (the 400 × 260 drawing) to a point in percent. */
export function roomPoint(x: number, y: number): RoomPoint {
  return { x: (x / ROOM_W) * 100, y: (y / ROOM_H) * 100 };
}

const LOOK: Record<Exclude<EffectKind, "food">, string> = { heart: "💗", sparkle: "✨", crumb: "•", bubble: "🫧" };

export function EffectLayer({ effects }: { effects: Effect[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {effects.map((effect) =>
        effect.kind === "food" ? (
          // An arc: the outer moves across at an even pace, the inner rises then drops.
          <span
            key={effect.id}
            className="pet-fx-arc-x absolute text-2xl"
            style={{ left: `${effect.at.x}%`, top: `${effect.at.y}%`, "--dx": `${effect.move.x}cqw`, "--dy": `${effect.move.y}cqh` } as React.CSSProperties}
          >
            <span className="pet-fx-arc-y inline-block">{effect.emoji ?? "🍙"}</span>
          </span>
        ) : (
          <span
            key={effect.id}
            className={`pet-fx-${effect.kind} absolute -translate-x-1/2 -translate-y-1/2 ${effect.kind === "crumb" ? "text-xs text-amber-700" : "text-xl"}`}
            style={
              {
                left: `${effect.at.x}%`,
                top: `${effect.at.y}%`,
                "--dx": `${effect.move.x}cqw`,
                "--dy": `${effect.move.y}cqh`,
                animationDelay: `${effect.delay}ms`,
              } as React.CSSProperties
            }
          >
            {LOOK[effect.kind]}
          </span>
        ),
      )}
    </div>
  );
}
