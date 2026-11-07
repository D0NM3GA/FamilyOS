import { describe, expect, it } from "vitest";
import { newEventPayload, newEventSchema } from "./new-event";

const base = { title: "Dentist", day: "2026-11-10", start: "", end: "", who: "", transactionId: "abc12345-6789" };

describe("an event added from the app (Phase 64b)", () => {
  it("all day: midnight to the next midnight in the household's zone", () => {
    const e = newEventSchema.parse(base);
    expect(newEventPayload(e, "America/New_York")).toEqual({
      subject: "Dentist",
      isAllDay: true,
      start: { dateTime: "2026-11-10T00:00:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-11-11T00:00:00", timeZone: "America/New_York" },
      transactionId: "abc12345-6789",
    });
  });

  it("timed, with who it's for before the title; no end means an hour", () => {
    const e = newEventSchema.parse({ ...base, start: "15:30", who: "Ivy" });
    expect(newEventPayload(e, "America/New_York")).toMatchObject({
      subject: "Ivy: Dentist",
      isAllDay: false,
      start: { dateTime: "2026-11-10T15:30:00" },
      end: { dateTime: "2026-11-10T16:30:00" },
    });
    expect(newEventPayload(newEventSchema.parse({ ...base, start: "23:30" }), "UTC").end.dateTime).toBe("2026-11-10T23:59:00");
  });

  it("refuses a missing title, a bad day, an end without a start or before it, and an odd id", () => {
    for (const bad of [
      { ...base, title: " " },
      { ...base, day: "2026-02-30" },
      { ...base, end: "10:00" },
      { ...base, start: "10:00", end: "09:00" },
      { ...base, transactionId: "x" },
    ]) {
      expect(newEventSchema.safeParse(bad).success).toBe(false);
    }
  });
});
