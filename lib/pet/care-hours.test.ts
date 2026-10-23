import { describe, expect, it } from "vitest";
import { careMinutes, careWindowsText, DEFAULT_CARE_HOURS, isCareMinute, isWholeHourWindow, localTime, MINUTE_MS } from "./care-hours";

const minuteOf = (ms: number) => ms / MINUTE_MS;
const careMinutesBetween = (...args: Parameters<typeof careMinutes>) => [...careMinutes(...args)];
const DAY = 24 * 60;

describe("care hours", () => {
  it("counts a default weekday's awake minutes: 7–8am and 3–8pm", () => {
    const monday = minuteOf(Date.UTC(2026, 9, 19));
    const minutes = careMinutesBetween(monday, monday + DAY, DEFAULT_CARE_HOURS, "UTC");
    expect(minutes).toHaveLength(6 * 60);
    expect(localTime(minutes[0], "UTC").minuteOfDay).toBe(7 * 60);
    expect(localTime(minutes[60], "UTC").minuteOfDay).toBe(15 * 60);
  });

  it("uses the weekend window on Saturday", () => {
    const saturday = minuteOf(Date.UTC(2026, 9, 24));
    expect(careMinutesBetween(saturday, saturday + DAY, DEFAULT_CARE_HOURS, "UTC")).toHaveLength(12 * 60);
  });

  it("follows the household's time zone, not the server's", () => {
    // 15:00 UTC on a Monday is 11:00 in New York (daylight time): asleep there.
    const threePmUtc = minuteOf(Date.UTC(2026, 9, 19, 15));
    expect(isCareMinute(threePmUtc, DEFAULT_CARE_HOURS, "UTC")).toBe(true);
    expect(isCareMinute(threePmUtc, DEFAULT_CARE_HOURS, "America/New_York")).toBe(false);
  });

  it("keeps the same awake hours across the spring and fall clock changes", () => {
    const zone = "America/New_York";
    // Sundays 2026-03-08 and 2026-11-01, from local midnight.
    const spring = minuteOf(Date.UTC(2026, 2, 8, 5));
    const fall = minuteOf(Date.UTC(2026, 10, 1, 4));
    expect(careMinutesBetween(spring, spring + DAY - 60, DEFAULT_CARE_HOURS, zone)).toHaveLength(12 * 60);
    expect(careMinutesBetween(fall, fall + DAY + 60, DEFAULT_CARE_HOURS, zone)).toHaveLength(12 * 60);
  });

  it("lines up with local hours in a half-hour time zone", () => {
    // Monday 2026-10-19 00:00 in India (UTC+5:30).
    const midnight = minuteOf(Date.UTC(2026, 9, 18, 18, 30));
    const minutes = careMinutesBetween(midnight, midnight + DAY, DEFAULT_CARE_HOURS, "Asia/Kolkata");
    expect(minutes).toHaveLength(6 * 60);
    expect(localTime(minutes[0], "Asia/Kolkata").minuteOfDay).toBe(7 * 60);
  });

  it("gives the same minutes when counted in pieces", () => {
    const start = minuteOf(Date.UTC(2026, 9, 19));
    const whole = careMinutesBetween(start, start + 3 * DAY, DEFAULT_CARE_HOURS, "America/New_York");
    const pieces = [
      ...careMinutesBetween(start, start + 917, DEFAULT_CARE_HOURS, "America/New_York"),
      ...careMinutesBetween(start + 917, start + 3 * DAY, DEFAULT_CARE_HOURS, "America/New_York"),
    ];
    expect(pieces).toEqual(whole);
  });

  it("accepts only whole-hour windows within a day", () => {
    expect(isWholeHourWindow({ start: 60, end: 120 })).toBe(true);
    expect(isWholeHourWindow({ start: 90, end: 120 })).toBe(false);
    expect(isWholeHourWindow({ start: 120, end: 60 })).toBe(false);
    expect(isWholeHourWindow({ start: 0, end: 25 * 60 })).toBe(false);
  });
});

describe("careWindowsText", () => {
  it("says the windows the way people do", () => {
    expect(careWindowsText(DEFAULT_CARE_HOURS.weekday)).toBe("7–8am and 3–8pm");
    expect(careWindowsText(DEFAULT_CARE_HOURS.weekend)).toBe("8am–8pm");
    expect(careWindowsText([{ start: 0, end: 1440 }])).toBe("all day");
    expect(careWindowsText([{ start: 1260, end: 1440 }])).toBe("9pm–midnight");
    expect(careWindowsText([])).toBe("never");
  });
});
