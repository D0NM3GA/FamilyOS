import { describe, expect, it } from "vitest";
import { branchKey, ruleCovers, ruleResolver } from "./rules";
import { nextDueOn } from "./manual-bills";

describe("every-branch rules (Phase 69c)", () => {
  const rules = [
    { key: "joes pizza", categoryId: "dining", matchPrefix: true },
    { key: "joes pizza airport", categoryId: "travel" },
    { key: "shell", categoryId: "fuel", matchPrefix: true },
    { key: "shell oil riverton", categoryId: "car" },
  ];
  const rule = ruleResolver(rules);

  it("an exact rule wins, then the longest branch rule at a word", () => {
    expect(rule("joes pizza riverton")).toBe("dining");
    expect(rule("joes pizza springfield")).toBe("dining");
    expect(rule("joes pizza airport")).toBe("travel");
    expect(rule("shell oil riverton")).toBe("car");
    expect(rule("shell oil springfield")).toBe("fuel");
    // Not at a word boundary, and the key alone isn't a branch of itself unless exact.
    expect(rule("joes pizzeria")).toBeUndefined();
    expect(rule("shellfish shack")).toBeUndefined();
    expect(rule("")).toBeUndefined();
  });

  it("knows which rule covers a charge", () => {
    expect(ruleCovers(rules[0], "joes pizza riverton")).toBe(true);
    expect(ruleCovers(rules[1], "joes pizza riverton")).toBe(false);
    expect(ruleCovers({ key: "chipotle" }, "chipotle")).toBe(true);
  });

  it("offers the key without its town", () => {
    expect(branchKey("joes pizza riverton")).toBe("joes pizza");
    expect(branchKey("chipotle springfield")).toBe("chipotle");
    expect(branchKey("chipotle")).toBeNull();
    expect(branchKey("ab springfield")).toBeNull();
  });
});

describe("a hand-added bill marked paid (Phase 69c)", () => {
  const bill = { cadence: "MONTHLY" as const, nextDue: "2026-10-15" };
  it("moves on past the day marked paid, early too", () => {
    expect(nextDueOn(bill, "2026-11-16")).toBe("2026-11-15");
    expect(nextDueOn({ ...bill, paidDueOn: "2026-11-15" }, "2026-11-16")).toBe("2026-12-15");
    expect(nextDueOn({ ...bill, paidDueOn: "2026-11-15" }, "2026-11-08")).toBe("2026-12-15");
  });
});
