import { describe, expect, test, vi } from "vitest";

// entraAccess is pure; the rest of lib/active-profile isn't, so its neighbours are stubbed.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ getServerSession: async () => null, signedInRecently: async () => false }));
vi.mock("@/lib/dev-auth", () => ({ devAuthPerson: async () => null, isDevUser: () => false }));
vi.mock("@/lib/observability", () => ({ setSentryUser: () => {} }));
vi.mock("@/lib/setup", () => ({ isSetUp: async () => true }));

const { entraAccess } = await import("@/lib/active-profile");

const ended = new Date("2026-10-14T12:00:00Z");
const before = Math.floor(ended.getTime() / 1000) - 60;
const after = Math.floor(ended.getTime() / 1000) + 60;

describe("entraAccess (Phase 40.4)", () => {
  test("no Microsoft account: Entra has no say", () => {
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: null }, { microsoft: false })).toEqual({ kind: "none" });
  });

  test("a Microsoft sign-in without an Admin/Adult role has no access, whatever is stored", () => {
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: null }, { microsoft: true, role: null, issuedAt: after })).toEqual({ kind: "deny" });
  });

  test("the role follows the token", () => {
    expect(entraAccess({ role: "ADULT", entraAccessEndedAt: null }, { microsoft: true, role: "ADMIN", issuedAt: after })).toEqual({ kind: "role", role: "ADMIN" });
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: null }, { microsoft: true, role: "ADMIN", issuedAt: after })).toEqual({ kind: "none" });
  });

  test("after a good check, only a token issued since then moves the role (or the check's change would be undone on every page)", () => {
    const checked = new Date((after + 600) * 1000);
    expect(entraAccess({ role: "ADULT", entraAccessEndedAt: null }, { microsoft: true, role: "ADMIN", issuedAt: after }, checked)).toEqual({ kind: "none" });
    expect(entraAccess({ role: "ADULT", entraAccessEndedAt: null }, { microsoft: true, role: "ADMIN", issuedAt: after + 1200 }, checked)).toEqual({
      kind: "role",
      role: "ADMIN",
    });
    // No role at all still means no access, whatever the check said.
    expect(entraAccess({ role: "ADULT", entraAccessEndedAt: null }, { microsoft: true, role: null, issuedAt: after }, checked)).toEqual({ kind: "deny" });
  });

  test("ended by the check: back only with a token issued after it", () => {
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: ended }, { microsoft: true, role: "ADMIN", issuedAt: before })).toEqual({ kind: "deny" });
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: ended }, { microsoft: true, role: "ADMIN", issuedAt: null })).toEqual({ kind: "deny" });
    expect(entraAccess({ role: "ADMIN", entraAccessEndedAt: ended }, { microsoft: true, role: "ADULT", issuedAt: after })).toEqual({ kind: "restore", role: "ADULT" });
  });
});
