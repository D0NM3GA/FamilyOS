import { describe, expect, test } from "vitest";
import { canSeeCalendar, shapeCopiedEvents, type CopiedRow } from "./view";
import { pickMailbox } from "./mailbox";

const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
const row = (extra: Partial<CopiedRow>): CopiedRow => ({
  calendarId: "c",
  kind: "PERSON",
  personId: "dad",
  graphId: Math.random().toString(36),
  iCalUId: null,
  title: "Thing",
  location: null,
  startsAt: at(15),
  endsAt: at(16),
  allDay: false,
  isPrivate: false,
  ...extra,
});
const names = new Map([
  ["dad", "Dad"],
  ["mom", "Mom"],
  ["ivy", "Ivy"],
]);
const kid = { id: "ivy", adult: false };
const grownUp = { id: "mom", adult: true };

describe("who sees which calendar", () => {
  test("the family's to everyone; someone's own to them and the grown-ups", () => {
    expect(canSeeCalendar("FAMILY", "dad", kid)).toBe(true);
    expect(canSeeCalendar("PERSON", "ivy", kid)).toBe(true);
    expect(canSeeCalendar("PERSON", "dad", kid)).toBe(false);
    expect(canSeeCalendar("PERSON", "ivy", grownUp)).toBe(true);
  });

  test("a kid's view leaves out a grown-up's own calendar", () => {
    const rows = [row({ kind: "FAMILY", title: "Dinner at Grandma's" }), row({ personId: "dad", title: "Work trip" }), row({ personId: "ivy", calendarId: "i", title: "Soccer" })];
    expect(shapeCopiedEvents(rows, kid, names).map((e) => e.subject)).toEqual(["Dinner at Grandma's", "Soccer"]);
  });
});

describe("shapeCopiedEvents", () => {
  test("private shows Busy to others and Private to its own person", () => {
    const rows = [row({ personId: "dad", isPrivate: true, title: null })];
    expect(shapeCopiedEvents(rows, grownUp, names)[0].subject).toBe("Busy");
    expect(shapeCopiedEvents(rows, { id: "dad", adult: true }, names)[0].subject).toBe("Private");
  });

  test("a private event in the family calendar is Busy to everyone but its mailbox's person", () => {
    const rows = [row({ kind: "FAMILY", personId: "mom", isPrivate: true, title: null })];
    expect(shapeCopiedEvents(rows, kid, names)[0].subject).toBe("Busy");
    expect(shapeCopiedEvents(rows, grownUp, names)[0].subject).toBe("Private");
  });

  test("someone's own event carries their name and id", () => {
    const [e] = shapeCopiedEvents([row({ personId: "ivy", title: "Soccer" })], grownUp, names);
    expect(e).toMatchObject({ who: "Ivy", whoId: "ivy" });
  });

  test("the same meeting in the family calendar and someone's own shows once, as the family's", () => {
    const rows = [row({ personId: "dad", iCalUId: "m1", title: "Parent night" }), row({ kind: "FAMILY", personId: "mom", calendarId: "f", iCalUId: "m1", title: "Parent night" })];
    const shaped = shapeCopiedEvents(rows, grownUp, names);
    expect(shaped).toHaveLength(1);
    expect(shaped[0]).toMatchObject({ who: null, whoId: null });
  });

  test("one meeting in two people's own calendars joins their names", () => {
    const rows = [row({ personId: "dad", iCalUId: "m2" }), row({ personId: "mom", calendarId: "m", iCalUId: "m2" })];
    const [e] = shapeCopiedEvents(rows, grownUp, names);
    expect(e).toMatchObject({ who: "Dad & Mom", whoId: null });
  });

  test("a different start or all-day flag isn't the same meeting", () => {
    const rows = [row({ iCalUId: "m3" }), row({ personId: "mom", iCalUId: "m3", startsAt: at(17), endsAt: at(18) }), row({ personId: "mom", iCalUId: "m3", allDay: true })];
    expect(shapeCopiedEvents(rows, grownUp, names)).toHaveLength(3);
  });

  test("a private copy and a public copy of one meeting show the public title", () => {
    const rows = [row({ personId: "dad", iCalUId: "m4", isPrivate: true, title: null }), row({ kind: "FAMILY", personId: "dad", iCalUId: "m4", title: "Recital" })];
    expect(shapeCopiedEvents(rows, kid, names)[0].subject).toBe("Recital");
  });

  test("soonest first", () => {
    const rows = [row({ title: "Late", startsAt: at(20), endsAt: at(21) }), row({ title: "Early", startsAt: at(8), endsAt: at(9) })];
    expect(shapeCopiedEvents(rows, grownUp, names).map((e) => e.subject)).toEqual(["Early", "Late"]);
  });
});

describe("pickMailbox", () => {
  test("a Microsoft sign-in's object id first, then the People page email", () => {
    expect(pickMailbox("0F8FAD5B-D9CB-469F-A165-70867728950E", "dad@example.com")).toEqual({ mailbox: "0f8fad5b-d9cb-469f-a165-70867728950e", from: "microsoft" });
    expect(pickMailbox(null, " Ivy@Example.com ")).toEqual({ mailbox: "ivy@example.com", from: "email" });
    expect(pickMailbox("not-a-guid", null)).toBeNull();
    expect(pickMailbox(null, "nope")).toBeNull();
  });
});
