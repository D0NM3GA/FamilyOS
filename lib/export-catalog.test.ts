import { describe, expect, test } from "vitest";
import { exportCatalog } from "@/app/(app)/data/catalog";

describe("exportCatalog", () => {
  const groups = exportCatalog();

  test("covers every domain that holds app-only data", () => {
    expect(groups.map((g) => g.domain)).toEqual(["people", "chores", "points", "meds", "groceries", "vehicles", "school"]);
  });

  test("every file name yields a safe download filename and a unique link", () => {
    const hrefs = groups.flatMap((g) => g.files.map((f) => f.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const group of groups) {
      for (const file of group.files) {
        expect(file.name).toMatch(/^[a-z0-9-]+$/);
        expect(file.href).toBe(`/${group.domain}/export/${file.name}.csv`);
        expect(file.entry.label.length).toBeGreaterThan(0);
      }
    }
  });
});
