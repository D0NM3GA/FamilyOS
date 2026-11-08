import { describe, expect, it } from "vitest";
import { isNoSchoolTitle, noSchoolDays } from "./no-school";
import { careHoursToday, DEFAULT_CARE_HOURS, isCareMinute, localTime, MINUTE_MS } from "./care-hours";

describe("isNoSchoolTitle", () => {
  it("days off", () => {
    for (const t of ["No School", "No School - Teacher Workday", "Thanksgiving Break", "Winter Break", "Spring break", "Schools closed", "Teacher Work Day", "Teacher Planning Day", "Professional Development Day - No Students", "Holiday", "Student Holiday", "Mid-Winter Break", "Veterans Day - No School", "Labor Day", "Memorial Day", "Presidents Day", "MLK Day", "Martin Luther King Jr. Day", "Juneteenth", "Thanksgiving", "Election Day", "Snow Day", "Winter Recess", "Spring Recess", "Staff Development Day", "Staff Inservice", "PD Day", "Teacher Institute Day", "No Students", "Non-Student Day", "Student Non-Attendance Day", "District Closed", "Records Day", "Christmas Holiday"]) {
      expect(isNoSchoolTitle(t), t).toBe(true);
    }
  });

  it("events at school, and words inside other words, aren't", () => {
    for (const t of ["Holiday Concert", "Breakfast with Santa", "Winter Break Camp signups due", "Spring Break book fair", "Picture Day", "Early Dismissal", "Holiday Party in class", "Breakout session", "", "Return from Winter Break", "Last day before Winter Break", "Classes resume after Spring Break", "Winter Break begins - early dismissal", "Holiday Spirit Week", "Holiday Shop", "Holiday Sweater Day", "Brain Break", "Holiday Program", "Early Release", "Half Day", "Thanksgiving Lunch"]) {
      expect(isNoSchoolTitle(t), t).toBe(false);
    }
  });
});

describe("noSchoolDays", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  it("every day an all-day event covers, end exclusive; timed and other events don't count", () => {
    const days = noSchoolDays([
      { title: "Thanksgiving Break", startsAt: day("2026-11-25"), endsAt: day("2026-11-28"), allDay: true },
      { title: "No School", startsAt: day("2026-11-11"), endsAt: day("2026-11-12"), allDay: true },
      { title: "No School assembly", startsAt: new Date("2026-11-13T15:00:00Z"), endsAt: new Date("2026-11-13T16:00:00Z"), allDay: false },
      { title: "Book fair", startsAt: day("2026-11-16"), endsAt: day("2026-11-17"), allDay: true },
    ]);
    expect([...days].sort()).toEqual(["2026-11-11", "2026-11-25", "2026-11-26", "2026-11-27"]);
  });

  it("a break longer than a month is left out, not cut off partway", () => {
    expect(noSchoolDays([{ title: "Summer Break", startsAt: day("2026-06-10"), endsAt: day("2026-08-20"), allDay: true }]).size).toBe(0);
  });
});

describe("the pet's hours on a day off", () => {
  // Wednesday 2026-11-11, 10:00 UTC: weekday hours are 7–8 and 3–8 (asleep), weekend 8–8 (awake).
  const wed10 = Date.UTC(2026, 10, 11, 10) / MINUTE_MS;
  it("a no-school weekday keeps weekend hours", () => {
    expect(localTime(wed10, "UTC").day).toBe("2026-11-11");
    expect(isCareMinute(wed10, DEFAULT_CARE_HOURS, "UTC")).toBe(false);
    expect(isCareMinute(wed10, DEFAULT_CARE_HOURS, "UTC", new Set(["2026-11-11"]))).toBe(true);
    expect(careHoursToday(DEFAULT_CARE_HOURS, "UTC", wed10 * MINUTE_MS, new Set(["2026-11-11"]))).toBe("8am–8pm");
  });
});
