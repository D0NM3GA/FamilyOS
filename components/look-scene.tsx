"use client";

import { useLook } from "@/components/look";
import { lookOf } from "@/lib/looks";

/** Phase 58: Home's banner, for looks that have one. Follows what's being tried on. */
export function LookScene({ firstName, date }: { firstName: string; date: string }) {
  const { shown } = useLook();
  const hello = lookOf(shown.look).hello;
  if (!hello) return null;
  return (
    <p className="ui-scene">
      <span className="ui-scene-hello">{hello(firstName)}</span>
      <span className="ui-scene-date">{date}</span>
    </p>
  );
}
