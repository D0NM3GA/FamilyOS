import { describe, expect, it } from "vitest";
import { signInKindOf } from "./sign-in-kind";

describe("Phase 40.1b: how someone signs in", () => {
  const microsoft = new Set(["user_ms"]);

  it("tells Microsoft, another sign-in of their own, and a PIN profile apart", () => {
    expect(signInKindOf("user_ms", microsoft)).toBe("microsoft");
    expect(signInKindOf("user_passkey", microsoft)).toBe("own");
    expect(signInKindOf(null, microsoft)).toBe("pin");
  });
});
