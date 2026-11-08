import { describe, expect, it } from "vitest";
import { cutoffs } from "./retention";

describe("cleanup cutoffs", () => {
  it("a day past a session's expiry, 90 days after a notification was read", () => {
    const c = cutoffs(new Date("2026-11-07T12:00:00Z"));
    expect(c.sessionsExpiredBefore.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(c.notificationsReadBefore.toISOString()).toBe("2026-08-09T12:00:00.000Z");
    // Phase 67b: unread ones go at 180 days.
    expect(c.notificationsUnreadBefore.toISOString()).toBe("2026-05-11T12:00:00.000Z");
  });
});
