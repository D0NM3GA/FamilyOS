import { describe, expect, it } from "vitest";
import { pickBunsonLine, INITIAL_BUNSON_LINE_STATE } from "./bunson-lines";

const LINES = ["Joke A", "Joke B", "Joke C"];

describe("pickBunsonLine", () => {
  it("favors a fact on the very first pick, even against an unlucky coin flip", () => {
    const { line, nextState } = pickBunsonLine(["Fact 1"], LINES, INITIAL_BUNSON_LINE_STATE, () => 0.99);
    expect(line).toBe("Fact 1");
    expect(nextState.hasSpokenFact).toBe(true);
  });

  it("returns a joke when there are no facts at all", () => {
    const { line } = pickBunsonLine([], LINES, INITIAL_BUNSON_LINE_STATE, () => 0);
    expect(LINES).toContain(line);
  });

  it("coin-flips between pools once a fact has already been spoken", () => {
    const state = { lastSpoken: "Fact 1", hasSpokenFact: true };
    const { line } = pickBunsonLine(["Fact 1"], LINES, state, () => 0.9); // >= 0.5, so "no"
    expect(LINES).toContain(line);
  });

  it("never repeats the last line when the pool has more than one distinct option", () => {
    const state = { lastSpoken: "Joke A", hasSpokenFact: false };
    // random() = 0 would naively pick index 0 ("Joke A") if repeats weren't filtered out.
    const { line } = pickBunsonLine([], LINES, state, () => 0);
    expect(line).not.toBe("Joke A");
    expect(LINES).toContain(line);
  });

  it("falls back to the other pool when the chosen pool is a single entry equal to the last line", () => {
    // Facts has exactly one entry, it's also the last-spoken line, and the coin flip (0 < 0.5)
    // says "use a fact" — without the fallback this would stall on the same line forever.
    const state = { lastSpoken: "Only fact", hasSpokenFact: true };
    const { line, nextState } = pickBunsonLine(["Only fact"], LINES, state, () => 0);
    expect(line).toBe(LINES[0]);
    expect(line).not.toBe("Only fact");
    expect(nextState.hasSpokenFact).toBe(true);
  });

  it("index draw never goes out of range", () => {
    for (let i = 0; i < 20; i++) {
      const r = i / 20;
      const { line } = pickBunsonLine(["F1", "F2"], LINES, INITIAL_BUNSON_LINE_STATE, () => r);
      expect([...LINES, "F1", "F2"]).toContain(line);
    }
  });
});
