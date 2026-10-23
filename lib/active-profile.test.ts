import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 25: isOwnSignIn is what money jars rest on (lib/finance/access.ts), so it's tested
 * for real here rather than mocked: only the session and the dev sign-in are faked.
 */
const state = { session: null as null | { user: { id: string; email?: string } }, dev: false, devPersonId: "dev-admin" };
vi.mock("@/lib/session", () => ({ getServerSession: async () => state.session }));
vi.mock("@/lib/dev-auth", () => ({
  isDevUser: (user: { email?: string } | null | undefined) => state.dev && user?.email === "dev-tester@familyos.test",
  devAuthPerson: async () => ({ id: state.devPersonId }),
}));

const { isOwnSignIn, isSessionOwner } = await import("./active-profile");

describe("isOwnSignIn", () => {
  beforeEach(() => {
    state.session = null;
    state.dev = false;
  });

  it("is true only for the signed-in person's own profile", async () => {
    state.session = { user: { id: "u-dad" } };
    expect(await isOwnSignIn({ id: "p-dad", authUserId: "u-dad" })).toBe(true);
    expect(await isOwnSignIn({ id: "p-grandma", authUserId: "u-grandma" })).toBe(false);
    expect(await isSessionOwner({ authUserId: "u-dad" })).toBe(true);
  });

  it("a profile with no Microsoft link is never 'own', even with no session", async () => {
    expect(await isOwnSignIn({ id: "p-sitter", authUserId: null })).toBe(false);
    state.session = { user: { id: "u-dad" } };
    expect(await isOwnSignIn({ id: "p-sitter", authUserId: null })).toBe(false);
  });

  it("the dev sign-in counts only for its own admin, and only with DEV_AUTH on", async () => {
    state.session = { user: { id: "u-dev", email: "dev-tester@familyos.test" } };
    expect(await isOwnSignIn({ id: "dev-admin", authUserId: "u-dad" })).toBe(false);
    state.dev = true;
    expect(await isOwnSignIn({ id: "dev-admin", authUserId: "u-dad" })).toBe(true);
    expect(await isOwnSignIn({ id: "p-grandma", authUserId: "u-grandma" })).toBe(false);
  });
});
