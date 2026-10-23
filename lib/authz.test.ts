import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every adult-only and admin-only server action rests on these gates, so each role is
 * checked here; only the active profile lookup is faked.
 */
type Role = "ADULT" | "KID" | "ADMIN" | null;
const state = { profile: { id: "p-1", role: null as Role } };
vi.mock("@/lib/active-profile", () => ({ requireActiveProfile: async () => state.profile }));

const { assertOwnRecord, isAdmin, isAdult, requireAdmin, requireAdult } = await import("./authz");

const ROLES: Role[] = [null, "KID", "ADULT", "ADMIN"];

describe("isAdult / isAdmin", () => {
  it("ADMIN counts as an adult; nothing else does but ADULT", () => {
    expect(ROLES.map((role) => isAdult({ role }))).toEqual([false, false, true, true]);
  });
  it("only ADMIN is an admin", () => {
    expect(ROLES.map((role) => isAdmin({ role }))).toEqual([false, false, false, true]);
  });
});

describe("requireAdult / requireAdmin", () => {
  beforeEach(() => {
    state.profile = { id: "p-1", role: null };
  });

  it("let adults through and stop everyone else", async () => {
    for (const role of ROLES) {
      state.profile = { id: "p-1", role };
      const adult = requireAdult();
      if (role === "ADULT" || role === "ADMIN") await expect(adult).resolves.toBe(state.profile);
      else await expect(adult).rejects.toThrow("Only adults can do that");
    }
  });

  it("let only admins through", async () => {
    for (const role of ROLES) {
      state.profile = { id: "p-1", role };
      const admin = requireAdmin();
      if (role === "ADMIN") await expect(admin).resolves.toBe(state.profile);
      else await expect(admin).rejects.toThrow("Only admins can do that");
    }
  });
});

describe("assertOwnRecord", () => {
  it("a kid may act on their own record only", () => {
    const kid = { id: "kid-1", role: "KID" as const };
    expect(() => assertOwnRecord(kid, "kid-1")).not.toThrow();
    expect(() => assertOwnRecord(kid, "kid-2")).toThrow("You can only act on your own records");
  });

  it("a record that belongs to nobody isn't a kid's", () => {
    expect(() => assertOwnRecord({ id: "kid-1", role: "KID" }, null)).toThrow();
    expect(() => assertOwnRecord({ id: "p-1", role: null }, null)).toThrow();
  });

  it("adults may act on anyone's record", () => {
    for (const role of ["ADULT", "ADMIN"] as const) {
      expect(() => assertOwnRecord({ id: "a-1", role }, "kid-1")).not.toThrow();
      expect(() => assertOwnRecord({ id: "a-1", role }, null)).not.toThrow();
    }
  });
});
