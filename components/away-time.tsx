"use client";

import { useDeviceTimeZone } from "@/components/device-time-zone";
import { useHouseholdZone } from "@/components/household-zone";
import { toISODate } from "@/lib/format";

/**
 * Phase 49.5 (the owner's call): away from home, a time shows where the device is too, so
 * medication and routines stay regular on a trip. Placed right after a home time ("8:00 AM"), it
 * adds " at home · 2:00 PM here" when this device is in another zone, with the weekday when it's
 * a different day here. Nothing on the server or during hydration (the device's zone isn't known
 * there), so the first render matches the server's. The device's zone never leaves the browser.
 */
export function AwayTime({ at, line, className }: { at: Date | string; line?: boolean; className?: string }) {
  const away = useAwayZone();
  if (!away) return null;
  const when = new Date(at);
  const clock = (timeZone: string) => when.toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" });
  const otherDay = toISODate(when, away.here) !== toISODate(when, away.home);
  const here = `${otherDay ? `${when.toLocaleDateString([], { timeZone: away.here, weekday: "short" })} ` : ""}${clock(away.here)} here`;
  // On its own line (a card whose first line is already full): both times, home first.
  // The dot is only a separator: a screen reader hears "8:00 AM at home, 2:00 PM here".
  const dot = <span aria-hidden="true"> · </span>;
  if (line) {
    return (
      <p className={className}>
        {clock(away.home)} at home<span className="sr-only">,</span>
        {dot}
        {here}
      </p>
    );
  }
  return (
    <span className="whitespace-nowrap">
      {" "}
      at home<span className="sr-only">,</span>
      {dot}
      {here}
    </span>
  );
}

/** Says once, at the top of Home, why times come in pairs while away. */
export function AwayNote() {
  const away = useAwayZone();
  if (!away) return null;
  return (
    <p role="note" className="rounded-xl bg-sky/20 px-3 py-2 text-sm font-semibold">
      You&apos;re in a different time zone from home. Times show home first, then where you are, so
      doses and routines stay on their usual schedule.
    </p>
  );
}

/** The household's zone and this device's, when they differ; null otherwise (and on the server). */
function useAwayZone(): { home: string; here: string } | null {
  const home = useHouseholdZone();
  const here = useDeviceTimeZone();
  if (!home || !here || sameClock(home, here)) return null;
  return { home, here };
}

/** Two names for one clock (an alias, or zones that agree right now) aren't "away". */
function sameClock(a: string, b: string): boolean {
  if (a === b) return true;
  const now = new Date();
  const clock = (timeZone: string) => now.toLocaleString("en-US", { timeZone, dateStyle: "short", timeStyle: "short" });
  return clock(a) === clock(b);
}
