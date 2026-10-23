import { describe, expect, it } from "vitest";
import { rngFor } from "./random";
import { TRICKS, tryTrick, unlockedTricks } from "./tricks";
import { TRICK_LINES } from "./voice";

describe("tricks", () => {
  it("are learned as bond grows, in order", () => {
    expect(unlockedTricks(0)).toEqual([]);
    expect(unlockedTricks(10)).toEqual(["sit"]);
    expect(unlockedTricks(60)).toEqual(["sit", "spin", "wave"]);
    expect(unlockedTricks(1000)).toEqual(TRICKS.map((trick) => trick.id));
  });

  it("always work with full manners and work about half the time with none", () => {
    for (let i = 0; i < 50; i++) expect(tryTrick(100, rngFor("t", i))).toBe(true);
    const hits = Array.from({ length: 1000 }, (_, i) => tryTrick(0, rngFor("t", i))).filter(Boolean).length;
    expect(hits).toBeGreaterThan(400);
    expect(hits).toBeLessThan(600);
    expect(tryTrick(30, rngFor("same"))).toBe(tryTrick(30, rngFor("same")));
  });

  it("each have their own lines", () => {
    for (const trick of TRICKS) expect(TRICK_LINES[trick.id].length).toBeGreaterThan(1);
  });
});
