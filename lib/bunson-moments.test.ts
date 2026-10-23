import { describe, expect, it } from "vitest";
import { choreProgressFor, currentHour, greetingLine, personalChoreFact, timeOfDayGreeting } from "./bunson-moments";

describe("timeOfDayGreeting", () => {
  it.each([
    [2, "Up late"],
    [8, "Morning"],
    [13, "Afternoon"],
    [19, "Evening"],
  ])("%i → %s", (hour, word) => {
    expect(timeOfDayGreeting(hour)).toBe(word);
  });
});

describe("greetingLine", () => {
  it("counts stickers left", () => {
    expect(greetingLine("Ivy", 8, { pending: 3, done: 1, stickers: 15 })).toBe("Morning, Ivy! 15 stickers to grab today.");
    expect(greetingLine("Ivy", 8, { pending: 1, done: 0, stickers: 1 })).toBe("Morning, Ivy! 1 sticker to grab today.");
  });

  it("falls back to a chore count when the chores carry no points", () => {
    expect(greetingLine("Ivy", 8, { pending: 2, done: 0, stickers: 0 })).toBe("Morning, Ivy! 2 chores to do today.");
  });

  it("teases when everything is done", () => {
    expect(greetingLine("Rowan", 18, { pending: 0, done: 2 })).toContain("Show-off");
  });

  it("handles an empty day", () => {
    expect(greetingLine("Mom", 13, { pending: 0, done: 0 })).toContain("Nothing on your list today");
    expect(greetingLine("Mom", 13, null)).toBe("Afternoon, Mom! Good to see you.");
  });
});

describe("personalChoreFact", () => {
  it("nags about pending chores with the right pronoun", () => {
    expect(personalChoreFact("Ivy", { pending: 1, done: 0 })).toBe(
      "Psst, Ivy. 1 chore still waiting. I can see it from here. 👀",
    );
    expect(personalChoreFact("Ivy", { pending: 2, done: 0 })).toContain("see them");
  });

  it("is quiet when there is nothing assigned", () => {
    expect(personalChoreFact("Ivy", { pending: 0, done: 0 })).toBeNull();
  });
});

describe("currentHour", () => {
  it("reads the hour in the given zone", () => {
    const noonUtc = new Date("2026-10-03T12:00:00Z");
    expect(currentHour("UTC", noonUtc)).toBe(12);
    expect(currentHour("America/New_York", noonUtc)).toBe(8);
  });
});

describe("choreProgressFor", () => {
  it("counts only the person's own chores", () => {
    const me = { id: "me" };
    const other = { id: "other" };
    const pts = (points: number) => ({ points });
    const board = {
      overdue: [{ status: "PENDING", assignedTo: me, definition: pts(5) }],
      dueToday: [
        { status: "PENDING", assignedTo: me, definition: pts(3) },
        { status: "DONE", assignedTo: me, definition: pts(10) },
        { status: "PENDING", assignedTo: other, definition: pts(7) },
        { status: "PENDING", assignedTo: null, definition: pts(7) },
      ],
    };
    expect(choreProgressFor("me", board)).toEqual({ pending: 2, done: 1, stickers: 8 });
  });
});
