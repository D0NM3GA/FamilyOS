import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The active-profile cookie is bound to the sign-in it was picked in, and a Microsoft-linked
 * profile is only ever the signed-in person's own. Cookies, the session and the database are
 * faked; the signing and checks are the real ones.
 */
type P = { id: string; householdId: string; isHouseholdMember: boolean; authUserId: string | null; role: string };
const people: Record<string, P> = {
  dad: { id: "dad", householdId: "h1", isHouseholdMember: true, authUserId: "u-dad", role: "ADMIN" },
  mom: { id: "mom", householdId: "h1", isHouseholdMember: true, authUserId: "u-mom", role: "ADULT" },
  kid: { id: "kid", householdId: "h1", isHouseholdMember: true, authUserId: null, role: "KID" },
};
const jar = new Map<string, string>();
const state = { session: null as null | { session: { id: string; createdAt: Date }; user: { id: string; email: string } } };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/session", () => ({ getServerSession: async () => state.session, signedInRecently: async () => true }));
vi.mock("@/lib/dev-auth", () => ({ isDevUser: () => false, devAuthPerson: async () => null }));
vi.mock("@/lib/observability", () => ({ setSentryUser: () => {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: {
      findUnique: async ({ where }: { where: { id?: string; authUserId?: string } }) =>
        Object.values(people).find((p) => (where.id ? p.id === where.id : p.authUserId === where.authUserId)) ?? null,
    },
    account: { findFirst: async () => null },
  },
}));

process.env.BETTER_AUTH_SECRET = "test-secret-for-cookie-signing";
const { getActiveProfile, setActiveProfileCookie } = await import("./active-profile");

const signIn = (userId: string, sessionId: string) => {
  state.session = { session: { id: sessionId, createdAt: new Date() }, user: { id: userId, email: `${userId}@x.test` } };
};

describe("active-profile cookie", () => {
  beforeEach(() => {
    jar.clear();
    state.session = null;
  });

  it("opens the profile picked in this sign-in", async () => {
    signIn("u-dad", "s1");
    await setActiveProfileCookie("kid");
    expect((await getActiveProfile())?.id).toBe("kid");
  });

  it("means nothing after sign-out, to the next person signing in on the same browser", async () => {
    signIn("u-dad", "s1");
    await setActiveProfileCookie("dad");
    signIn("u-mom", "s2");
    expect(await getActiveProfile()).toBeNull();
  });

  it("never opens another adult's Microsoft-linked profile, even with a cookie signed for this session", async () => {
    signIn("u-mom", "s2");
    await setActiveProfileCookie("dad");
    expect(await getActiveProfile()).toBeNull();
    await setActiveProfileCookie("mom");
    expect((await getActiveProfile())?.id).toBe("mom");
  });

  it("rejects a cookie whose signature was changed", async () => {
    signIn("u-dad", "s1");
    await setActiveProfileCookie("kid");
    const [, sig] = jar.get("active_profile")!.split(".");
    jar.set("active_profile", `dad.${sig}`);
    expect(await getActiveProfile()).toBeNull();
  });

  it("fails closed without BETTER_AUTH_SECRET", async () => {
    signIn("u-dad", "s1");
    const saved = process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    try {
      await expect(setActiveProfileCookie("kid")).rejects.toThrow(/BETTER_AUTH_SECRET/);
    } finally {
      process.env.BETTER_AUTH_SECRET = saved;
    }
  });
});
