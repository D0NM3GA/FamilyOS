import { describe, expect, it } from "vitest";
import { hopFrameIndex, HOP_MS } from "./bunson-hop";

describe("hopFrameIndex", () => {
  it("clamps negative elapsed to frame 0", () => {
    expect(hopFrameIndex(-5)).toBe(0);
  });

  it("starts at frame 0", () => {
    expect(hopFrameIndex(0)).toBe(0);
    expect(hopFrameIndex(89)).toBe(0);
  });

  it("advances a frame every 90ms", () => {
    expect(hopFrameIndex(90)).toBe(1);
  });

  it("wraps the two loops through all 8 frames", () => {
    expect(hopFrameIndex(1349)).toBe(6);
    expect(hopFrameIndex(1350)).toBe(7);
    expect(hopFrameIndex(1439)).toBe(7);
  });

  it("resolves to idle (null) once the hop duration elapses", () => {
    expect(HOP_MS).toBe(1440);
    expect(hopFrameIndex(1440)).toBeNull();
    expect(hopFrameIndex(1e9)).toBeNull();
  });
});
