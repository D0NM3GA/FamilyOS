import { describe, expect, it } from "vitest";
import { currentAuthSecret } from "./active-profile";

describe("currentAuthSecret (Phase 67c)", () => {
  it("is the newest of BETTER_AUTH_SECRETS while rotating, else BETTER_AUTH_SECRET", () => {
    expect(currentAuthSecret({ BETTER_AUTH_SECRET: "old" })).toBe("old");
    expect(currentAuthSecret({ BETTER_AUTH_SECRET: "old", BETTER_AUTH_SECRETS: "2:new, 1:old" })).toBe("new");
    expect(currentAuthSecret({ BETTER_AUTH_SECRET: "old", BETTER_AUTH_SECRETS: "" })).toBe("old");
    expect(currentAuthSecret({})).toBeUndefined();
  });
});
