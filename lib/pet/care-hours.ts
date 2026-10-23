/**
 * Phase 47: when the pet is awake. Its clock only runs during the household's care hours, so a
 * school day or a night's sleep can't starve it (the owner's call, 2026-10-23). Pure and
 * client-safe; times are minutes since midnight in the household's time zone.
 */

export type CareWindow = { start: number; end: number };
export type CareHours = { weekday: CareWindow[]; weekend: CareWindow[] };

const hour = (h: number) => h * 60;

export const DEFAULT_CARE_HOURS: CareHours = {
  weekday: [
    { start: hour(7), end: hour(8) },
    { start: hour(15), end: hour(20) },
  ],
  weekend: [{ start: hour(8), end: hour(20) }],
};

export const MINUTE_MS = 60_000;

/** Whole minutes since the epoch: the pet's clock ticks once per one of these. */
export function epochMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The weekday and minute of the day for an epoch minute, in a time zone. */
export function localTime(minute: number, timeZone: string): { weekend: boolean; minuteOfDay: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(minute * MINUTE_MS));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  return {
    weekend: weekday === "Sat" || weekday === "Sun",
    minuteOfDay: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

function awakeAt(local: { weekend: boolean; minuteOfDay: number }, careHours: CareHours): boolean {
  const windows = local.weekend ? careHours.weekend : careHours.weekday;
  return windows.some((window) => local.minuteOfDay >= window.start && local.minuteOfDay < window.end);
}

export function isCareMinute(minute: number, careHours: CareHours, timeZone: string): boolean {
  return awakeAt(localTime(minute, timeZone), careHours);
}

/**
 * The care minutes in [fromMinute, toMinute), one at a time, so a long catch-up can stop as soon
 * as it's done (a pet that's gone) without listing months of minutes first. Windows start and end
 * on whole local hours (all the settings screen offers), so one answer holds until the next local
 * hour: checking once per local hour, not per minute, keeps a month away cheap, and counting to
 * the local hour (not the UTC one) keeps half-hour time zones right.
 */
export function* careMinutes(fromMinute: number, toMinute: number, careHours: CareHours, timeZone: string): Generator<number> {
  let minute = fromMinute;
  while (minute < toMinute) {
    const local = localTime(minute, timeZone);
    const runEnd = Math.min(toMinute, minute + 60 - (local.minuteOfDay % 60));
    if (awakeAt(local, careHours)) for (let m = minute; m < runEnd; m++) yield m;
    minute = runEnd;
  }
}

export function isWholeHourWindow(window: CareWindow): boolean {
  return window.start % 60 === 0 && window.end % 60 === 0 && window.start < window.end && window.end <= 24 * 60;
}

function clockWord(minuteOfDay: number): { text: string; half: "am" | "pm" } {
  const hour24 = Math.floor(minuteOfDay / 60) % 24;
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { text: String(hour), half: hour24 < 12 ? "am" : "pm" };
}

/** Windows in words: "7–8am and 3–8pm", "all day", or "never" for none. */
export function careWindowsText(windows: readonly CareWindow[]): string {
  if (windows.length === 0) return "never";
  if (windows.length === 1 && windows[0].start === 0 && windows[0].end >= 24 * 60) return "all day";
  const parts = windows.map(({ start, end }) => {
    const from = clockWord(start);
    const to = end >= 24 * 60 ? { text: "midnight", half: "" } : clockWord(end);
    return from.half === to.half ? `${from.text}–${to.text}${to.half}` : `${from.text}${from.half}–${to.text}${to.half}`;
  });
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Today's windows in words, in the household's time zone. */
export function careHoursToday(careHours: CareHours, timeZone: string, nowMs: number): string {
  const { weekend } = localTime(epochMinute(nowMs), timeZone);
  return careWindowsText(weekend ? careHours.weekend : careHours.weekday);
}
