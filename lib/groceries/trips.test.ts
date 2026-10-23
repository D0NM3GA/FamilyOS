import { describe, expect, it } from "vitest";
import { describeTripWhen } from "./trips";

describe("describeTripWhen", () => {
  // Local times, like the trips themselves: the server's own day.
  const now = new Date(2026, 9, 9, 18, 30);

  it("says today and yesterday in words", () => {
    // \s: newer ICU puts a narrow no-break space before AM/PM.
    expect(describeTripWhen(new Date(2026, 9, 9, 9, 5), now)).toEqual({ day: "Today", time: expect.stringMatching(/^9:05\sAM$/) });
    expect(describeTripWhen(new Date(2026, 9, 8, 23, 59), now)).toEqual({ day: "Yesterday", time: expect.stringMatching(/^11:59\sPM$/) });
  });

  it("names the weekday and date otherwise, with the year only when it isn't this one", () => {
    expect(describeTripWhen(new Date(2026, 9, 3, 17, 12), now).day).toBe("Sat, Oct 3");
    expect(describeTripWhen(new Date(2025, 11, 30, 10, 0), now).day).toBe("Tue, Dec 30, 2025");
  });

  it("knows yesterday across a month boundary", () => {
    expect(describeTripWhen(new Date(2026, 8, 30, 12, 0), new Date(2026, 9, 1, 8, 0)).day).toBe("Yesterday");
  });
});
