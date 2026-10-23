"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdult } from "@/lib/authz";
import { isSessionOwner } from "@/lib/active-profile";
import { encryptSecret } from "@/lib/crypto";
import { checkTeamsWebhookUrl, householdTeamsAad } from "@/lib/alerts/teams";
import { alertMailbox } from "@/lib/alerts/email";
import { ConfigError, householdTeamsUrl, recipientEmail, sendTest, teamsRecipient, type Channel } from "@/lib/alerts/dispatch";
import { findAlertTarget } from "@/lib/alerts/targets";
import { isAllowedPushEndpoint, isValidUaPublicKey } from "@/lib/alerts/webpush";
import { deviceOwner, forgetDevice, registerDevice, removeAdminDevice, removeOwnDevice } from "@/lib/alerts/devices";
import { getVapidState, replaceStoredVapid } from "@/lib/alerts/vapid";

/**
 * Phase 21.5: the family's alert settings. Any admin may switch alerts for any admin in the
 * household (so a parent who never opens Settings still gets them). The family Teams link
 * is a shared secret, so changing it also needs the admin's own Microsoft sign-in — not a
 * profile reached by PIN-switching — and records who did it. The link only ever goes
 * client → server, gets validated and encrypted, and is never sent back.
 */
export type AlertFormState = { error?: string; ok?: string };

function done() {
  revalidatePath("/settings/alerts");
  revalidatePath("/settings/notifications");
}

async function requireLinkOwner() {
  const profile = await requireAdmin();
  if (!(await isSessionOwner(profile))) {
    return { profile, error: "Use the app on your own sign-in to change the family's Teams link." };
  }
  return { profile, error: null };
}

export async function saveTeamsLink(_prev: AlertFormState, formData: FormData): Promise<AlertFormState> {
  const { profile, error } = await requireLinkOwner();
  if (error) return { error };
  const check = checkTeamsWebhookUrl(String(formData.get("url") ?? "").slice(0, 2000));
  if (!check.ok) return { error: check.reason };
  const enc = encryptSecret(check.url, householdTeamsAad(profile.householdId));
  const data = {
    teamsWebhookEnc: new Uint8Array(enc.encryptedValue),
    teamsWebhookIv: new Uint8Array(enc.iv),
    teamsWebhookTag: new Uint8Array(enc.authTag),
    teamsWebhookHost: check.host,
    updatedByPersonId: profile.id,
  };
  await prisma.$transaction([
    prisma.householdAlerts.upsert({
      where: { householdId: profile.householdId },
      create: { householdId: profile.householdId, ...data },
      update: data,
    }),
    // A new link is a fresh start for everyone's Teams status.
    prisma.alertPrefs.updateMany({ where: { person: { householdId: profile.householdId } }, data: { lastErrorTeams: null } }),
  ]);
  done();
  return { ok: "The family's Teams link is saved. Try “Send a test” for someone below." };
}

/** Keeps everyone's on/off choices, so pasting a new link later picks up where it left off. */
export async function disconnectTeams(): Promise<AlertFormState> {
  const { profile, error } = await requireLinkOwner();
  if (error) return { error };
  await prisma.$transaction([
    prisma.householdAlerts.updateMany({
      where: { householdId: profile.householdId },
      data: { teamsWebhookEnc: null, teamsWebhookIv: null, teamsWebhookTag: null, teamsWebhookHost: null, updatedByPersonId: profile.id },
    }),
    // Old Teams errors would read like live problems under a disconnected link.
    prisma.alertPrefs.updateMany({ where: { person: { householdId: profile.householdId } }, data: { lastErrorTeams: null } }),
  ]);
  done();
  return { ok: "Teams is disconnected for the family." };
}

const channel = z.enum(["teams", "email"]);
const testChannel = z.enum(["teams", "email", "push"]);
const id = z.string().min(1).max(64);

export async function setChannel(personId: string, ch: Channel, enabled: boolean): Promise<AlertFormState> {
  const profile = await requireAdmin();
  const input = z.object({ personId: id, ch: channel, enabled: z.boolean() }).safeParse({ personId, ch, enabled });
  if (!input.success) return { error: "Something went wrong. Try again." };
  const target = await findAlertTarget(profile.householdId, input.data.personId);
  if (!target) return { error: "Only admins in this family get store alerts." };

  if (input.data.enabled && input.data.ch === "email") {
    if (!alertMailbox()) return { error: "The alert mailbox isn't set up yet." };
    if (!recipientEmail(target)) return { error: `There's no email address for ${target.firstName}.` };
  }
  if (input.data.enabled && input.data.ch === "teams") {
    // Must actually decrypt, not just exist: switching on against a broken link would
    // "succeed" and then nothing would ever arrive.
    let url: string | null;
    try {
      url = await householdTeamsUrl(profile.householdId);
    } catch (err) {
      return { error: err instanceof ConfigError ? err.message : "Something went wrong. Try again." };
    }
    if (!url) return { error: "Connect the family's Teams link first." };
    if (!teamsRecipient(target)) {
      return { error: `${target.firstName} needs to sign in here with Microsoft once before Teams can reach them.` };
    }
  }
  const data = input.data.ch === "teams" ? { teamsEnabled: input.data.enabled } : { emailEnabled: input.data.enabled };
  await prisma.alertPrefs.upsert({ where: { personId: target.id }, create: { personId: target.id, ...data }, update: data });
  done();
  return {};
}

// One test per recipient every 10 seconds (any admin can test anyone, so key by target).
// In-memory, so it resets on restart: a courtesy, not a security control.
const lastTest = new Map<string, number>();

export async function sendTestAlert(personId: string, ch: Channel): Promise<AlertFormState> {
  const profile = await requireAdmin();
  const input = z.object({ personId: id, ch: testChannel }).safeParse({ personId, ch });
  if (!input.success) return { error: "Something went wrong. Try again." };
  const target = await findAlertTarget(profile.householdId, input.data.personId);
  if (!target) return { error: "Only admins in this family get store alerts." };
  const now = Date.now();
  if (now - (lastTest.get(target.id) ?? 0) < 10_000) return { error: "Give it a few seconds before another test." };
  lastTest.set(target.id, now);
  const error = await sendTest(profile.householdId, target.id, input.data.ch);
  done();
  if (error) return { error };
  if (input.data.ch === "teams") {
    return { ok: `Teams accepted it. ${target.firstName} should see it in a moment; if not, check the workflow's run history.` };
  }
  return input.data.ch === "push" ? { ok: `Sent to ${target.firstName}'s phone.` } : { ok: `Sent to ${target.firstName}'s inbox.` };
}

// ---------- Phone push (Phase 21.6) ----------

const b64u = (len: number) =>
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+=*$/)
    .transform((s) => Buffer.from(s, "base64url"))
    .refine((b) => b.length === len);

const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint),
  keys: z.object({ p256dh: b64u(65).refine(isValidUaPublicKey), auth: b64u(16) }),
});

/**
 * "Turn on alerts on this phone": saves this browser's subscription for the active grown-up
 * (any adult, not only admins: money alerts go to every jar member's phone, Phase 27).
 * A shared family device belongs to whoever turned it on last, so an existing row for the
 * same endpoint is reassigned — but only within this household. No session-owner check:
 * this is the browser's own subscription, and a shared iPad switched to Mom should alert Mom.
 */
export async function saveThisDevice(sub: unknown): Promise<AlertFormState & { previous?: string }> {
  const profile = await requireAdult();
  const parsed = subscriptionSchema.safeParse(sub);
  if (!parsed.success) return { error: "This browser's push details didn't look right. Try again." };
  const { endpoint, keys } = parsed.data;
  // Stored unpadded so equality and the unique endpoint stay stable.
  const res = await registerDevice(profile.householdId, profile.id, {
    endpoint,
    p256dh: keys.p256dh.toString("base64url"),
    auth: keys.auth.toString("base64url"),
  });
  if (!res.ok) return { error: "This phone is set up for another family, so it can't be added here." };
  done();
  return {
    ok: res.previous ? `This phone now alerts you instead of ${res.previous}.` : "Phone alerts are on for this phone.",
    previous: res.previous ?? undefined,
  };
}

/** Who this browser's subscription currently alerts (for "This phone alerts Dad"). */
export async function whoseDevice(endpoint: string): Promise<{ name: string; isMe: boolean } | null> {
  const profile = await requireAdult();
  if (typeof endpoint !== "string" || endpoint.length > 2048) return null;
  const row = await deviceOwner(profile.householdId, endpoint);
  return row ? { name: row.person.firstName, isMe: row.personId === profile.id } : null;
}

/** "Turn off on this phone": removes this browser's row, whoever it's assigned to. */
export async function turnOffThisDevice(endpoint: string): Promise<AlertFormState> {
  const profile = await requireAdult();
  if (typeof endpoint !== "string" || endpoint.length > 2048) return { error: "Something went wrong. Try again." };
  await forgetDevice(profile.householdId, endpoint);
  done();
  return { ok: "Phone alerts are off for this phone." };
}

/** My notifications: remove one of your own phones (a lost or replaced one). */
export async function removeMyDevice(deviceId: string): Promise<AlertFormState> {
  const profile = await requireAdult();
  const parsed = id.safeParse(deviceId);
  if (!parsed.success) return { error: "Something went wrong. Try again." };
  const count = await removeOwnDevice(profile.id, parsed.data);
  done();
  return count === 1 ? { ok: "Removed." } : { error: "That phone was already removed." };
}

/** Remove a listed device — any admin for any admin, e.g. a lost phone. */
export async function removeDevice(deviceId: string): Promise<AlertFormState> {
  const profile = await requireAdmin();
  const parsed = id.safeParse(deviceId);
  if (!parsed.success) return { error: "Something went wrong. Try again." };
  const count = await removeAdminDevice(profile.householdId, parsed.data);
  done();
  return count === 1 ? { ok: "Removed." } : { error: "That phone was already removed." };
}

/**
 * Phase 45.2: new phone-alert keys, for when the stored ones can't be read (the server's
 * INTEGRATION_ENCRYPTION_KEY changed). Admins, asked first in place: every phone's
 * subscription goes with the old keys, so each person turns alerts on again. Only offered when
 * the keys are the server's own and unreadable; keys in `.env` are the server owner's to fix.
 */
export async function resetPhoneAlertKeys(): Promise<AlertFormState> {
  await requireAdmin();
  const state = await getVapidState();
  if (state.ok || state.reason !== "unreadable") return { error: "The phone-alert keys are fine; nothing to replace." };
  await replaceStoredVapid();
  done();
  return { ok: "New phone-alert keys are ready. Everyone who wants phone alerts turns them on again, on each phone." };
}
