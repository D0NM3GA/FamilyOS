import { describe, expect, it } from "vitest";
import {
  compareAgendaItems,
  dayKey,
  emptyDayLine,
  groupIntoDays,
  importantDateItems,
  isLate,
  outlookItems,
  parseWeekParam,
  relativeWeekLabel,
  schoolDueItems,
  schoolEventItems,
  taskItems,
  timeLabel,
  vehicleItems,
  weekDays,
  weekLabel,
  weekStartOf,
  zonedDayAndMinutes,
  type AgendaItem,
} from "./agenda";

// Local dates, like everything the app stores (lib/tasks/schedule.ts): these tests hold in
// whatever zone they run in. Oct 4 2026 is a Sunday.
const SUN = new Date(2026, 9, 4);
const WED = new Date(2026, 9, 7);

const item = (over: Partial<AgendaItem>): AgendaItem => ({
  key: over.key ?? `k:${over.title}`,
  kind: "chore",
  emoji: "🧹",
  title: "Item",
  who: null,
  day: "2026-10-07",
  minutes: null,
  status: "open",
  note: null,
  href: null,
  external: false,
  ...over,
});

describe("weeks", () => {
  it("start on the Sunday on or before a day", () => {
    expect(weekStartOf(WED)).toEqual(SUN);
    expect(weekStartOf(SUN)).toEqual(SUN);
    expect(weekStartOf(new Date(2026, 9, 10, 23, 30))).toEqual(SUN); // Saturday night
  });

  it("are seven local midnights, even across the end of daylight saving", () => {
    const days = weekDays(new Date(2026, 10, 1)); // US clocks fall back that Sunday
    expect(days.map((d) => d.getDate())).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.every((d) => d.getHours() === 0 && d.getMinutes() === 0)).toBe(true);
  });

  it("read from ?week=, snapped to Sunday; anything odd is this week", () => {
    expect(parseWeekParam("2026-10-14", WED)).toEqual(new Date(2026, 9, 11));
    expect(parseWeekParam(["2026-09-30", "2026-12-01"], WED)).toEqual(new Date(2026, 8, 27));
    expect(parseWeekParam(undefined, WED)).toEqual(SUN);
    expect(parseWeekParam("next week", WED)).toEqual(SUN);
    expect(parseWeekParam("2026-02-30", WED)).toEqual(SUN); // no such day
    expect(parseWeekParam("9999-01-01", WED)).toEqual(SUN); // too far away
    expect(parseWeekParam("2027-03-03", WED)).toEqual(new Date(2027, 1, 28));
  });

  it("are labelled by their dates and by how far from now they are", () => {
    expect(weekLabel(SUN)).toBe("Oct 4 – 10, 2026");
    expect(weekLabel(new Date(2026, 8, 27))).toBe("Sep 27 – Oct 3, 2026");
    expect(weekLabel(new Date(2026, 11, 27))).toBe("Dec 27, 2026 – Jan 2, 2027");
    expect(relativeWeekLabel(SUN, WED)).toBe("This week");
    expect(relativeWeekLabel(new Date(2026, 9, 11), WED)).toBe("Next week");
    expect(relativeWeekLabel(new Date(2026, 8, 27), WED)).toBe("Last week");
    expect(relativeWeekLabel(new Date(2026, 9, 25), WED)).toBe("In 3 weeks");
    expect(relativeWeekLabel(new Date(2026, 8, 13), WED)).toBe("3 weeks ago");
  });
});

describe("times and zones", () => {
  it("label minutes after midnight on a 12-hour clock", () => {
    expect(timeLabel(0)).toBe("12:00 AM");
    expect(timeLabel(8 * 60)).toBe("8:00 AM");
    expect(timeLabel(12 * 60 + 30)).toBe("12:30 PM");
    expect(timeLabel(21 * 60 + 5)).toBe("9:05 PM");
  });

  it("put an instant on the household's wall-clock day", () => {
    // 3:30 UTC on the 9th is still the evening of the 8th in New York.
    expect(zonedDayAndMinutes(new Date(Date.UTC(2026, 9, 9, 3, 30)), "America/New_York")).toEqual({ day: "2026-10-08", minutes: 23 * 60 + 30 });
    expect(zonedDayAndMinutes(new Date(Date.UTC(2026, 9, 9, 3, 30)), "UTC")).toEqual({ day: "2026-10-09", minutes: 3 * 60 + 30 });
  });
});

describe("groupIntoDays", () => {
  it("files items under their day, all-day first then by time, and drops the rest of the calendar", () => {
    const items = [
      item({ key: "a", title: "Evening dose", kind: "med", minutes: 20 * 60 }),
      item({ key: "b", title: "Dishes", kind: "chore" }),
      item({ key: "c", title: "Morning dose", kind: "med", minutes: 8 * 60 }),
      item({ key: "d", title: "Grandma's birthday", kind: "date" }),
      item({ key: "e", title: "Field trip", kind: "schoolEvent", day: "2026-10-05" }),
      item({ key: "f", title: "Next week", day: "2026-10-11" }),
    ];
    const days = groupIntoDays(items, SUN, WED);
    expect(days.map((d) => d.key)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(days[3].items.map((i) => i.key)).toEqual(["d", "b", "c", "a"]);
    expect(days[1].items.map((i) => i.key)).toEqual(["e"]);
    expect(days.flatMap((d) => d.items).some((i) => i.key === "f")).toBe(false);
  });

  it("marks today and the days before it", () => {
    const days = groupIntoDays([], SUN, WED);
    expect(days.map((d) => d.isToday)).toEqual([false, false, false, true, false, false, false]);
    expect(days.map((d) => d.isPast)).toEqual([true, true, true, false, false, false, false]);
    // Another week entirely: nothing is today.
    expect(groupIntoDays([], new Date(2026, 9, 11), WED).some((d) => d.isToday || d.isPast)).toBe(false);
  });

  it("orders same-time items by kind, then title", () => {
    const sorted = [
      item({ key: "1", kind: "chore", title: "B" }),
      item({ key: "2", kind: "vehicle", title: "Z" }),
      item({ key: "3", kind: "chore", title: "A" }),
    ].sort(compareAgendaItems);
    expect(sorted.map((i) => i.key)).toEqual(["2", "3", "1"]);
  });

  it("says something friendly about an empty day, and calls an old to-do late", () => {
    const [sun, , , wed, thu] = groupIntoDays([], SUN, WED);
    expect(emptyDayLine(sun)).toBe("Nothing on this day.");
    expect(emptyDayLine(wed)).toMatch(/\S/);
    expect(emptyDayLine(thu)).toBe(emptyDayLine(thu)); // same line on every visit
    expect(isLate(item({ kind: "chore" }), sun)).toBe(true);
    expect(isLate(item({ kind: "chore", status: "done" }), sun)).toBe(false);
    expect(isLate(item({ kind: "date" }), sun)).toBe(false);
    expect(isLate(item({ kind: "chore" }), wed)).toBe(false);
  });
});

describe("important dates", () => {
  const row = { id: "d1", type: "BIRTHDAY" as const, label: null, month: 10, day: 7, year: 1946, personId: "p1", personName: "Grandma Rose" };

  it("land on their day this year, with an age when the year is known", () => {
    const [b] = importantDateItems([row], SUN);
    expect(b).toMatchObject({ day: "2026-10-07", minutes: null, emoji: "🎂", title: "Grandma Rose's birthday", note: "turns 80", href: "/people/p1" });
    expect(importantDateItems([{ ...row, year: null }], SUN)[0].note).toBeNull();
    expect(importantDateItems([{ ...row, day: 12 }], SUN)).toEqual([]);
  });

  it("find next year's date in a week that crosses New Year", () => {
    const items = importantDateItems(
      [
        { ...row, id: "a", type: "ANNIVERSARY", month: 1, day: 1, year: 2017 },
        { ...row, id: "b", type: "OTHER", label: "Adoption day", month: 12, day: 28, year: null },
      ],
      new Date(2026, 11, 27),
    );
    expect(items.map((i) => [i.day, i.title, i.who, i.note])).toEqual([
      ["2026-12-28", "Adoption day", "Grandma Rose", null],
      ["2027-01-01", "Grandma Rose's anniversary", null, "10 years"],
    ]);
  });

  it("show a Feb 29 birthday on Feb 28 in other years, and nothing before it happened", () => {
    const leapling = { ...row, month: 2, day: 29, year: 2024 };
    expect(importantDateItems([leapling], new Date(2027, 1, 28)).map((i) => [i.day, i.note])).toEqual([["2027-02-28", "turns 3"]]);
    expect(importantDateItems([leapling], new Date(2028, 1, 27)).map((i) => i.day)).toEqual(["2028-02-29"]);
    expect(importantDateItems([{ ...row, year: 2030 }], SUN)).toEqual([]);
  });
});

describe("chores, meds, school and cars", () => {
  it("a dose keeps its time; a chore is all day; done and skipped stay but show it", () => {
    const items = taskItems([
      { id: "m1", domain: "MED", title: "Vitamins", dueDate: new Date(2026, 9, 7, 8, 0), timed: true, status: "DONE", assigneeName: "Kid" },
      { id: "c1", domain: "CHORE", title: "Dishes", dueDate: new Date(2026, 9, 7), timed: false, status: "PENDING", assigneeName: null },
      { id: "c2", domain: "CHORE", title: "Trash", dueDate: new Date(2026, 9, 8), timed: false, status: "SKIPPED", assigneeName: "Dad" },
    ]);
    expect(items.map((i) => [i.key, i.day, i.minutes, i.status, i.href])).toEqual([
      ["med:m1", "2026-10-07", 480, "done", "/meds"],
      ["chore:c1", "2026-10-07", null, "open", "/chores"],
      ["chore:c2", "2026-10-08", null, "skipped", "/chores"],
    ]);
  });

  it("school to-dos and homework link to the student's tab", () => {
    const items = schoolDueItems([
      { id: "t1", kind: "task", title: "Field trip form", dueDate: new Date(2026, 9, 8), who: null, studentId: null, done: false, missing: false },
      { id: "a1", kind: "assignment", title: "Math: Worksheet", dueDate: new Date(2026, 9, 9), who: "Kid", studentId: "k1", done: false, missing: true },
    ]);
    expect(items.map((i) => [i.key, i.emoji, i.day, i.href, i.note])).toEqual([
      ["school:t1", "🎒", "2026-10-08", "/school", null],
      ["homework:a1", "📝", "2026-10-09", "/school?kid=k1", "marked missing"],
    ]);
  });

  it("car maintenance is all day on its due date, linked to the car", () => {
    const [v] = vehicleItems([{ itemId: "i1", title: "Oil change", vehicleId: "v1", vehicleName: "Van", dueByDate: new Date(2026, 9, 9) }]);
    expect(v).toMatchObject({ day: "2026-10-09", minutes: null, title: "Oil change due", who: "Van", href: "/vehicles/v1" });
  });
});

describe("outside calendars", () => {
  const ZONE = "America/New_York";

  it("a multi-day school event shows on each of its days in the week", () => {
    const items = schoolEventItems(
      [
        // Fall break, Oct 9 to 12 (all-day dates are UTC midnights, end exclusive).
        { key: "f:1", title: "Fall break", location: null, startsAt: new Date(Date.UTC(2026, 9, 9)), endsAt: new Date(Date.UTC(2026, 9, 13)), allDay: true, who: null, studentId: null },
        // An all-day event whose end equals its start still lasts its day.
        { key: "f:2", title: "Picture day", location: "Gym", startsAt: new Date(Date.UTC(2026, 9, 5)), endsAt: new Date(Date.UTC(2026, 9, 5)), allDay: true, who: "Kid", studentId: "k1" },
        { key: "f:3", title: "Concert", location: null, startsAt: new Date(Date.UTC(2026, 9, 9, 0, 30)), endsAt: new Date(Date.UTC(2026, 9, 9, 2)), allDay: false, who: null, studentId: null },
      ],
      SUN,
      ZONE,
    );
    expect(items.map((i) => [i.title, i.day, i.minutes, i.note])).toEqual([
      ["Fall break", "2026-10-09", null, "through Oct 12"],
      ["Fall break", "2026-10-10", null, "through Oct 12"],
      ["Picture day", "2026-10-05", null, "Gym"],
      ["Concert", "2026-10-08", 20 * 60 + 30, null],
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items[2].href).toBe("/school?kid=k1");
  });

  it("Outlook events link out to Outlook, or nowhere without a link", () => {
    const items = outlookItems(
      [
        { id: "o1", subject: "Dentist", start: new Date(Date.UTC(2026, 9, 6, 20)), end: new Date(Date.UTC(2026, 9, 6, 21)), isAllDay: false, location: "Main St", webLink: "https://outlook.office365.com/x" },
        { id: "o2", subject: "Day off", start: new Date(Date.UTC(2026, 9, 9)), end: new Date(Date.UTC(2026, 9, 10)), isAllDay: true, location: null, webLink: null },
      ],
      SUN,
      ZONE,
    );
    expect(items.map((i) => [i.title, i.day, i.minutes, i.note, i.href, i.external])).toEqual([
      ["Dentist", "2026-10-06", 16 * 60, "Main St", "https://outlook.office365.com/x", true],
      ["Day off", "2026-10-09", null, null, null, false],
    ]);
  });

  it("day keys are local dates", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
