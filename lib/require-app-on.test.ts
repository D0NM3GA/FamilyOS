import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireAppOn (lib/app-guard.ts) with the active profile, the family's switches and Next's
 * redirect faked: a kid is sent home from a grown-up app and let into the rest; a grown-up is
 * let into every app that's on. lib/adult-apps.test.ts checks every grown-up page calls it.
 */
type Role = "ADULT" | "KID" | "ADMIN" | null;
const state = { profile: { id: "p-1", firstName: "Ivy", householdId: "h-1", role: "KID" as Role }, off: [] as string[] };

vi.mock("@/lib/active-profile", () => ({ requireActiveProfile: async () => state.profile }));
vi.mock("@/lib/app-switches", () => ({ appOn: async (_household: string, app: string) => !state.off.includes(app) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { requireAppOn } = await import("./app-guard");

const as = (firstName: string, role: Role) => (state.profile = { ...state.profile, firstName, role });

describe("requireAppOn", () => {
  beforeEach(() => {
    state.off = [];
  });

  it("sends a kid home from every grown-up app", async () => {
    as("Ivy", "KID");
    for (const app of ["cars", "money", "data"] as const) await expect(requireAppOn(app)).rejects.toThrow("redirect /");
    as("Max", null);
    await expect(requireAppOn("cars")).rejects.toThrow("redirect /");
  });

  it("lets a kid into the apps that are for everyone", async () => {
    as("Max", "KID");
    for (const app of ["chores", "groceries", "school", "store"] as const) await expect(requireAppOn(app)).resolves.toBe(state.profile);
  });

  it("lets a grown-up into the grown-up apps", async () => {
    for (const [name, role] of [["Mom", "ADULT"], ["Dad", "ADMIN"]] as const) {
      as(name, role);
      for (const app of ["cars", "money", "data"] as const) await expect(requireAppOn(app)).resolves.toBe(state.profile);
    }
  });

  it("a turned-off app is turned off for everyone, before anything else", async () => {
    state.off = ["cars"];
    as("Mom", "ADULT");
    await expect(requireAppOn("cars")).rejects.toThrow("redirect /apps-off/cars");
    as("Ivy", "KID");
    await expect(requireAppOn("cars")).rejects.toThrow("redirect /apps-off/cars");
  });
});
