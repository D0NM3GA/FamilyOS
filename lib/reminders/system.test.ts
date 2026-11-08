import { describe, expect, it } from "vitest";
import { planSystem } from "./plan";
import { digestLines } from "./digest";
import { listedKinds } from "./prefs";

/** Phase 67b: admins hear when a background job or the nightly backup stops. */
const NOW = new Date("2026-11-08T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() - n * 60_000);
const jobs = [
  { name: "money", label: "Money syncs and alerts" },
  { name: "entra", label: "Microsoft access check" },
  { name: "zone", label: "Household clock" },
];
const row = (name: string, lastOkAt: Date | null, lastErrorAt: Date | null = null) => ({ name, lastOkAt, lastErrorAt, lastError: null, detail: null });
const admins = [{ id: "dad" }];

describe("planSystem", () => {
  it("reminds about a failing or late job and a late backup, not a healthy or never-run one", () => {
    const plans = planSystem(
      [row("money", minutes(60), minutes(5)), row("entra", minutes(200)), row("zone", minutes(10)), row("backup", minutes(40 * 60))],
      jobs,
      admins,
      NOW,
    );
    expect(plans.map((p) => p.key)).toEqual([
      `system:money:failing:${minutes(60).toISOString()}`,
      `system:entra:late:${minutes(200).toISOString()}`,
      `system:backup:late:${minutes(40 * 60).toISOString()}`,
    ]);
    expect(plans.every((p) => p.kind === "REMINDER_SYSTEM" && p.href === "/data#system" && !p.urgent && p.recipients.join() === "dad")).toBe(true);
    expect(plans[0].title).toMatch(/^⚠️ Money syncs and alerts stopped working; it last worked /);
    expect(plans[2].title).toMatch(/^⚠️ The nightly backup hasn't run since /);
  });

  it("keeps the same key while a job keeps failing, so it reminds once", () => {
    const first = planSystem([row("money", minutes(60), minutes(30))], jobs, admins, NOW);
    const later = planSystem([row("money", minutes(60), minutes(1))], jobs, admins, NOW);
    expect(first[0].key).toBe(later[0].key);
  });

  it("a backup that never ran, and no admins, remind nobody", () => {
    expect(planSystem([], jobs, admins, NOW)).toEqual([]);
    expect(planSystem([row("money", minutes(60), minutes(5))], jobs, [], NOW)).toEqual([]);
  });
});

describe("the system reminder elsewhere", () => {
  it("is listed for admins only", () => {
    const on = () => true;
    expect(listedKinds(on).map((k) => k.kind)).not.toContain("REMINDER_SYSTEM");
    expect(listedKinds(on, true).map((k) => k.kind)).toContain("REMINDER_SYSTEM");
  });

  it("adds one line to the morning summary", () => {
    const lines = digestLines({ choresMine: 0, choresAll: 0, dosesMine: 0, dosesAll: 0, school: [], cars: [], dates: [], system: ["The nightly backup hasn't run since Sat"] });
    expect(lines).toEqual(["Something stopped: The nightly backup hasn't run since Sat"]);
  });
});
