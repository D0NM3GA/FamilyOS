"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { signInKind } from "@/lib/sign-in-kind";
import { requireAdult, isAdult } from "@/lib/authz";
import { syncActivePersonFromEntra } from "@/lib/entra-sync";
import { relationshipInputSchema, findEquivalentRelationship, interactionTime } from "@/lib/people";
import type { Tx } from "@/lib/prisma";
import { getHouseholdSettings } from "@/lib/household-settings";

/**
 * `saved` changes on every success, so a form can tell one save from the next. `values` hands
 * back what was typed when it's refused: React clears a form after its action, even then.
 */
export type FormState = { error?: string; saved?: number; values?: Record<string, string> };

function typedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, v as string]));
}

async function assertOwnedByHousehold(personId: string, householdId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, householdId },
    omit: { photo: true },
  });
  if (!person) throw new Error("Person not found");
  return person;
}

const interactionSchema = z.object({
  type: z.enum(["CALL", "TEXT", "EMAIL", "VISIT", "NOTE"]),
  note: z.string().trim().max(2000, "Keep the note under 2,000 characters").optional(),
  /** "Called Grandma yesterday": the day it happened; blank or today means right now. */
  when: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date")
    .optional(),
});

/** `canHide`: a grown-up may mark it grown-ups only; anyone else's box is ignored. */
function parseInteraction(formData: FormData, timeZone: string, canHide: boolean) {
  const parsed = interactionSchema.safeParse({
    type: formData.get("type"),
    note: String(formData.get("note") ?? ""),
    when: String(formData.get("when") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  const occurredAt = interactionTime(parsed.data.when || null, new Date(), timeZone);
  if (!occurredAt) return { error: "That date is in the future (or too long ago)." } as const;
  return {
    data: { type: parsed.data.type, note: parsed.data.note || null, occurredAt, ...(canHide ? { adultsOnly: formData.get("adultsOnly") === "on" } : {}) },
  } as const;
}

/** The family's time zone for "which day" questions; the server's own when none is set. */
async function familyZone(householdId: string) {
  return (await getHouseholdSettings(householdId)).timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "Last contacted" follows the newest interaction, so editing or deleting one keeps it right. */
async function refreshLastContacted(tx: Tx, personId: string) {
  const { _max } = await tx.interactionLog.aggregate({ where: { personId }, _max: { occurredAt: true } });
  await tx.person.update({ where: { id: personId }, data: { lastContactedAt: _max.occurredAt } });
}

export async function logInteraction(
  personId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authPerson = await requireActiveProfile();
  await assertOwnedByHousehold(personId, authPerson.householdId);

  const parsed = parseInteraction(formData, await familyZone(authPerson.householdId), isAdult(authPerson));
  if ("error" in parsed) return { error: parsed.error };
  const { occurredAt } = parsed.data;

  await prisma.$transaction([
    prisma.interactionLog.create({ data: { personId, ...parsed.data, loggedById: authPerson.id } }),
    prisma.person.updateMany({
      where: { id: personId, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }] },
      data: { lastContactedAt: occurredAt },
    }),
  ]);

  revalidatePath(`/people/${personId}`);
  revalidatePath("/");

  return { saved: Date.now() };
}

/** Fixing a logged call or note: grown-ups, or whoever logged it. */
async function editableInteraction(personId: string, interactionId: string) {
  const profile = await requireActiveProfile();
  await assertOwnedByHousehold(personId, profile.householdId);
  const log = await prisma.interactionLog.findFirst({ where: { id: interactionId, personId }, select: { id: true, loggedById: true, adultsOnly: true } });
  // A kid edits only their own, and never one a grown-up has hidden from kids.
  if (!log || (!isAdult(profile) && (log.loggedById !== profile.id || log.adultsOnly))) throw new Error("Interaction not found");
  return profile;
}

export async function updateInteraction(personId: string, interactionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await editableInteraction(personId, interactionId);
  const parsed = parseInteraction(formData, await familyZone(profile.householdId), isAdult(profile));
  if ("error" in parsed) return { error: parsed.error };

  await prisma.$transaction(async (tx) => {
    await tx.interactionLog.update({ where: { id: interactionId }, data: parsed.data });
    await refreshLastContacted(tx, personId);
  });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/");
  return { saved: Date.now() };
}

export async function deleteInteraction(personId: string, interactionId: string): Promise<void> {
  await editableInteraction(personId, interactionId);
  await prisma.$transaction(async (tx) => {
    await tx.interactionLog.delete({ where: { id: interactionId } });
    await refreshLastContacted(tx, personId);
  });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/");
}

/**
 * Re-pulls the SIGNED-IN adult's own profile from Microsoft Graph, overwriting name/
 * email/phone/photo. Only makes sense for your own record — Graph tokens are per-account,
 * so there is no way to sync "on behalf of" someone else. The page renders this button only
 * on your own record, on your own Microsoft sign-in (Phase 40.1b), and the same checks are
 * repeated here: the sync writes the signed-in person's record, so a profile switched to with
 * a PIN must not be able to start it.
 */
export async function syncFromMicrosoft(personId: string): Promise<void> {
  const profile = await requireActiveProfile();
  if (profile.id !== personId || !(await isSessionOwner(profile))) {
    throw new Error("You can only sync your own profile.");
  }
  if ((await signInKind(profile)) !== "microsoft") {
    throw new Error("This needs a Microsoft sign-in.");
  }

  const result = await syncActivePersonFromEntra("overwrite");
  if (!result.ok) {
    throw new Error(result.error);
  }

  revalidatePath(`/people/${personId}`);
  revalidatePath("/profiles");
  revalidatePath("/");
}

const importantDateSchema = z.object({
  type: z.enum(["BIRTHDAY", "ANNIVERSARY", "OTHER"]),
  label: z.string().trim().optional(),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
});

export async function addImportantDate(
  personId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authPerson = await requireActiveProfile();
  await assertOwnedByHousehold(personId, authPerson.householdId);

  const parsed = parseImportantDate(formData);
  if ("error" in parsed) return { error: parsed.error, values: typedValues(formData) };

  await prisma.importantDate.create({ data: { personId, ...parsed.data } });

  revalidatePath(`/people/${personId}`);
  revalidatePath("/");

  return { saved: Date.now() };
}

function parseImportantDate(formData: FormData) {
  const yearRaw = String(formData.get("year") ?? "").trim();
  const parsed = importantDateSchema.safeParse({
    type: formData.get("type"),
    label: String(formData.get("label") ?? ""),
    month: formData.get("month"),
    day: formData.get("day"),
    year: yearRaw || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" } as const;
  const { type, label, month, day, year } = parsed.data;
  // Feb 30 isn't a day (Feb 29 is, for leap-year birthdays).
  if (day > new Date(2000, month, 0).getDate()) return { error: "That month doesn't have that many days." } as const;
  return { data: { type, label: label || null, month, day, year: year ?? null } } as const;
}

/** Changing or removing a birthday is a grown-up's job, like the rest of the family tree. */
async function ownedDate(personId: string, dateId: string) {
  const profile = await requireAdult();
  await assertOwnedByHousehold(personId, profile.householdId);
  const date = await prisma.importantDate.findFirst({ where: { id: dateId, personId }, select: { id: true } });
  if (!date) throw new Error("Date not found");
}

export async function updateImportantDate(personId: string, dateId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await ownedDate(personId, dateId);
  const parsed = parseImportantDate(formData);
  if ("error" in parsed) return { error: parsed.error, values: typedValues(formData) };
  await prisma.importantDate.update({ where: { id: dateId }, data: parsed.data });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/");
  return { saved: Date.now() };
}

export async function deleteImportantDate(personId: string, dateId: string): Promise<void> {
  await ownedDate(personId, dateId);
  await prisma.importantDate.delete({ where: { id: dateId } });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/");
}

/**
 * Stores one row where `type` describes what `otherPersonId` is TO `personId` — e.g. type
 * CHILD means "otherPersonId is personId's child." lib/people.ts's getPersonRelationships/
 * viewRelationship show it on both people's own pages, translating `type` (and, for OTHER,
 * `label`) for whichever side didn't originate it. Adult-gated: a family-tree edit is
 * structural data, not a quick note — matches updatePerson's own gating, not
 * addImportantDate/logInteraction's more permissive precedent.
 */
export async function addRelationship(
  personId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authPerson = await requireAdult();
  await assertOwnedByHousehold(personId, authPerson.householdId);

  const parsed = relationshipInputSchema.safeParse({
    otherPersonId: String(formData.get("otherPersonId") ?? ""),
    type: formData.get("type"),
    label: String(formData.get("label") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.otherPersonId === personId) {
    return { error: "Can't relate a person to themselves." };
  }
  // Confirms otherPersonId belongs to the same household as personId, not just to the
  // viewer's — otherwise a bound action taking an arbitrary id would let one household
  // link a person from a different household into a relationship row.
  await assertOwnedByHousehold(parsed.data.otherPersonId, authPerson.householdId);

  // Blocks both the exact stored direction (@@unique below also covers this) AND its
  // reverse-direction equivalent — "Jordan is my spouse" from Alex's page and "Alex is my
  // spouse" from Jordan's page describe the same fact and must not become two rows that
  // both pages then list twice.
  const existing = await findEquivalentRelationship(personId, parsed.data.otherPersonId, parsed.data.type);
  if (existing) {
    return { error: "That relationship already exists." };
  }

  try {
    await prisma.personRelationship.create({
      data: {
        fromId: personId,
        toId: parsed.data.otherPersonId,
        type: parsed.data.type,
        label: parsed.data.label || null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That relationship already exists." };
    }
    throw err;
  }

  revalidatePath(`/people/${personId}`);
  revalidatePath(`/people/${parsed.data.otherPersonId}`);

  return {};
}

export async function removeRelationship(
  personId: string,
  relationshipId: string,
): Promise<void> {
  const authPerson = await requireAdult();
  await assertOwnedByHousehold(personId, authPerson.householdId);

  const relationship = await prisma.personRelationship.findFirst({
    where: {
      id: relationshipId,
      OR: [{ fromId: personId }, { toId: personId }],
    },
  });
  if (!relationship) throw new Error("Relationship not found");

  await prisma.personRelationship.delete({ where: { id: relationship.id } });

  revalidatePath(`/people/${relationship.fromId}`);
  revalidatePath(`/people/${relationship.toId}`);
}

/** Home's "Haven't talked in a while": one tap logs a call or text from just now. */
export async function logQuickContact(personId: string, type: "CALL" | "TEXT"): Promise<void> {
  const formData = new FormData();
  formData.set("type", type);
  const result = await logInteraction(personId, {}, formData);
  if (result.error) throw new Error(result.error);
}
