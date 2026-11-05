"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { chip } from "@/components/styles";

type Href = string | { pathname: string; query: Record<string, string> };

/**
 * One chip in a board's "whose" row: a person's picture, their short name and their total,
 * so the row that filters the board is also its scoreboard (two rows of the same people read
 * as clutter). The total pops when it changes: the board re-renders this with new `points`
 * after revalidating, and keyed by person it updates in place, so `popping` survives the refresh.
 * Chips keep the members' order rather than ranking, so nothing jumps under a finger mid-tap.
 */
export function PersonFilterChip({
  href,
  active,
  label,
  person,
  points,
  leader = false,
}: {
  href: Href;
  active: boolean;
  label: string;
  person?: { id: string; initial: string; hasPhoto: boolean };
  points?: number;
  /** Top of the tally: their picture bobs, an always-visible cue that needs no tap. */
  leader?: boolean;
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

  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${chip} ${person ? "ps-1.5" : ""}`}>
      {person && (
        // Hidden from screen readers: a picture-less avatar is a letter, which would read as "M Max".
        <span aria-hidden className={leader ? "motion-safe:animate-[float_2.8s_ease-in-out_infinite]" : undefined}>
          <Avatar personId={person.id} hasPhoto={person.hasPhoto} initial={person.initial} size={22} className="ui-chip-face" />
        </span>
      )}
      {label}
      {points !== undefined && (
        <span className={`font-medium tabular-nums ${popping ? "animate-[pop_400ms_ease-out]" : ""}`}>· {points} ⭐</span>
      )}
    </Link>
  );
}
