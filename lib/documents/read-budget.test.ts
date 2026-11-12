import { beforeEach, describe, expect, test } from "vitest";
import { READS_PER_HOUR, resetReadBudget, takeRead } from "./read-budget";

describe("document read budget", () => {
  beforeEach(resetReadBudget);

  test("allows a household's hourly budget, then refuses until an hour has passed", () => {
    const t0 = Date.UTC(2026, 10, 11, 9);
    for (let i = 0; i < READS_PER_HOUR; i++) expect(takeRead("h1", t0 + i)).toBe(true);
    expect(takeRead("h1", t0 + 1000)).toBe(false);
    // Another household has its own budget.
    expect(takeRead("h2", t0 + 1000)).toBe(true);
    expect(takeRead("h1", t0 + 60 * 60_000 + 1)).toBe(true);
  });
});
