import { afterEach, describe, expect, test } from "vitest";
import { canonicalizeTimeZone } from "./household-settings";
import { applyProcessZone, deployZone, processZone } from "./household-zone";

/** Phase 49: the server's clock is the household's (lib/household-zone.ts). */
describe("the process zone", () => {
  afterEach(() => {
    applyProcessZone(null);
  });

  test("a device's zone is kept in its canonical form, and junk is dropped", () => {
    expect(canonicalizeTimeZone("america/new_york")).toBe("America/New_York");
    expect(canonicalizeTimeZone("")).toBeNull();
    expect(canonicalizeTimeZone("Not/AZone")).toBeNull();
  });

  test("local getters and Intl follow the applied zone at once", () => {
    const instant = new Date(Date.UTC(2026, 0, 1, 3)); // 3 AM UTC on New Year's Day
    expect(applyProcessZone("America/Los_Angeles")).toBe(true);
    expect(processZone()).toBe("America/Los_Angeles");
    expect(instant.getDate()).toBe(31);
    expect(instant.toLocaleString("en-US", { hour: "numeric" })).toBe("7 PM");
    applyProcessZone("Asia/Tokyo");
    expect(instant.getDate()).toBe(1);
    expect(new Date(2026, 0, 1).toISOString()).toBe("2025-12-31T15:00:00.000Z");
  });

  test("only a canonical zone is ever set; null or junk goes back to the deploy's", () => {
    expect(deployZone()).toBe("America/New_York"); // vitest.config.ts
    applyProcessZone("europe/london");
    expect(process.env.TZ).toBe("Europe/London");
    applyProcessZone("Not/AZone");
    expect(processZone()).toBe("America/New_York");
    applyProcessZone("Europe/London");
    applyProcessZone(null);
    expect(processZone()).toBe("America/New_York");
  });

  test("applying the zone it's already in is a no-op", () => {
    applyProcessZone("Europe/London");
    expect(applyProcessZone("Europe/London")).toBe(false);
  });
});
