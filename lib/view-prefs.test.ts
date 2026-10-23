import { describe, expect, it } from "vitest";
import { resolveViewMode } from "./view-prefs";

describe("resolveViewMode", () => {
  it("defaults kids to big buttons and grown-ups to the full app", () => {
    expect(resolveViewMode(null, false)).toBe("BIG");
    expect(resolveViewMode(null, true)).toBe("FULL");
  });

  it("respects a stored choice either way", () => {
    expect(resolveViewMode("FULL", false)).toBe("FULL");
    expect(resolveViewMode("BIG", true)).toBe("BIG");
  });
});
