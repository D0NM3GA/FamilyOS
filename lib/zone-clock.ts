/**
 * Clock times in a named zone, with the app's own zone data (ICU, through Intl): school feeds use
 * it for floating times (Phase 18.5), and Phase 49 to move stored days from one zone to another.
 * Never Postgres's: its zone list can lack names Intl calls canonical (Asia/Calcutta).
 */

/** The date and clock time `instant` shows in `timeZone`. */
export function wallClock(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second"), ms: instant.getUTCMilliseconds() };
}

/** Offset of `timeZone` from UTC at `instant`, in ms. */
function zoneOffset(timeZone: string, instant: number): number {
  const c = wallClock(new Date(instant - (instant % 1000)), timeZone);
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) - (instant - (instant % 1000));
}

/**
 * A wall-clock time in `timeZone` -> the instant it names (DST-correct: re-checked once). A time
 * a clock change skips lands that much later (1:30 on a night that jumps from 1 to 2 is 2:30); a
 * time it repeats settles on one of the two, the same one every time.
 */
export function wallClockToInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = zoneOffset(timeZone, guess);
  let instant = guess - first;
  const second = zoneOffset(timeZone, instant);
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

/** The same date and clock time in `to` as `instant` shows in `from` (milliseconds kept). */
export function sameClockIn(instant: Date, from: string, to: string): Date {
  const c = wallClock(instant, from);
  return new Date(wallClockToInstant(c.y, c.mo, c.d, c.h, c.mi, c.s, to).getTime() + c.ms);
}
