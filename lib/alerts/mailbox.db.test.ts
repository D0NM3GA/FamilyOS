import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 53 against a real database: `npm run test:db`. The alert mailbox is the family's
 * setting, set by an admin on their own sign-in and logged in Recent changes; empty falls back
 * to the server's ALERT_MAILBOX.
 */
const RUN = import.meta.env.MODE === "db";

const who = { profile: null as null | Record<string, unknown>, own: true };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isSessionOwner: async () => who.own, isOwnSignIn: async () => who.own };
});

const ENV = { MICROSOFT_CLIENT_ID: "11111111-2222-4333-8444-555555555555", MICROSOFT_CLIENT_SECRET: "x", MICROSOFT_TENANT_ID: "66666666-7777-4888-8999-000000000000", ALERT_MAILBOX: "server@example.com" };

describe.skipIf(!RUN)("the alert mailbox setting (database)", () => {
  const ids = { h: "", dad: "", mom: "" };
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const h = await prisma.household.create({ data: { name: `e2e-mailbox-${Date.now()}` } });
    const mk = (firstName: string, role: "ADMIN" | "ADULT") => prisma.person.create({ data: { householdId: h.id, firstName, role, isHouseholdMember: true } });
    const [dad, mom] = await Promise.all([mk("Dad", "ADMIN"), mk("Mom", "ADULT")]);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const as = async (personId: string, own = true) => {
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: personId }, omit: { photo: true } });
    who.own = own;
  };
  const form = (mailbox: string) => {
    const f = new FormData();
    f.set("mailbox", mailbox);
    return f;
  };

  test("an admin on their own sign-in sets it, it's logged, and empty falls back to the server's", async () => {
    const { setAlertMailbox } = await import("@/app/(app)/settings/alerts/actions");
    const { alertMailbox } = await import("./email");
    expect(await alertMailbox(ids.h)).toBe("server@example.com");

    await as(ids.dad);
    expect(await setAlertMailbox({}, form(" Alerts@Example.com "))).toMatchObject({ ok: expect.stringContaining("alerts@example.com") });
    expect(await alertMailbox(ids.h)).toBe("alerts@example.com");
    expect(await setAlertMailbox({}, form("alerts@example.com"))).toEqual({ ok: "No change." });
    expect(await setAlertMailbox({}, form("not an address"))).toMatchObject({ error: expect.any(String) });

    expect(await setAlertMailbox({}, form(""))).toMatchObject({ ok: expect.stringContaining("server") });
    expect(await alertMailbox(ids.h)).toBe("server@example.com");

    const events = await prisma.signInEvent.findMany({ where: { householdId: ids.h, kind: "ALERT_MAILBOX_SET" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.actorName, e.detail])).toEqual([
      ["Dad", "alerts@example.com"],
      ["Dad", null],
    ]);
  });

  test("not on a switched profile, and not for a grown-up who isn't an admin", async () => {
    const { setAlertMailbox } = await import("@/app/(app)/settings/alerts/actions");
    await as(ids.dad, false);
    expect(await setAlertMailbox({}, form("x@example.com"))).toMatchObject({ error: expect.stringContaining("own sign-in") });
    await as(ids.mom);
    await expect(setAlertMailbox({}, form("x@example.com"))).rejects.toThrow();
    expect((await prisma.household.findUniqueOrThrow({ where: { id: ids.h } })).alertMailbox).toBeNull();
  });
});
