import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { parseGiftForm } = await import("./gifts");

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("the 🎁 Surprise? form (charges and order emails)", () => {
  const today = "2026-10-08";

  it("keeps only other jar members, once each", () => {
    expect(parseGiftForm(form([["hiddenFrom", "mom"], ["hiddenFrom", "mom"], ["hiddenFrom", "stranger"], ["revealOn", "2026-12-01"]]), ["mom"], today)).toEqual({
      hiddenFrom: ["mom"],
      revealOn: "2026-12-01",
    });
    expect(parseGiftForm(form([["hiddenFrom", "stranger"], ["revealOn", "2026-12-01"]]), ["mom"], today)).toEqual({ error: "Pick who it's a surprise for." });
  });

  it("needs a real day after today and within a year", () => {
    const at = (day: string) => parseGiftForm(form([["hiddenFrom", "mom"], ["revealOn", day]]), ["mom"], today);
    expect(at("")).toEqual({ error: "Pick the day it can be seen." });
    expect(at("12/01/2026")).toEqual({ error: "Pick the day it can be seen." });
    expect(at("2026-10-08")).toEqual({ error: "Pick a day after today." });
    expect(at("2027-10-10")).toEqual({ error: "Pick a day within a year." });
    expect(at("2026-10-09")).toEqual({ hiddenFrom: ["mom"], revealOn: "2026-10-09" });
  });
});
