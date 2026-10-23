import { describe, expect, it } from "vitest";
import {
  TRANSITIONS,
  canAfford,
  familySheetFill,
  initialStatus,
  limitLabel,
  moreNeeded,
  weekLimitReached,
} from "./rules";
import { familyGoalSchema, rewardSchema } from "./forms";

describe("rewardSchema", () => {
  it("accepts a valid reward with defaults", () => {
    const r = rewardSchema.parse({ title: "Extra screen time", pointCost: 20 });
    expect(r).toMatchObject({ emoji: null, bucketId: null, limitPerWeek: null, needsApproval: false });
  });

  it("parses the store fields", () => {
    const r = rewardSchema.parse({
      title: "Skip a chore",
      pointCost: "40",
      emoji: "🛁",
      bucketId: "b1",
      limitPerWeek: "1",
      needsApproval: true,
    });
    expect(r).toMatchObject({ emoji: "🛁", bucketId: "b1", limitPerWeek: 1, needsApproval: true });
  });

  it("requires a non-empty title", () => {
    expect(rewardSchema.safeParse({ title: "   ", pointCost: 20 }).success).toBe(false);
  });

  it("requires a positive integer point cost under a million", () => {
    expect(rewardSchema.safeParse({ title: "X", pointCost: 0 }).success).toBe(false);
    expect(rewardSchema.safeParse({ title: "X", pointCost: 2.5 }).success).toBe(false);
    expect(rewardSchema.safeParse({ title: "X", pointCost: 1_000_001 }).success).toBe(false);
    expect(rewardSchema.safeParse({ title: "X", pointCost: 1_000_000 }).success).toBe(true);
  });

  it("rejects a week limit outside 1–7", () => {
    expect(rewardSchema.safeParse({ title: "X", pointCost: 5, limitPerWeek: "8" }).success).toBe(false);
    expect(rewardSchema.safeParse({ title: "X", pointCost: 5, limitPerWeek: "0" }).success).toBe(false);
  });
});

describe("familyGoalSchema", () => {
  it("allows clearing the goal", () => {
    expect(familyGoalSchema.parse({ stickers: "", title: "" })).toEqual({ stickers: null, title: null });
    expect(familyGoalSchema.parse({ stickers: "200", title: " Pizza night " })).toEqual({ stickers: 200, title: "Pizza night" });
  });
});

describe("canAfford / moreNeeded", () => {
  it("covers exact and short balances", () => {
    expect(canAfford(20, 20)).toBe(true);
    expect(canAfford(19, 20)).toBe(false);
    expect(moreNeeded(85, 100)).toBe(15);
    expect(moreNeeded(120, 100)).toBe(0);
  });

  it("handles a negative balance", () => {
    expect(canAfford(-5, 0)).toBe(false);
    expect(moreNeeded(-5, 10)).toBe(15);
  });
});

describe("week limits", () => {
  it("only blocks once the limit is reached", () => {
    expect(weekLimitReached(0, 1)).toBe(false);
    expect(weekLimitReached(1, 1)).toBe(true);
    expect(weekLimitReached(1, 2)).toBe(false);
    expect(weekLimitReached(99, null)).toBe(false);
  });

  it("labels them", () => {
    expect(limitLabel(null)).toBe("Any time");
    expect(limitLabel(1)).toBe("1 a week");
    expect(limitLabel(2)).toBe("2 a week");
  });
});

describe("initialStatus", () => {
  it("only a kid's needs-OK order waits", () => {
    expect(initialStatus({ needsApproval: true, placedByAdult: false })).toBe("WAITING_OK");
    expect(initialStatus({ needsApproval: true, placedByAdult: true })).toBe("TO_DO");
    expect(initialStatus({ needsApproval: false, placedByAdult: false })).toBe("TO_DO");
  });
});

describe("TRANSITIONS", () => {
  it("refunds only on decline and refund", () => {
    expect(TRANSITIONS.decline.refund && TRANSITIONS.refund.refund).toBe(true);
    expect(TRANSITIONS.approve.refund || TRANSITIONS.deliver.refund).toBe(false);
  });

  it("never allows refunding a delivered order", () => {
    expect(Object.values(TRANSITIONS).some((t) => t.from === "DELIVERED")).toBe(false);
  });
});

describe("familySheetFill", () => {
  it("is null without a goal and clamps to 0–1", () => {
    expect(familySheetFill(50, null)).toBeNull();
    expect(familySheetFill(50, 200)).toBe(0.25);
    expect(familySheetFill(300, 200)).toBe(1);
  });
});
