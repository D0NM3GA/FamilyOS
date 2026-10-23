import { describe, expect, it } from "vitest";
import { buildDesiredEvents, syncOptionsWithApps, type SyncSources } from "./events";
import { hasCalendarWriteScope, planSync, type LinkState } from "./plan";

const ALL = { includeDates: true, includeVehicles: true, includeChores: true, includeMeds: true, includeSchoolTasks: true, includeAssignments: true };
const ZONES = { allDay: "America/Los_Angeles", timed: "America/New_York" };

const sources = (over: Partial<SyncSources> = {}): SyncSources => ({ dates: [], vehicles: [], tasks: [], school: [], ...over });

describe("buildDesiredEvents", () => {
  it("a birthday is a yearly all-day series in the household zone", () => {
    const [e] = buildDesiredEvents(
      sources({ dates: [{ id: "d1", type: "BIRTHDAY", label: null, month: 5, day: 3, year: 2018, personName: "Kid One" }] }),
      ALL,
      ZONES,
    );
    expect(e.sourceKey).toBe("date:d1");
    expect(e.payload.subject).toBe("🎂 Kid One's birthday");
    expect(e.payload).toMatchObject({
      isAllDay: true,
      start: { dateTime: "2018-05-03T00:00:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2018-05-04T00:00:00", timeZone: "America/Los_Angeles" },
      recurrence: { pattern: { type: "absoluteYearly", month: 5, dayOfMonth: 3 }, range: { type: "noEnd", startDate: "2018-05-03" } },
    });
  });

  it("an unknown year or a Feb 29 in a non-leap year starts the series in 2024", () => {
    const events = buildDesiredEvents(
      sources({
        dates: [
          { id: "a", type: "ANNIVERSARY", label: null, month: 12, day: 31, year: null, personName: "Mom" },
          { id: "b", type: "BIRTHDAY", label: null, month: 2, day: 29, year: 2023, personName: "Leap" },
        ],
      }),
      ALL,
      ZONES,
    );
    expect(events[0].payload.start.dateTime).toBe("2024-12-31T00:00:00");
    expect(events[0].payload.end.dateTime).toBe("2025-01-01T00:00:00"); // end crosses the year
    expect(events[1].payload.recurrence?.range.startDate).toBe("2024-02-29");
  });

  it("the hash doesn't change from one day to the next", () => {
    const src = sources({ dates: [{ id: "d", type: "OTHER", label: "Gotcha day", month: 7, day: 4, year: null, personName: "Rex" }] });
    expect(buildDesiredEvents(src, ALL, ZONES)[0].hash).toBe(buildDesiredEvents(src, ALL, ZONES)[0].hash);
    expect(buildDesiredEvents(src, ALL, ZONES)[0].payload.subject).toBe("📅 Gotcha day: Rex");
  });

  it("a vehicle item is all-day on its due date", () => {
    const [e] = buildDesiredEvents(
      sources({ vehicles: [{ itemId: "i", title: "Oil change", vehicleName: "Van", dueByDate: new Date(2026, 9, 1) }] }),
      ALL,
      ZONES,
    );
    expect(e).toMatchObject({ sourceKey: "vehicle:i", payload: { subject: "🔧 Van: Oil change due", isAllDay: true, start: { dateTime: "2026-10-01T00:00:00" } } });
  });

  it("a timed chore is 30 minutes of server-zone wall clock; an untimed one is all-day", () => {
    const [timed, untimed] = buildDesiredEvents(
      sources({
        tasks: [
          { id: "t1", domain: "CHORE", title: "Dishes", dueDate: new Date(2026, 8, 25, 18, 45), timed: true, assigneeName: "Kid One" },
          { id: "t2", domain: "CHORE", title: "Trash", dueDate: new Date(2026, 8, 26), timed: false, assigneeName: null },
        ],
      }),
      ALL,
      ZONES,
    );
    expect(timed.payload).toMatchObject({
      subject: "🧹 Dishes (Kid One)",
      isAllDay: false,
      start: { dateTime: "2026-09-25T18:45:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-09-25T19:15:00", timeZone: "America/New_York" },
    });
    expect(untimed.payload).toMatchObject({ subject: "🧹 Trash", isAllDay: true, start: { timeZone: "America/Los_Angeles" } });
  });

  it("follows the category toggles", () => {
    const src = sources({
      dates: [{ id: "d", type: "BIRTHDAY", label: null, month: 1, day: 1, year: null, personName: "A" }],
      tasks: [
        { id: "c", domain: "CHORE", title: "C", dueDate: new Date(2026, 0, 1), timed: false, assigneeName: null },
        { id: "m", domain: "MED", title: "M", dueDate: new Date(2026, 0, 1), timed: false, assigneeName: null },
      ],
    });
    const keys = buildDesiredEvents(src, { ...ALL, includeChores: false, includeMeds: false }, ZONES).map((e) => e.sourceKey);
    expect(keys).toEqual(["date:d"]);
  });

  it("school to-dos and homework are all-day on their due date, each behind its own toggle", () => {
    const src = sources({
      school: [
        { id: "t", kind: "task", title: "Field trip slip", dueDate: new Date(2026, 9, 2), who: "Kid One" },
        { id: "a", kind: "assignment", title: "Math: Ch 3", dueDate: new Date(2026, 9, 3), who: "Kid One" },
      ],
    });
    const events = buildDesiredEvents(src, ALL, ZONES);
    expect(events.map((e) => [e.sourceKey, e.payload.subject, e.payload.isAllDay])).toEqual([
      ["school:t", "🎒 Field trip slip (Kid One)", true],
      ["assignment:a", "📝 Math: Ch 3 (Kid One)", true],
    ]);
    expect(buildDesiredEvents(src, { ...ALL, includeAssignments: false }, ZONES).map((e) => e.sourceKey)).toEqual(["school:t"]);
  });

  it("event text carries no notes, only the managed-by footer", () => {
    const [e] = buildDesiredEvents(sources({ dates: [{ id: "d", type: "BIRTHDAY", label: null, month: 1, day: 1, year: null, personName: "A" }] }), ALL, ZONES);
    expect(e.payload.body.content).toMatch(/^Added by your family app/);
    expect(e.payload).toMatchObject({ showAs: "free", isReminderOn: false });
  });
});

describe("syncOptionsWithApps (Phase 36)", () => {
  it("leaves out turned-off apps whatever the Outlook page says, and nothing else", () => {
    expect(syncOptionsWithApps(ALL, [])).toEqual(ALL);
    expect(syncOptionsWithApps(ALL, ["chores", "school"])).toEqual({ ...ALL, includeChores: false, includeSchoolTasks: false, includeAssignments: false });
    expect(syncOptionsWithApps(ALL, ["meds", "cars", "money", "store"])).toEqual({ ...ALL, includeMeds: false, includeVehicles: false });
  });

  it("never turns on what the family left unticked", () => {
    const none = { ...ALL, includeChores: false, includeMeds: false };
    expect(syncOptionsWithApps(none, [])).toEqual(none);
  });

  it("keeps the sync row's other fields (it's passed the whole row)", () => {
    expect(syncOptionsWithApps({ ...ALL, id: "s1" }, ["chores"])).toMatchObject({ id: "s1", includeChores: false });
  });

  it("a turned-off app's events drop out of what the calendar should hold", () => {
    const due = new Date(2026, 9, 20);
    const src = sources({
      tasks: [{ id: "t1", domain: "CHORE", title: "Trash", dueDate: due, timed: false, assigneeName: null }],
      vehicles: [{ itemId: "v1", title: "Oil", vehicleName: "Van", dueByDate: due }],
    });
    expect(buildDesiredEvents(src, syncOptionsWithApps(ALL, ["chores"]), ZONES).map((e) => e.sourceKey)).toEqual(["vehicle:v1"]);
  });
});

describe("planSync", () => {
  const ev = (key: string, hash = "h1") => ({ sourceKey: key, hash, payload: {} as never });
  const link = (key: string, over: Partial<LinkState> = {}): LinkState => ({ sourceKey: key, graphEventId: `g-${key}`, contentHash: "h1", transactionId: `t-${key}`, ...over });

  it("creates new, updates changed, deletes gone, leaves the rest", () => {
    const { ops } = planSync([ev("a"), ev("b", "h2"), ev("c")], [link("b"), link("c"), link("d")], 60);
    expect(ops.map((o) => `${o.kind}:${"event" in o ? o.event.sourceKey : o.sourceKey}`)).toEqual(["delete:d", "create:a", "update:b"]);
  });

  it("retries an unfinished create with its original transactionId", () => {
    const { ops } = planSync([ev("a")], [link("a", { graphEventId: null })], 60);
    expect(ops).toEqual([{ kind: "create", event: ev("a"), transactionId: "t-a" }]);
  });

  it("caps a run and reports what's left", () => {
    const { ops, remaining } = planSync(["a", "b", "c"].map((k) => ev(k)), [], 2);
    expect(ops).toHaveLength(2);
    expect(remaining).toBe(1);
  });
});

describe("hasCalendarWriteScope", () => {
  it("reads better-auth's stored scope string", () => {
    expect(hasCalendarWriteScope("openid,profile,Calendars.ReadWrite,Mail.Read")).toBe(true);
    expect(hasCalendarWriteScope("https://graph.microsoft.com/Calendars.ReadWrite offline_access")).toBe(true);
    expect(hasCalendarWriteScope("openid,Calendars.Read,Calendars.Read.Shared")).toBe(false);
    expect(hasCalendarWriteScope(null)).toBe(false);
  });
});
