import { prisma } from "@/lib/prisma";

/**
 * Phase 21.6: phone (push subscription) bookkeeping, kept out of the server actions so the
 * household rules are DB-tested. A shared family device belongs to whoever registered it
 * last — but only within one household.
 */

export type DeviceKeys = { endpoint: string; p256dh: string; auth: string };

export type RegisterResult = { ok: true; previous: string | null } | { ok: false; reason: "otherHousehold" };

export async function registerDevice(householdId: string, personId: string, d: DeviceKeys): Promise<RegisterResult> {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: d.endpoint },
    select: { personId: true, person: { select: { householdId: true, firstName: true } } },
  });
  if (existing && existing.person.householdId !== householdId) return { ok: false, reason: "otherHousehold" };
  const data = { personId, p256dh: d.p256dh, auth: d.auth, failureCount: 0 };
  await prisma.pushSubscription.upsert({ where: { endpoint: d.endpoint }, create: { endpoint: d.endpoint, ...data }, update: data });
  await prisma.alertPrefs.updateMany({ where: { personId }, data: { lastErrorPush: null } });
  return { ok: true, previous: existing && existing.personId !== personId ? existing.person.firstName : null };
}

/** Who this browser's subscription alerts, within the household (first name only). */
export async function deviceOwner(householdId: string, endpoint: string) {
  return prisma.pushSubscription.findFirst({
    where: { endpoint, person: { householdId } },
    select: { personId: true, person: { select: { firstName: true } } },
  });
}

/** "Turn off on this phone": this browser's row, whoever in the household it belongs to. */
export async function forgetDevice(householdId: string, endpoint: string): Promise<number> {
  const res = await prisma.pushSubscription.deleteMany({ where: { endpoint, person: { householdId } } });
  return res.count;
}

/** "Remove" on My notifications: one of your own phones. */
export async function removeOwnDevice(personId: string, deviceId: string): Promise<number> {
  const res = await prisma.pushSubscription.deleteMany({ where: { id: deviceId, personId } });
  return res.count;
}

/** "Remove" in someone's row: any admin for any current admin of the household (lost phone). */
export async function removeAdminDevice(householdId: string, deviceId: string): Promise<number> {
  const res = await prisma.pushSubscription.deleteMany({
    where: { id: deviceId, person: { householdId, isHouseholdMember: true, role: "ADMIN" } },
  });
  return res.count;
}
