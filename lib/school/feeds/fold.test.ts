import { describe, expect, it } from "vitest";
import { foldFeedEvents } from "./fold";
import { feedForWords, feedKids } from "./scope";

const at = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h));
const ev = (title: string, extra: Partial<Parameters<typeof foldFeedEvents>[0][number]> = {}) => ({
  title,
  startsAt: at(11),
  endsAt: at(12),
  allDay: true,
  family: false,
  whoIds: [] as string[],
  whoNames: [] as string[],
  ...extra,
});

describe("one event from two feeds", () => {
  it("two kids' feeds: once, for both", () => {
    const out = foldFeedEvents([ev("Veterans Day", { whoIds: ["ivy"], whoNames: ["Ivy"] }), ev("veterans  day ", { whoIds: ["max"], whoNames: ["Max"] })]);
    expect(out).toHaveLength(1);
    expect(out[0].whoIds).toEqual(["ivy", "max"]);
    expect(out[0].whoNames).toEqual(["Ivy", "Max"]);
  });

  it("a family feed's copy makes it the family's", () => {
    const out = foldFeedEvents([ev("Snow Day", { whoIds: ["ivy"], whoNames: ["Ivy"] }), ev("Snow Day", { family: true })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ family: true, whoIds: [], whoNames: [] });
  });

  it("a different end, start or all-day flag is another event", () => {
    const out = foldFeedEvents([ev("Concert"), ev("Concert", { endsAt: at(13) }), ev("Concert", { allDay: false, startsAt: at(11, 18), endsAt: at(11, 19) })]);
    expect(out).toHaveLength(3);
  });
});

describe("who a feed is for", () => {
  const kid = (id: string, firstName: string) => ({ person: { id, firstName } });
  it("the family, its kids by name, or nobody yet", () => {
    expect(feedForWords({ forFamily: true, name: "District", kids: [] })).toBe("Whole family");
    expect(feedForWords({ forFamily: false, name: "School", kids: [kid("m", "Max"), kid("i", "Ivy")] })).toBe("Ivy & Max");
    expect(feedForWords({ forFamily: false, name: "School", kids: [] })).toBe("Nobody's yet");
    expect(feedKids({ forFamily: true, name: "District", kids: [kid("i", "Ivy")] })).toEqual({ ids: [], names: [] });
  });
});
