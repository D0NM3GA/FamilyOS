import { describe, expect, test } from "vitest";
import { parseLocalDate, toISODate } from "./dates";

describe("parseLocalDate", () => {
  test("parses to local midnight", () => {
    const d = parseLocalDate("2026-09-22")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 22, 0]);
    expect(toISODate(d)).toBe("2026-09-22");
  });

  test.each(["2026-02-30", "2026-13-01", "9/22/2026", "", "2026-9-22"])("rejects %s", (raw) => {
    expect(parseLocalDate(raw)).toBeNull();
  });
});
