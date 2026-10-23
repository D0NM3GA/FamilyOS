import { describe, expect, it } from "vitest";
import { bubbleShift } from "./bunson-bubble";

const EDGE_MARGIN = 12;

describe("bubbleShift", () => {
  it("is 0 (centered on Bunson) with room on both sides", () => {
    // canvasLeft ~ mid-screen on a 1024-wide viewport
    expect(bubbleShift(444, 1024, EDGE_MARGIN)).toBe(0);
  });

  it("produces the same shift for a rest-like canvasLeft regardless of viewport width", () => {
    // General property, not pinned to components/bunson.tsx's actual
    // SPRITE_SIZE/REST_INSET — those live in the component and are exercised
    // there; this only proves bubbleShift itself doesn't smuggle in a
    // viewport dependency for a "canvasLeft tracks the right edge" input.
    const width = 136;
    const inset = 32;
    const shifts = [375, 768, 1024, 1920].map((vw) =>
      bubbleShift(vw - width - inset, vw, EDGE_MARGIN),
    );
    expect(new Set(shifts).size).toBe(1);
  });

  it("shifts right (positive) when Bunson is pinned at the left edge", () => {
    expect(bubbleShift(-33, 1024, EDGE_MARGIN)).toBe(89);
  });

  it("shifts left (negative) when Bunson is pinned at the right edge", () => {
    expect(bubbleShift(1024 - 100, 1024, EDGE_MARGIN)).toBe(-92);
  });

  it("keeps the bubble's left edge at the margin when the viewport is too narrow to satisfy both edges", () => {
    // 200px viewport can't fit a 224px bubble + margins on either side
    const shift = bubbleShift(0, 200, EDGE_MARGIN);
    const min = EDGE_MARGIN + 112 - 68;
    expect(shift).toBe(min);
  });
});
