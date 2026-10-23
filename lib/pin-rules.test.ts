import { describe, expect, it } from "vitest";
import { pinDigitsFor, pinError } from "./pin-rules";

describe("PIN rules", () => {
  it("lets kids use 4 to 6 digits", () => {
    expect(pinDigitsFor("KID")).toEqual({ min: 4, max: 6 });
    expect(pinError("KID", "1234")).toBeNull();
    expect(pinError("KID", "123456")).toBeNull();
    expect(pinError("KID", "123")).toMatch(/4 to 6/);
  });

  it("needs exactly 6 digits for grown-ups, and treats an unknown role as a grown-up", () => {
    expect(pinError("ADULT", "123456")).toBeNull();
    expect(pinError("ADMIN", "123456")).toBeNull();
    expect(pinError("ADULT", "1234")).toMatch(/6 digits/);
    expect(pinError(null, "1234")).toMatch(/6 digits/);
    expect(pinError("ADULT", "1234567")).toMatch(/6 digits/);
  });

  it("refuses anything that isn't all digits", () => {
    expect(pinError("KID", "12a4")).not.toBeNull();
    expect(pinError("ADULT", "12345 ")).not.toBeNull();
    expect(pinError("KID", "")).not.toBeNull();
  });
});
