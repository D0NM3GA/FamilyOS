import { describe, expect, it } from "vitest";
import { backgroundJobsEnabled } from "./background";

describe("background jobs switch", () => {
  it("on in production, never during next build, overridable", () => {
    expect(backgroundJobsEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(backgroundJobsEnabled({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "production", BACKGROUND_JOBS: "0" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(backgroundJobsEnabled({ NODE_ENV: "development", BACKGROUND_JOBS: "1" })).toBe(true);
    expect(backgroundJobsEnabled({ NODE_ENV: "test" })).toBe(false);
  });
});
