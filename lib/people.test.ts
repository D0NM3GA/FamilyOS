import { describe, expect, it } from "vitest";
import {
  pickStaleContacts,
  DEFAULT_CONTACT_CADENCE_DAYS,
  viewRelationship,
  INVERSE_RELATIONSHIP,
  interactionTime,
  dayInZone,
} from "./people";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// Wider than pickStaleContacts' own constraint on purpose: the regression test below checks
// that extra fields like firstName survive the generic, so the fixture has to carry them.
type ContactRow = {
  id: string;
  firstName: string;
  lastContactedAt: Date | null;
  createdAt: Date;
  contactCadenceDays: number | null;
  isHouseholdMember: boolean;
};

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "p1",
    firstName: "Jane",
    lastContactedAt: null,
    createdAt: daysAgo(365),
    contactCadenceDays: null,
    isHouseholdMember: false,
    ...overrides,
  };
}

describe("pickStaleContacts", () => {
  it("excludes a household member with no cadence override, regardless of lastContactedAt", () => {
    const kid = contact({ id: "kid", isHouseholdMember: true, lastContactedAt: null });
    expect(pickStaleContacts([kid], NOW)).toEqual([]);
  });

  it("includes a household member who has an explicit cadence override", () => {
    const kidAwayAtCollege = contact({
      id: "kid",
      isHouseholdMember: true,
      contactCadenceDays: 7,
      lastContactedAt: daysAgo(10),
    });
    const result = pickStaleContacts([kidAwayAtCollege], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("kid");
  });

  it("anchors a never-contacted household member (with an override) on createdAt, not lastContactedAt", () => {
    const kidAwayAtCollege = contact({
      id: "kid",
      isHouseholdMember: true,
      contactCadenceDays: 7,
      lastContactedAt: null,
      createdAt: daysAgo(10),
    });
    const result = pickStaleContacts([kidAwayAtCollege], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].daysSinceContact).toBe(10);
  });

  it("does NOT surface a freshly-added external contact still within the default cadence", () => {
    const justAdded = contact({ id: "c1", lastContactedAt: null, createdAt: daysAgo(2) });
    expect(pickStaleContacts([justAdded], NOW)).toEqual([]);
  });

  it("surfaces a never-contacted external contact anchored on createdAt once past cadence", () => {
    // This is the card's core case, not an edge case — most contacts are never explicitly
    // "logged," so anchoring only opted-in rows would leave the feature almost never firing.
    const opted = contact({ id: "c1", lastContactedAt: null, createdAt: daysAgo(30) });
    const result = pickStaleContacts([opted], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].daysSinceContact).toBe(30);
  });

  it("preserves the original row's fields (regression guard: T must not collapse to the constraint)", () => {
    const c = contact({ id: "c1", firstName: "Aunt Jane", lastContactedAt: daysAgo(30) });
    const result = pickStaleContacts([c], NOW);
    expect(result[0].firstName).toBe("Aunt Jane");
  });

  it("excludes a contact within their cadence and includes one past it", () => {
    const recent = contact({ id: "recent", lastContactedAt: daysAgo(5) }); // default cadence 21
    const overdue = contact({ id: "overdue", lastContactedAt: daysAgo(30) });
    const result = pickStaleContacts([recent, overdue], NOW);
    expect(result.map((p) => p.id)).toEqual(["overdue"]);
  });

  it("includes exactly at the cadence boundary (>=, not >)", () => {
    const atBoundary = contact({ id: "c1", lastContactedAt: daysAgo(DEFAULT_CONTACT_CADENCE_DAYS) });
    expect(pickStaleContacts([atBoundary], NOW)).toHaveLength(1);

    const oneDayShort = contact({ id: "c2", lastContactedAt: daysAgo(DEFAULT_CONTACT_CADENCE_DAYS - 1) });
    expect(pickStaleContacts([oneDayShort], NOW)).toEqual([]);
  });

  it("respects a per-contact cadence override", () => {
    const checkInWeekly = contact({ id: "c1", contactCadenceDays: 7, lastContactedAt: daysAgo(10) });
    const result = pickStaleContacts([checkInWeekly], NOW);
    expect(result).toHaveLength(1);
  });

  it("sorts most-overdue-relative-to-cadence first", () => {
    const barelyOverdue = contact({
      id: "barely",
      contactCadenceDays: DEFAULT_CONTACT_CADENCE_DAYS,
      lastContactedAt: daysAgo(22), // 1 day past cadence
    });
    const wayOverdue = contact({
      id: "way",
      contactCadenceDays: 7,
      lastContactedAt: daysAgo(30), // 23 days past cadence
    });
    const result = pickStaleContacts([barelyOverdue, wayOverdue], NOW);
    expect(result.map((p) => p.id)).toEqual(["way", "barely"]);
  });

  it("breaks ties deterministically by preserving input order (stable sort)", () => {
    const a = contact({ id: "a", lastContactedAt: daysAgo(30) });
    const b = contact({ id: "b", lastContactedAt: daysAgo(30) });
    const c = contact({ id: "c", lastContactedAt: daysAgo(30) });
    expect(pickStaleContacts([a, b, c], NOW).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(pickStaleContacts([c, b, a], NOW).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("excludes the given excludeId", () => {
    const overdue = contact({ id: "self", lastContactedAt: daysAgo(30) });
    expect(pickStaleContacts([overdue], NOW, { excludeId: "self" })).toEqual([]);
  });

  it("caps at the given limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      contact({ id: `c${i}`, lastContactedAt: daysAgo(30) }),
    );
    expect(pickStaleContacts(rows, NOW, { limit: 3 })).toHaveLength(3);
  });
});

describe("viewRelationship", () => {
  const dad = { id: "dad", firstName: "Dad", lastName: null };
  const kid = { id: "kid", firstName: "Kid", lastName: "One" };

  function row(type: keyof typeof INVERSE_RELATIONSHIP, label: string | null = null) {
    return { id: "r1", fromId: dad.id, type, label, from: dad, to: kid };
  }

  it.each([
    ["SPOUSE", "SPOUSE"],
    ["PARENT", "CHILD"],
    ["CHILD", "PARENT"],
    ["SIBLING", "SIBLING"],
  ] as const)("originating side sees %s as-is; other side sees its inverse %s", (stored, inverse) => {
    const r = row(stored);
    expect(viewRelationship(r, dad.id)).toMatchObject({ otherPerson: kid, type: stored, label: null });
    expect(viewRelationship(r, kid.id)).toMatchObject({ otherPerson: dad, type: inverse, label: null });
  });

  it("keeps an OTHER label as-authored on the originating side", () => {
    const r = row("OTHER", "Godmother");
    expect(viewRelationship(r, dad.id)).toMatchObject({ type: "OTHER", label: "Godmother" });
  });

  it("recomposes an OTHER label on the far side instead of showing it verbatim", () => {
    // "Godmother" is true of dad->kid, not kid->dad — showing the bare word on kid's page
    // would claim kid is Dad's godmother, which is backwards.
    const r = row("OTHER", "Godmother");
    const view = viewRelationship(r, kid.id);
    expect(view.type).toBe("OTHER");
    expect(view.label).toBe("Godmother of Dad");
  });
});

describe("interactionTime", () => {
  const NY = "America/New_York";
  // 9:30pm in New York on Oct 9 is already Oct 10 in UTC, where the server may run.
  const now = new Date("2026-10-10T01:30:00Z");
  it("blank or the family's today is right now", () => {
    expect(dayInZone(now, NY)).toBe("2026-10-09");
    expect(interactionTime(null, now, NY)).toBe(now);
    expect(interactionTime("2026-10-09", now, NY)).toBe(now);
  });
  it("an earlier day is midday that day, in the family's zone", () => {
    expect(interactionTime("2026-10-08", now, NY)).toEqual(new Date("2026-10-08T16:00:00Z"));
    expect(interactionTime("2026-01-15", now, NY)).toEqual(new Date("2026-01-15T17:00:00Z"));
    expect(interactionTime("2026-10-08", now, "UTC")).toEqual(new Date("2026-10-08T12:00:00Z"));
  });
  it("refuses the family's tomorrow, impossible days and the distant past", () => {
    expect(interactionTime("2026-10-10", now, NY)).toBeNull();
    expect(interactionTime("2026-02-30", now, NY)).toBeNull();
    expect(interactionTime("1899-12-31", now, NY)).toBeNull();
  });
});
