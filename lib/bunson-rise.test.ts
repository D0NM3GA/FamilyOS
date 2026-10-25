import { describe, expect, it } from "vitest";
import { LOOK_FRAME_MS, RISE_FRAME_COUNT, RISE_MS, riseFrameIndex, sitFrameIndex } from "./bunson-rise";

describe("periscoping", () => {
  it("rises from sitting to standing tall within the rise time", () => {
    expect(riseFrameIndex(0)).toBe(0);
    expect(riseFrameIndex(RISE_MS - 1)).toBe(RISE_FRAME_COUNT - 1);
    expect(riseFrameIndex(-20)).toBe(0);
  });

  it("then looks around among the standing frames, starting from the top of the rise", () => {
    expect(riseFrameIndex(RISE_MS)).toBe(8);
    const seen = new Set<number>();
    for (let t = RISE_MS; t < RISE_MS + 30 * LOOK_FRAME_MS; t += LOOK_FRAME_MS) seen.add(riseFrameIndex(t));
    expect([...seen].every((i) => i >= 3 && i <= 8)).toBe(true);
    expect(seen.size).toBe(6);
  });

  it("sits back down in reverse, then hands back to sitting", () => {
    expect(sitFrameIndex(0)).toBe(RISE_FRAME_COUNT - 1);
    expect(sitFrameIndex(RISE_MS - 1)).toBe(0);
    expect(sitFrameIndex(RISE_MS)).toBeNull();
  });
});
