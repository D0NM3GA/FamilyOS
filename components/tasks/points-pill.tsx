"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";

/**
 * A points-tally pill that pops when its own point total changes — the parent Server
 * Component re-renders this with a new `points` prop after revalidating its board route,
 * and because it's keyed by person.id the reconciler updates props in place rather than
 * remounting, so this component's local "just changed" state survives the refresh.
 */
export function PointsPill({
  person,
  points,
  rank,
}: {
  person: { id: string; firstName: string; hasPhoto: boolean };
  points: number;
  rank: number;
}) {
  const prevPoints = useRef(points);
  const [popping, setPopping] = useState(false);

  useEffect(() => {
    if (prevPoints.current === points) return;
    prevPoints.current = points;
    setPopping(true);
    const timer = setTimeout(() => setPopping(false), 400);
    return () => clearTimeout(timer);
  }, [points]);

  // The leader gets a slow ambient bob — a deliberately always-visible cue (loops with no
  // hover/click needed) rather than everything in this pass being interaction-gated.
  const isLeader = rank === 0 && points > 0;

  return (
    <div
      // z-index as a CSS custom property, not inline `zIndex` — an inline `style` z-index
      // beats any stylesheet rule regardless of specificity, so `hover:z-50` would never
      // win against it (and even if it could, 50 sits below the 95-100 resting range these
      // ranks use, so a hovered pill would drop *behind* its neighbors instead of rising
      // above them).
      // Every pill tucks 20px under the one before; the row is padded by the same 20px
      // (see PointsPills), so the first pill of a wrapped line lines up instead of spilling
      // off the left edge on a phone.
      style={{ "--z": 100 - rank } as React.CSSProperties}
      className={`relative z-(--z) -ml-5 flex items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3 shadow-sm ring-2 ring-card transition hover:z-[200] hover:-translate-y-0.5 hover:scale-105 hover:shadow-md ${
        isLeader ? "scale-110 shadow-md motion-safe:animate-[float_2.8s_ease-in-out_infinite]" : ""
      }`}
    >
      <Avatar personId={person.id} hasPhoto={person.hasPhoto} initial={person.firstName} size={24} />
      <span
        className={`text-xs font-medium text-foreground ${
          popping ? "animate-[pop_400ms_ease-out]" : ""
        }`}
      >
        {person.firstName} · {points} ⭐
      </span>
    </div>
  );
}

/** The row of pills, padded to take the first pill's tuck (see PointsPill). */
export function PointsPills({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex flex-wrap gap-y-3 pl-5 animate-in fade-in slide-in-from-top-2 duration-500">{children}</div>;
}
