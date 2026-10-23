import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ORIGIN, scratchDatabase } from "@/lib/test-support/auth-harness";

/**
 * Phase 42: Better Auth's request limits live in the database (`npm run test:db`, a scratch
 * database). Two auth handlers built separately share one limit, as the app does across a
 * restart; behind Cloudflare the client is CF-Connecting-IP, which a client can't add to.
 */
const RUN = import.meta.env.MODE === "db";

describe.skipIf(!RUN)("rate limits in the database", () => {
  const scratch = scratchDatabase("ratelimit");
  let prisma: typeof import("@/lib/prisma").prisma;
  let make: (advanced: object) => { handler: (req: Request) => Promise<Response> };

  beforeAll(async () => {
    await scratch.create();
    ({ prisma } = await import("@/lib/prisma"));
    const { betterAuth } = await import("better-auth");
    const { prismaAdapter } = await import("better-auth/adapters/prisma");
    make = (advanced) =>
      betterAuth({
        baseURL: ORIGIN,
        secret: "a-test-secret-that-is-long-enough-for-better-auth",
        database: prismaAdapter(prisma, { provider: "postgresql" }),
        // On here: Better Auth only limits in production by default.
        rateLimit: { enabled: true, storage: "database", window: 60, max: 3 },
        advanced,
      });
  }, 120_000);

  afterAll(async () => {
    await scratch.drop(prisma);
  });

  const ok = (auth: { handler: (req: Request) => Promise<Response> }, headers: Record<string, string>) =>
    auth.handler(new Request(`${ORIGIN}/api/auth/ok`, { headers })).then((r) => r.status);

  test("a limit holds across a restart (two separately built handlers)", async () => {
    const behindCloudflare = { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } };
    const before = make(behindCloudflare);
    const client = { "cf-connecting-ip": "203.0.113.7" };
    expect([await ok(before, client), await ok(before, client), await ok(before, client)]).toEqual([200, 200, 200]);
    const afterRestart = make(behindCloudflare);
    expect(await ok(afterRestart, client)).toBe(429);
    // Someone else isn't held up by it.
    expect(await ok(afterRestart, { "cf-connecting-ip": "203.0.113.8" })).toBe(200);
    expect(await prisma.rateLimit.count()).toBeGreaterThan(0);
  });

  test("behind Cloudflare, a client can't dodge its limit with its own X-Forwarded-For", async () => {
    const auth = make({ ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } });
    const client = "198.51.100.9";
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push(await ok(auth, { "cf-connecting-ip": client, "x-forwarded-for": `10.0.0.${i}, ${client}` }));
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test("the app's own settings: limits in the database, 30-day sessions that don't slide", async () => {
    const { auth, SESSION_DAYS } = await import("@/lib/auth");
    expect(auth.options.rateLimit?.storage).toBe("database");
    expect(auth.options.session?.expiresIn).toBe(SESSION_DAYS * 86_400);
    expect(auth.options.session?.disableSessionRefresh).toBe(true);
  });
});
