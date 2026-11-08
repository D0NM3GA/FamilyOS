/**
 * Phase 70d: days with no school, from the school calendars' all-day events, so the pet keeps its
 * weekend hours then (the owner's idea, on by default). Pure and client-safe.
 */

/**
 * Words that say there's no school, matched as whole words: "Holiday Concert", "Breakfast with
 * Santa" and "Spring Break Camp signups due" style titles mustn't turn a school day into a day off,
 * so a holiday or break counts only when the title doesn't also name an event at school.
 */
const NO_SCHOOL = [
  /\bno school\b/i,
  /\bschool(?:s)? (?:is |are )?closed\b/i,
  /\bclosed\b.*\bschool/i,
  /\bno classes\b/i,
  /\bteacher (?:work|planning|in-service|inservice|professional) ?(?:day|development)?\b/i,
  /\b(?:in-service|inservice|professional development) day\b/i,
  /\bstudent holiday\b/i,
  /\b(?:winter|spring|fall|thanksgiving|christmas|holiday|mid-winter|february) break\b/i,
  /\bholiday\b/i,
  /\bbreak\b/i,
];
/** An event at school, not a day off: a holiday concert, a break-time fair. */
const AT_SCHOOL = /\b(concert|program|party|parade|fair|sale|show|performance|signups?|sign-ups?|registration|camp|dance|assembly|lunch|breakfast|dinner|drive|due|picture|pictures)\b/i;

export function isNoSchoolTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/\bno school\b/i.test(t)) return true;
  if (AT_SCHOOL.test(t)) return false;
  return NO_SCHOOL.some((re) => re.test(t));
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Every day an all-day "no school" event covers, as "YYYY-MM-DD" (all-day events are UTC midnight
 * of their date, end exclusive, as school feeds store them). A week-long break gives seven days.
 */
export function noSchoolDays(events: readonly { title: string; startsAt: Date; endsAt: Date; allDay: boolean }[]): Set<string> {
  const days = new Set<string>();
  for (const e of events) {
    if (!e.allDay || !isNoSchoolTitle(e.title)) continue;
    const end = e.endsAt > e.startsAt ? e.endsAt.getTime() : e.startsAt.getTime() + 86_400_000;
    // At most a month from one event: a malformed feed can't make a year of days off.
    for (let t = e.startsAt.getTime(), n = 0; t < end && n < 31; t += 86_400_000, n++) days.add(utcKey(new Date(t)));
  }
  return days;
}
