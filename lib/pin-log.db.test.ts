import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPin } from "@/lib/pin-hash";

/**
 * Phase 67a against a real database (`npm run test:db`): a profile that locks after wrong PINs
 * goes in the sign-in log and every admin hears, the device's grown-up included; setting a PIN
 * and taking someone off the household are logged with the change.
 */
const RUN = import.meta.env.MODE === "db";
const who = { profile: null as null | Record<string, unknown>, owner: true };
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/session")>()),
  getServerSession: async () => ({ session: { id: "this-device", createdAt: new Date() }, user: { id: `e2e-pinlog-${Date.now()}` } }),
}));
vi.mock("@/lib/active-profile", async (orig) => {
  const real = await orig<typeof import("@/lib/active-profile")>();
  return { ...real, requireActiveProfile: async () => who.profile, getAuthPerson: async () => who.profile, isSessionOwner: async () => who.owner };
});

describe.skipIf(!RUN)("the sign-in log's PIN and member entries (database)", { timeout: 60_000 }, () => {
  const t = Date.now();
  const ids = { h: "", dad: "", mom: "", ivy: "", user: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-pinlog-${t}` } });
    const user = await prisma.user.create({ data: { id: `e2e-pinlog-${t}`, name: "Dad" } });
    const [dad, mom, ivy] = await Promise.all([
      prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true, authUserId: user.id } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Mom", role: "ADULT", isHouseholdMember: true, pinHash: await hashPin("246810") } }),
      prisma.person.create({ data: { householdId: h.id, firstName: "Ivy", role: "KID", isHouseholdMember: true } }),
    ]);
    Object.assign(ids, { h: h.id, dad: dad.id, mom: mom.id, ivy: ivy.id, user: user.id });
    who.profile = await prisma.person.findUniqueOrThrow({ where: { id: dad.id }, omit: { photo: true } });
  });

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
  });

  test("five wrong PINs lock the profile, log it, and tell the admins", async () => {
    const { verifyPinAndSelect } = await import("@/app/profiles/actions");
    for (let i = 0; i < 5; i++) {
      const fd = new FormData();
      fd.set("personId", ids.mom);
      fd.set("pin", "000000");
      await verifyPinAndSelect({}, fd);
    }
    const events = await prisma.signInEvent.findMany({ where: { householdId: ids.h, kind: "PIN_LOCKED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: ids.dad, subjectId: ids.mom });
    const titles = (await prisma.notification.findMany({ where: { recipientId: ids.dad, kind: "SIGN_IN_CHANGED" } })).map((n) => n.title);
    expect(titles).toEqual(["🔐 Mom's profile locked after too many wrong PINs, on Dad's sign-in."]);
  });

  test("an admin setting a PIN, and taking someone off the household, are logged", async () => {
    const { setMemberPin, removeHouseholdMember } = await import("@/app/(app)/settings/household/actions");
    const fd = new FormData();
    fd.set("pin", "4321");
    expect(await setMemberPin(ids.ivy, {}, fd)).toEqual({ success: true });
    expect(await prisma.signInEvent.findFirst({ where: { subjectId: ids.ivy, kind: "PIN_SET" } })).toMatchObject({ actorId: ids.dad, detail: "set" });

    await expect(removeHouseholdMember(ids.ivy)).rejects.toThrow("redirect:/settings/household");
    expect(await prisma.signInEvent.count({ where: { subjectId: ids.ivy, kind: "MEMBER_REMOVED" } })).toBe(1);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: ids.ivy } })).isHouseholdMember).toBe(false);
  });

  test("a profile switched to with a PIN can't sign out the sign-in's devices", async () => {
    const { signOutDevice, signOutEverywhereElse } = await import("@/app/(app)/settings/devices/actions");
    const other = await prisma.session.create({ data: { userId: ids.user, token: `tok-${t}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    who.owner = false;
    try {
      await expect(signOutDevice(other.id)).rejects.toThrow("redirect:/settings/devices");
      await expect(signOutEverywhereElse()).rejects.toThrow("redirect:/settings/devices");
      expect(await prisma.session.count({ where: { id: other.id } })).toBe(1);
    } finally {
      who.owner = true;
    }
  });
});
