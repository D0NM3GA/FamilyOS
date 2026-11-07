/**
 * Phase 62: a person's quiet hours, minutes after midnight in the household's time (the server
 * keeps it, lib/household-zone.ts). Both or neither; the window may wrap midnight (21:00–07:00).
 * Pure.
 */
export type QuietHours = { quietStart: number | null; quietEnd: number | null };

export function inQuietHours(prefs: QuietHours | null | undefined, now: Date): boolean {
  if (!prefs || prefs.quietStart == null || prefs.quietEnd == null || prefs.quietStart === prefs.quietEnd) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  const { quietStart: start, quietEnd: end } = prefs;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** "21:30" → 1290; anything else null. */
export function parseClock(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 1290 → "21:30", for a time field's value. */
export function clockText(minutes: number | null): string {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
