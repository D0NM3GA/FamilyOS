/**
 * Phase 70d: days with no school, from the school calendars' all-day events, so the pet keeps its
 * weekend hours then (on by default). Pure and client-safe.
 */

/**
 * A title about a school day, though it names a break or a holiday: the day school comes back or the
 * last day before, an event at school ("Holiday Concert", "Spring Break book fair"), or a short day.
 * Checked first, so "Return from Winter Break" or "Holiday Spirit Week" keeps the pet on school hours.
 */
const SCHOOL_DAY =
  /\b(resumes?|return(?:s|ing)?|back to school|begins?|starts?|ends?|last day|first day|before|after|early (?:dismissal|release)|dismissal|release|half day|minimum day|week|concert|program|party|parade|fair|sale|shop|show|performance|spirit|sweater|brain|signups?|sign-ups?|registration|camp|dance|assembly|lunch|breakfast|dinner|drive|due|pictures?|picnic)\b/i;

/** Plainly a day off. */
const DAY_OFF = [
  /\bno school\b/i,
  /\bno classes\b/i,
  /\b(?:no|non-?)\s?students?\b/i,
  /\bstudent non-?attendance\b/i,
  /\b(?:district|schools?|school buildings?) (?:is |are )?closed\b/i,
  /\bsnow day\b/i,
  /\b(?:staff|teacher) (?:work ?day|planning|development|institute|in-?service|professional development)\b/i,
  /\b(?:in-?service|professional development|pd|records) day\b/i,
  /\bstudent holiday\b/i,
  /\b(?:winter|spring|fall|autumn|thanksgiving|christmas|holiday|mid-?winter|february|april|easter|summer) (?:break|recess|vacation)\b/i,
  /\brecess\b/i,
  /\bholiday\b/i,
  /\bbreak\b/i,
];

/** Public holidays a school is closed for, by name. */
const HOLIDAYS =
  /\b(labor|memorial|presidents'?|president'?s|veterans'?|independence|columbus|indigenous peoples'?|martin luther king(?: jr\.?)?|mlk|new year'?s?|good friday|election)\s+day\b|\b(thanksgiving|christmas|juneteenth|new year'?s eve)\b/i;

export function isNoSchoolTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (SCHOOL_DAY.test(t)) return /\bno school\b/i.test(t) && !/\b(?:resumes?|return|back to school)\b/i.test(t);
  return HOLIDAYS.test(t) || DAY_OFF.some((re) => re.test(t));
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Longer than this is a term or a summer marker, not a stretch of days off the pet should follow. */
const LONGEST_DAYS = 31;

/**
 * Every day an all-day "no school" event covers, as "YYYY-MM-DD" (all-day events are UTC midnight
 * of their date, end exclusive, as school feeds store them). A week-long break gives seven days;
 * one longer than a month is left out entirely rather than cut off partway.
 */
export function noSchoolDays(events: readonly { title: string; startsAt: Date; endsAt: Date; allDay: boolean }[]): Set<string> {
  const days = new Set<string>();
  for (const e of events) {
    if (!e.allDay || !isNoSchoolTitle(e.title)) continue;
    const end = e.endsAt > e.startsAt ? e.endsAt.getTime() : e.startsAt.getTime() + 86_400_000;
    if (end - e.startsAt.getTime() > LONGEST_DAYS * 86_400_000) continue;
    for (let t = e.startsAt.getTime(); t < end; t += 86_400_000) days.add(utcKey(new Date(t)));
  }
  return days;
}
