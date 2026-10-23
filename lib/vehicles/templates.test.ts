import { describe, expect, test } from "vitest";
import { MAINTENANCE_TEMPLATES, selectTemplates } from "./templates";

describe("selectTemplates", () => {
  test("returns only chosen keys, skipping titles the vehicle already has (case-insensitive)", () => {
    const picked = selectTemplates(["oil", "rotation", "bogus"], ["  OIL CHANGE "]);
    expect(picked.map((t) => t.title)).toEqual(["Tire rotation"]);
  });

  test("every template has at least one interval (the item form's own rule)", () => {
    for (const t of MAINTENANCE_TEMPLATES) {
      expect(t.intervalMiles != null || t.intervalMonths != null).toBe(true);
    }
  });

  test("template keys are unique", () => {
    expect(new Set(MAINTENANCE_TEMPLATES.map((t) => t.key)).size).toBe(MAINTENANCE_TEMPLATES.length);
  });
});
