import { describe, expect, it } from "vitest";
import { DOSE_GRACE_MS, isMedLow, nextOn, planDates, planDoses, planMedLow, planSchool, type DoseRow, type MedRow } from "./plan";
import { daysLeftLabel, daysOfSupply, dosesPerDay } from "./supply";
import { clockText, inQuietHours, parseClock } from "./quiet";
import { grownUpsOf } from "./people";
import { listedKinds, nextOff } from "./prefs";

const NOW = new Date(2026, 10, 7, 10, 0);
const dad = { id: "dad" };
const mom = { id: "mom" };
const grownUps = [dad, mom];

describe("missed doses", () => {
  const dose = (over: Partial<DoseRow> = {}): DoseRow => ({
    definitionId: "def1",
    dueDate: new Date(2026, 10, 7, 8, 0),
    title: "Amoxicillin",
    timeLabel: "8:00 AM",
    timed: true,
    active: true,
    status: "PENDING",
    assignedTo: { id: "ivy", firstName: "Ivy" },
    ...over,
  });

  it("reminds the person it's for and the grown-ups, through quiet hours, keyed by the dose's time", () => {
    const [r] = planDoses([dose()], grownUps, NOW);
    expect(r).toMatchObject({ kind: "REMINDER_DOSE", recipients: ["ivy", "dad", "mom"], urgent: true, href: "/meds" });
    expect(r.title).toBe("Ivy's 8:00 AM dose of Amoxicillin wasn't marked");
    expect(r.key).toBe("dose:def1:2026-11-07:0800");
  });

  it("waits out the grace period, and lets a day-old one go", () => {
    expect(planDoses([dose({ dueDate: new Date(NOW.getTime() - DOSE_GRACE_MS + 60_000) })], grownUps, NOW)).toEqual([]);
    expect(planDoses([dose({ dueDate: new Date(NOW.getTime() - 25 * 60 * 60_000) })], grownUps, NOW)).toEqual([]);
  });

  it("skips taken, untimed and stopped medications; no one assigned goes to the grown-ups", () => {
    expect(planDoses([dose({ status: "DONE" }), dose({ timed: false }), dose({ active: false })], grownUps, NOW)).toEqual([]);
    const [r] = planDoses([dose({ assignedTo: null })], grownUps, NOW);
    expect(r.recipients).toEqual(["dad", "mom"]);
    expect(r.title).toBe("The 8:00 AM dose of Amoxicillin wasn't marked");
  });
});

describe("days of supply", () => {
  const base = { quantityOnHand: 30, doseAmount: 1, frequencyType: "DAILY", interval: 1, daysOfWeek: [] as number[], timesOfDay: ["08:00", "20:00"] };
  it("per schedule", () => {
    expect(dosesPerDay(base)).toBe(2);
    expect(dosesPerDay({ ...base, frequencyType: "INTERVAL_DAYS", interval: 2 })).toBe(1);
    expect(dosesPerDay({ ...base, frequencyType: "DAYS_OF_WEEK", daysOfWeek: [1, 3, 5], timesOfDay: ["08:00"] })).toBeCloseTo(3 / 7);
    expect(dosesPerDay({ ...base, frequencyType: "WEEKLY", timesOfDay: ["08:00"] })).toBeCloseTo(1 / 7);
    expect(dosesPerDay({ ...base, frequencyType: "MONTHLY" })).toBeNull();
    expect(daysOfSupply(base)).toBe(15);
    expect(daysOfSupply({ ...base, doseAmount: null })).toBeNull();
    expect(daysOfSupply({ ...base, quantityOnHand: null })).toBeNull();
  });

  const med = (over: Partial<MedRow> = {}): MedRow => ({ medicationId: "m1", title: "Vitamin D", active: true, refillThresholdQuantity: null, ...base, ...over });
  it("low at a week or less, or at the refill count", () => {
    expect(isMedLow(med({ quantityOnHand: 14 }))).toEqual({ low: true, days: 7, doses: null });
    expect(isMedLow(med({ quantityOnHand: 16 })).low).toBe(false);
    expect(isMedLow(med({ quantityOnHand: 40, refillThresholdQuantity: 40 })).low).toBe(true);
    expect(isMedLow(med({ quantityOnHand: 3, doseAmount: null })).low).toBe(false);
  });

  it("plans one per low med and lists the rest to forget", () => {
    const { reminders, notLow } = planMedLow([med({ quantityOnHand: 9 }), med({ medicationId: "m2", quantityOnHand: 60 }), med({ medicationId: "m3", active: false })], grownUps);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ key: "med:m1", recipients: ["dad", "mom"], title: "Vitamin D is running low (about 4 days left)" });
    expect(notLow).toEqual(["m2", "m3"]);
  });

  it("an as-needed medicine is low at a few doses, told in doses (Phase 65a)", () => {
    const prn = (quantityOnHand: number) => med({ frequencyType: "AS_NEEDED", timesOfDay: [], quantityOnHand, doseAmount: 2 });
    expect(isMedLow(prn(10))).toEqual({ low: true, days: null, doses: 5 });
    expect(isMedLow(prn(12)).low).toBe(false);
    expect(planMedLow([prn(6)], grownUps).reminders[0].title).toBe("Vitamin D is running low (about 3 doses left)");
    expect(daysLeftLabel({ ...base, frequencyType: "AS_NEEDED", quantityOnHand: 7, doseAmount: 2 })).toBe("3 doses left");
    expect(daysLeftLabel({ ...base, frequencyType: "AS_NEEDED", quantityOnHand: 1, doseAmount: 1 })).toBe("1 dose left");
    expect(daysLeftLabel({ ...base, frequencyType: "AS_NEEDED", quantityOnHand: 0.5, doseAmount: 1 })).toBeNull();
  });
});

describe("school", () => {
  const task = (dueDate: Date | null, owner: { id: string; adult: boolean } | null = null) => ({ id: "t1", title: "field trip form", dueDate, status: "OPEN", owner, kid: { firstName: "Max" } });
  it("today and tomorrow only, to the grown-up handling it or everyone", () => {
    const today = new Date(2026, 10, 7);
    const tomorrow = new Date(2026, 10, 8);
    expect(planSchool([task(today)], grownUps, NOW)[0]).toMatchObject({ title: "Max's field trip form is due today", recipients: ["dad", "mom"], key: "school:t1:2026-11-07" });
    expect(planSchool([task(tomorrow, { id: "mom", adult: true })], grownUps, NOW)[0]).toMatchObject({ title: "Max's field trip form is due tomorrow", recipients: ["mom"] });
    expect(planSchool([task(tomorrow, { id: "ivy", adult: false })], grownUps, NOW)[0].recipients).toEqual(["dad", "mom"]);
    expect(planSchool([task(new Date(2026, 10, 9)), task(new Date(2026, 10, 6)), task(null)], grownUps, NOW)).toEqual([]);
  });
});

describe("birthdays and anniversaries", () => {
  const date = (month: number, day: number, type = "BIRTHDAY", personId = "grandma") => ({ id: `d-${month}-${day}`, type, month, day, year: null, person: { id: personId, firstName: "Grandma" } });
  it("within a week, never to the person it's about, wrapping the year", () => {
    expect(planDates([date(11, 10)], grownUps, NOW)[0]).toMatchObject({ title: "Grandma's birthday is in 3 days", key: "date:d-11-10:2026-11-10", recipients: ["dad", "mom"] });
    expect(planDates([date(11, 7, "ANNIVERSARY")], grownUps, NOW)[0].title).toBe("Grandma's anniversary is today");
    expect(planDates([date(11, 15), date(11, 6), date(11, 8, "OTHER")], grownUps, NOW)).toEqual([]);
    expect(planDates([date(11, 8, "BIRTHDAY", "dad")], grownUps, NOW)[0].recipients).toEqual(["mom"]);
    expect(nextOn({ month: 1, day: 2 }, new Date(2026, 11, 30, 9)).getFullYear()).toBe(2027);
  });

  it("Feb 29 falls on Feb 28 in other years; a date for a year to come waits", () => {
    const feb = new Date(2027, 1, 25, 9);
    expect(nextOn({ month: 2, day: 29 }, feb)).toEqual(new Date(2027, 1, 28));
    expect(planDates([{ ...date(2, 29), id: "leap" }], grownUps, feb)[0]).toMatchObject({ title: "Grandma's birthday is in 3 days", key: "date:leap:2027-02-28" });
    expect(planDates([{ ...date(11, 10, "ANNIVERSARY"), year: 2027 }], grownUps, NOW)).toEqual([]);
  });
});

describe("quiet hours", () => {
  it("a window, one that wraps midnight, and none", () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m);
    const night = { quietStart: 21 * 60, quietEnd: 7 * 60 };
    expect(inQuietHours(night, at(22))).toBe(true);
    expect(inQuietHours(night, at(6, 59))).toBe(true);
    expect(inQuietHours(night, at(7))).toBe(false);
    expect(inQuietHours({ quietStart: 13 * 60, quietEnd: 14 * 60 }, at(13, 30))).toBe(true);
    expect(inQuietHours({ quietStart: null, quietEnd: null }, at(23))).toBe(false);
    expect(inQuietHours(null, at(23))).toBe(false);
    expect(parseClock("21:30")).toBe(1290);
    expect(parseClock("25:00")).toBeNull();
    expect(clockText(1290)).toBe("21:30");
  });
});

describe("grown-ups", () => {
  it("adults and admins whose access hasn't ended", () => {
    const rows = [
      { id: "dad", role: "ADMIN", entraAccessEndedAt: null },
      { id: "mom", role: "ADULT", entraAccessEndedAt: null },
      { id: "ivy", role: "KID", entraAccessEndedAt: null },
      { id: "gone", role: "ADULT", entraAccessEndedAt: new Date() },
    ];
    expect(grownUpsOf(rows).map((p) => p.id)).toEqual(["dad", "mom"]);
  });
});

describe("reminder settings", () => {
  it("lists only kinds whose app is on, and keeps hidden kinds' switches when saving", () => {
    expect(listedKinds((app) => app === "meds").map((k) => k.kind)).toEqual(["REMINDER_DOSE", "REMINDER_MED_LOW", "REMINDER_DATE"]);
    expect(listedKinds((app) => app === "cars").map((k) => k.kind)).toEqual(["REMINDER_DATE", "REMINDER_CAR", "REMINDER_RECALL"]);
    // School off (hidden) stays as it was; of the listed ones, only what's unticked is off.
    expect(nextOff(["REMINDER_SCHOOL", "REMINDER_DOSE"], ["REMINDER_DOSE", "REMINDER_MED_LOW", "REMINDER_DATE"], new Set(["REMINDER_DOSE", "REMINDER_DATE"]))).toEqual(["REMINDER_MED_LOW", "REMINDER_SCHOOL"]);
  });
});


describe("miles a day", () => {
  it("needs two readings two weeks apart in the last 90 days, and miles that went up", async () => {
    const { milesPerDay, daysUntilMiles } = await import("@/lib/vehicles/mileage");
    const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
    expect(milesPerDay([{ at: d(30), mileage: 10_000 }, { at: d(0), mileage: 10_900 }], NOW)).toBeCloseTo(30);
    expect(milesPerDay([{ at: d(10), mileage: 10_000 }, { at: d(0), mileage: 10_300 }], NOW)).toBeNull();
    expect(milesPerDay([{ at: d(200), mileage: 1_000 }, { at: d(0), mileage: 9_000 }], NOW)).toBeNull();
    expect(milesPerDay([{ at: d(30), mileage: 10_900 }, { at: d(0), mileage: 10_000 }], NOW)).toBeNull();
    // An extra digit typed on the last fill-up isn't 13,000 miles a day.
    expect(milesPerDay([{ at: d(30), mileage: 44_000 }, { at: d(0), mileage: 440_000 }], NOW)).toBeNull();
    expect(daysUntilMiles(150, 30)).toBe(5);
    expect(daysUntilMiles(150, null)).toBeNull();
  });
});

describe("cars and recalls", () => {
  it("overdue once per cycle, due within a week by date or by miles, never-logged left out", async () => {
    const { planCars } = await import("./plan");
    const item = (over: object) => ({ itemId: "i1", title: "Oil change", vehicle: { id: "v1", name: "van" }, status: "OK" as const, daysRemaining: null, milesRemaining: null, daysByMiles: null, cycle: "45000", ...over });
    expect(planCars([item({ status: "OVERDUE" })], grownUps)[0]).toMatchObject({ title: "Oil change on the van is overdue", key: "car:i1:45000:overdue", href: "/vehicles/v1" });
    // Due soon, then overdue: two keys, so both remind.
    expect(planCars([item({ status: "UPCOMING", daysRemaining: 5 })], grownUps)[0]).toMatchObject({ title: "Oil change on the van is due in 5 days", key: "car:i1:45000" });
    expect(planCars([item({ status: "UPCOMING", daysRemaining: 1 })], grownUps)[0].title).toBe("Oil change on the van is due in 1 day");
    expect(planCars([item({ status: "UPCOMING", milesRemaining: 120, daysByMiles: 4 })], grownUps)[0].title).toBe("Oil change on the van is due in about 4 days");
    expect(planCars([item({ status: "UPCOMING", daysRemaining: 20, daysByMiles: 12 }), item({ status: "UNKNOWN" })], grownUps)).toEqual([]);
  });

  it("a recall that says not to drive comes through quiet hours", async () => {
    const { planRecalls } = await import("./plan");
    const [r] = planRecalls([{ vehicle: { id: "v1", name: "van" }, campaignNumber: "26V123", component: "AIR BAGS:FRONTAL", parkIt: true }], grownUps);
    expect(r).toMatchObject({ key: "recall:v1:26V123", urgent: true, title: "A safety recall for the van says not to drive it (air bags)" });
    const [blank] = planRecalls([{ vehicle: { id: "v1", name: "van" }, campaignNumber: "26V124", component: "", parkIt: false }], grownUps);
    expect(blank.title).toBe("A safety recall for the van: details on its page");
  });
});

describe("morning summary", () => {
  it("lines for what's on, nothing when there's nothing", async () => {
    const { digestLines } = await import("./digest");
    expect(digestLines({ choresMine: 2, choresAll: 5, dosesMine: 0, dosesAll: 1, school: ["Max's field trip form is due today"], cars: [], dates: ["Grandma's birthday is in 3 days"] })).toEqual([
      "Chores today: 2 for you, 5 chores in all",
      "Doses today: 1 dose in all",
      "Max's field trip form is due today",
      "Grandma's birthday is in 3 days",
    ]);
    expect(digestLines({ choresMine: 0, choresAll: 0, dosesMine: 0, dosesAll: 0, school: [], cars: [], dates: [] })).toBeNull();
  });

  it("from 7:00, once a day, not in quiet hours", async () => {
    const { digestDue } = await import("./digest");
    const p = { digestLastOn: null, quietStart: null, quietEnd: null };
    expect(digestDue(p, "2026-11-07", new Date(2026, 10, 7, 6, 59))).toBe(false);
    expect(digestDue(p, "2026-11-07", new Date(2026, 10, 7, 7, 0))).toBe(true);
    expect(digestDue({ ...p, digestLastOn: "2026-11-07" }, "2026-11-07", new Date(2026, 10, 7, 9))).toBe(false);
    expect(digestDue({ ...p, quietStart: 21 * 60, quietEnd: 8 * 60 }, "2026-11-07", new Date(2026, 10, 7, 7, 30))).toBe(false);
  });

  it("days left in words", async () => {
    const { daysLeftLabel } = await import("./supply");
    const base = { quantityOnHand: 10, doseAmount: 1, frequencyType: "DAILY", interval: 1, daysOfWeek: [] as number[], timesOfDay: ["08:00"] };
    expect(daysLeftLabel(base)).toBe("about 10 days left");
    expect(daysLeftLabel({ ...base, quantityOnHand: 1.5 })).toBe("about 1 day left");
    expect(daysLeftLabel({ ...base, quantityOnHand: 0.5 })).toBe("less than a day left");
    expect(daysLeftLabel({ ...base, doseAmount: null })).toBeNull();
  });
});
