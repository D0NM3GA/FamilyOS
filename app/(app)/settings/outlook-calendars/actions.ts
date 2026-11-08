"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { listMailboxCalendars } from "@/lib/graph/app-calendar";
import { householdMailboxes } from "@/lib/outlook-copy/mailbox";
import { refreshOutlookCalendar } from "@/lib/outlook-copy/copy";
import { captureError } from "@/lib/observability";

/**
 * Phase 70a: admins choose which Outlook calendars the app copies: each person's own, and one
 * family calendar. Every choice is checked against the mailbox the app works out itself (a person
 * id comes in, never an address), then copied at once so the page can say whether it worked.
 */

const PAGE = "/settings/outlook-calendars";
const idOf = (formData: FormData, key: string) => String(formData.get(key) ?? "").slice(0, 200);

/** Copies one calendar now; a failure is already on its row as fixed text. */
async function copyNow(id: string) {
  try {
    await refreshOutlookCalendar(id);
  } catch {
    captureError(new Error(`outlook copy failed (calendar ${id})`));
  }
}

function done(code: string): never {
  revalidatePath("/", "layout");
  redirect(`${PAGE}?done=${code}`);
}

export async function copyPersonCalendar(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const personId = idOf(formData, "personId");
  const mailbox = (await householdMailboxes(admin.householdId)).get(personId);
  if (!mailbox) redirect(`${PAGE}?error=noMailbox`);
  const row = await prisma.outlookCalendar.upsert({
    where: { householdId_kind_personId: { householdId: admin.householdId, kind: "PERSON", personId } },
    create: { householdId: admin.householdId, kind: "PERSON", personId, mailbox: mailbox.mailbox },
    update: { mailbox: mailbox.mailbox, graphCalendarId: null, active: true, lastError: null, retryAfterUntil: null },
    select: { id: true },
  });
  await copyNow(row.id);
  done("person");
}

export async function stopPersonCalendar(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const personId = idOf(formData, "personId");
  await prisma.outlookCalendar.deleteMany({ where: { householdId: admin.householdId, kind: "PERSON", personId } });
  done("stopped");
}

export async function chooseFamilyCalendar(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const personId = idOf(formData, "personId");
  const graphCalendarId = String(formData.get("calendarId") ?? "").slice(0, 512);
  const mailbox = (await householdMailboxes(admin.householdId)).get(personId);
  if (!mailbox) redirect(`${PAGE}?error=noMailbox`);
  const listed = await listMailboxCalendars(mailbox.mailbox);
  if (!listed.ok) redirect(`${PAGE}?family=${encodeURIComponent(personId)}&error=outlook`);
  const picked = listed.calendars.find((c) => c.id === graphCalendarId);
  if (!picked) redirect(`${PAGE}?family=${encodeURIComponent(personId)}&error=notListed`);
  const data = {
    personId,
    mailbox: mailbox.mailbox,
    // The main calendar is kept as "main", so a recreated default still resolves.
    graphCalendarId: picked.isDefault ? null : picked.id,
    calendarName: picked.name,
    active: true,
    lastError: null,
    retryAfterUntil: null,
    lastFetchedAt: null,
  };
  const id = await prisma.$transaction(async (tx) => {
    const existing = await tx.outlookCalendar.findFirst({ where: { householdId: admin.householdId, kind: "FAMILY" }, select: { id: true } });
    if (existing) {
      // A different calendar: the old copy goes before the new one is read.
      await tx.outlookEvent.deleteMany({ where: { outlookCalendarId: existing.id } });
      await tx.outlookCalendar.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    return (await tx.outlookCalendar.create({ data: { householdId: admin.householdId, kind: "FAMILY", ...data }, select: { id: true } })).id;
  });
  await copyNow(id);
  done("family");
}

export async function stopFamilyCalendar(): Promise<void> {
  const admin = await requireAdmin();
  await prisma.outlookCalendar.deleteMany({ where: { householdId: admin.householdId, kind: "FAMILY" } });
  done("stopped");
}

/** Copies every calendar now (Check access), whatever its age. */
export async function copyAllNow(): Promise<void> {
  const admin = await requireAdmin();
  const calendars = await prisma.outlookCalendar.findMany({ where: { householdId: admin.householdId, active: true }, select: { id: true } });
  for (const c of calendars) await copyNow(c.id);
  done("checked");
}
