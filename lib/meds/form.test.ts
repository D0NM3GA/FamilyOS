import { describe, expect, it } from "vitest";
import { medFormSchema } from "./form";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Amoxicillin",
    frequencyType: "DAILY",
    daysOfWeek: [],
    startDate: "2026-01-01",
    points: 0,
    timesOfDay: ["08:00"],
    assigneeIds: ["person1"],
    ...overrides,
  };
}

describe("medFormSchema", () => {
  it("accepts the minimal required fields with no stock tracking at all", () => {
    const result = medFormSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
  });

  it("rejects a zero doseAmount — a dose has to consume something", () => {
    const result = medFormSchema.safeParse(baseInput({ doseAmount: 0 }));
    expect(result.success).toBe(false);
  });

  it("rejects a negative quantityOnHand", () => {
    const result = medFormSchema.safeParse(baseInput({ quantityOnHand: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects a negative refillThresholdQuantity", () => {
    const result = medFormSchema.safeParse(baseInput({ refillThresholdQuantity: -1 }));
    expect(result.success).toBe(false);
  });

  it("accepts a refill threshold set on its own, without quantity tracking configured yet", () => {
    // Independently optional by design — doseConsumption (lib/meds/quantity.ts) treats
    // this as "not tracking" until quantityOnHand/doseAmount are also filled in, but
    // saving the threshold early shouldn't be blocked.
    const result = medFormSchema.safeParse(baseInput({ refillThresholdQuantity: 5 }));
    expect(result.success).toBe(true);
  });

  it("accepts quantityOnHand of exactly 0", () => {
    const result = medFormSchema.safeParse(baseInput({ quantityOnHand: 0 }));
    expect(result.success).toBe(true);
  });

  it("requires exactly one assignee", () => {
    expect(medFormSchema.safeParse(baseInput({ assigneeIds: [] })).success).toBe(false);
    expect(medFormSchema.safeParse(baseInput({ assigneeIds: ["a", "b"] })).success).toBe(false);
  });
});
