import { describe, expect, test } from "vitest";
import { canonicalizeTimeZone, serverTimeZone, timeZoneMismatch } from "./household-settings";

/** Phase 45.2: the household starts on the setup device's zone; Settings says when the server's differs. */
describe("household time zone", () => {
  test("a device's zone is kept in its canonical form, and junk is dropped", () => {
    expect(canonicalizeTimeZone("america/new_york")).toBe("America/New_York");
    expect(canonicalizeTimeZone("")).toBeNull();
    expect(canonicalizeTimeZone("Not/AZone")).toBeNull();
  });

  test("a mismatch names the server's zone; agreeing or unset says nothing", () => {
    const server = serverTimeZone();
    expect(timeZoneMismatch(server)).toBeNull();
    expect(timeZoneMismatch(null)).toBeNull();
    const other = server === "Pacific/Auckland" ? "Europe/London" : "Pacific/Auckland";
    expect(timeZoneMismatch(other)).toBe(server);
  });
});
