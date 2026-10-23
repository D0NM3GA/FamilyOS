import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { prisma } from "@/lib/prisma";

/**
 * DEV-ONLY TESTING SIGN-IN. REMOVE BEFORE SHIPPING (tracked in docs/BUILD.md, "Dev sign-in").
 *
 * The owner asked for a way to test without a Microsoft sign-in every time. This adds one
 * Better Auth endpoint, POST /api/auth/dev/sign-in, that signs a fixed test user in as the
 * household's admin. It exists only when ALL of these hold:
 * - NODE_ENV is exactly "development" (lib/auth.ts also refuses to start if DEV_AUTH is set
 *   in production), so a host started some other way never has it;
 * - DEV_AUTH=1 is set in the environment;
 * - the request's Host is localhost / 127.0.0.1 / [::1].
 *
 * The Host header is the client's to set, so it isn't the real boundary: `npm run dev` only
 * listens on 127.0.0.1, and `npm run dev:lan` (the one reachable from phones on the home
 * network) switches DEV_AUTH off.
 *
 * The test user has no Microsoft account, so nothing Graph-backed works as it (calendar,
 * mail, Entra sync): isSessionOwner is false for it by construction.
 */

export const DEV_USER_EMAIL = "dev-tester@familyos.test";

export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_AUTH === "1";
}

function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/** Is this signed-in Better Auth user the dev test user (and is dev sign-in on at all)? */
export function isDevUser(user: { email?: string | null } | null | undefined): boolean {
  return devAuthEnabled() && user?.email === DEV_USER_EMAIL;
}

/**
 * Who the dev test user is inside the app: the oldest admin with their own sign-in,
 * so testing sees the family's real data as it is today. Never linked by authUserId, so
 * the owner's own Microsoft link is untouched. A fresh database gets a test household (Phase
 * 40.1c: /sign-in sends an empty install to /setup, so that's a direct POST to the dev route).
 */
export async function devAuthPerson() {
  const admin = await prisma.person.findFirst({
    where: { role: "ADMIN", isHouseholdMember: true, authUserId: { not: null }, entraAccessEndedAt: null },
    orderBy: { createdAt: "asc" },
    omit: { photo: true },
  });
  if (admin) return admin;

  const existing = await prisma.person.findFirst({
    where: { role: "ADMIN", isHouseholdMember: true, email: DEV_USER_EMAIL },
    omit: { photo: true },
  });
  if (existing) return existing;
  const household = await prisma.household.create({ data: { name: "Dev household" } });
  return prisma.person.create({
    data: { householdId: household.id, firstName: "Dev", lastName: "Tester", role: "ADMIN", isHouseholdMember: true, email: DEV_USER_EMAIL },
    omit: { photo: true },
  });
}

export const devAuthPlugin = (): BetterAuthPlugin => ({
  id: "dev-auth",
  endpoints: {
    devSignIn: createAuthEndpoint("/dev/sign-in", { method: "POST" }, async (ctx) => {
      if (!devAuthEnabled() || !isLocalHost(ctx.request?.headers.get("host"))) {
        throw ctx.error("NOT_FOUND");
      }
      const adapter = ctx.context.internalAdapter;
      const found = await adapter.findUserByEmail(DEV_USER_EMAIL);
      const user =
        found?.user ??
        (await adapter.createUser(
          {
            email: DEV_USER_EMAIL,
            emailVerified: true,
            name: "Dev Tester",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          // Better Auth 1.7 asks how a user came to be (for its validateUserInfo hook).
          { method: "dev-sign-in" },
        ));
      const session = await adapter.createSession(user.id);
      await setSessionCookie(ctx, { session, user });
      return ctx.json({ ok: true });
    }),
  },
});
