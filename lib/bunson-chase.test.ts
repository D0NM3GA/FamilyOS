import { describe, expect, it } from "vitest";
import { chaseAcceptsPointer } from "./bunson-chase";

describe("chaseAcceptsPointer", () => {
  it("accepts mouse input", () => {
    expect(chaseAcceptsPointer("mouse")).toBe(true);
  });

  it("rejects touch input", () => {
    expect(chaseAcceptsPointer("touch")).toBe(false);
  });

  it("rejects pen input", () => {
    expect(chaseAcceptsPointer("pen")).toBe(false);
  });
});
