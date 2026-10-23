import { describe, expect, it } from "vitest";
import { describeEvery, usualFor } from "./usual";

const day = (n: number, quantity = 1) => ({ quantity, purchasedAt: new Date(2026, 0, 1 + n, 15) });

describe("usualFor", () => {
  it("nothing bought yet", () => {
    expect(usualFor([])).toBeNull();
  });

  it("amount is the recent median per trip; one trip has no cadence", () => {
    expect(usualFor([day(0, 2)])).toEqual({ quantity: 2, everyDays: null, trips: 1 });
  });

  it("learns how often from two or more gaps", () => {
    const u = usualFor([day(0), day(35), day(70)]);
    expect(u).toEqual({ quantity: 1, everyDays: 35, trips: 3 });
  });

  it("two lines on one trip count as one purchase of both", () => {
    expect(usualFor([day(0, 1), day(0, 1), day(7, 2), day(14, 2)])?.quantity).toBe(2);
  });

  it("weights recent trips and never says zero", () => {
    const rows = [day(0, 6), day(7, 6), day(14, 1), day(21, 1), day(28, 1), day(35, 1), day(42, 1)];
    expect(usualFor(rows)?.quantity).toBe(1);
    expect(usualFor([day(0, 0.2)])?.quantity).toBe(1);
  });
});

describe("describeEvery", () => {
  it("reads naturally", () => {
    expect(describeEvery(4)).toBe("every ~4 days");
    expect(describeEvery(35)).toBe("every ~5 weeks");
    expect(describeEvery(30)).toBe("about monthly");
    expect(describeEvery(90)).toBe("every ~3 months");
    expect(describeEvery(null)).toBeNull();
  });
});
