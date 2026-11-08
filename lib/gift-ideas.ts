import { prisma } from "@/lib/prisma";
import { isAdult, type RoleBearing } from "@/lib/roles";

/**
 * Phase 70d: gift ideas on a person, kept by the grown-ups and never shown to the person they're for
 * (on their page, in their backup, or in a reminder sent to them). Given ones stay, crossed off, so
 * nobody buys the same thing twice.
 */

type Viewer = RoleBearing & { id: string; householdId: string };

export const GIFT_IDEA_MAX = 200;

/** Whether this viewer may see and change ideas for this person: a grown-up, and not them. */
export function canSeeGiftIdeas(viewer: Viewer, personId: string): boolean {
  return isAdult(viewer) && viewer.id !== personId;
}

export type GiftIdeaRow = { id: string; text: string; given: boolean; addedBy: string | null };

export async function listGiftIdeas(viewer: Viewer, personId: string): Promise<GiftIdeaRow[]> {
  if (!canSeeGiftIdeas(viewer, personId)) return [];
  const rows = await prisma.giftIdea.findMany({
    where: { householdId: viewer.householdId, personId },
    select: { id: true, text: true, givenAt: true, addedBy: { select: { firstName: true } } },
    orderBy: [{ givenAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 100,
  });
  return rows.map((r) => ({ id: r.id, text: r.text, given: r.givenAt !== null, addedBy: r.addedBy?.firstName ?? null }));
}

export type GiftResult = { ok: true } | { ok: false; error: string };

export async function addGiftIdea(viewer: Viewer, personId: string, text: string): Promise<GiftResult> {
  if (!canSeeGiftIdeas(viewer, personId)) return { ok: false, error: "Only grown-ups keep gift ideas, and never their own." };
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "Type an idea." };
  if (clean.length > GIFT_IDEA_MAX) return { ok: false, error: `Keep it under ${GIFT_IDEA_MAX} letters.` };
  const person = await prisma.person.findFirst({ where: { id: personId, householdId: viewer.householdId }, select: { id: true } });
  if (!person) return { ok: false, error: "That person isn't in this family." };
  await prisma.giftIdea.create({ data: { householdId: viewer.householdId, personId, text: clean, addedById: viewer.id } });
  return { ok: true };
}

/** Marks an idea given (or not); only ones this viewer may see. */
export async function setGiftGiven(viewer: Viewer, ideaId: string, given: boolean): Promise<GiftResult> {
  if (!isAdult(viewer)) return { ok: false, error: "Only grown-ups keep gift ideas." };
  const { count } = await prisma.giftIdea.updateMany({
    where: { id: ideaId, householdId: viewer.householdId, personId: { not: viewer.id } },
    data: { givenAt: given ? new Date() : null },
  });
  return count ? { ok: true } : { ok: false, error: "That idea isn't here anymore." };
}

export async function removeGiftIdea(viewer: Viewer, ideaId: string): Promise<GiftResult> {
  if (!isAdult(viewer)) return { ok: false, error: "Only grown-ups keep gift ideas." };
  const { count } = await prisma.giftIdea.deleteMany({ where: { id: ideaId, householdId: viewer.householdId, personId: { not: viewer.id } } });
  return count ? { ok: true } : { ok: false, error: "That idea isn't here anymore." };
}

/** How many open (not yet given) ideas each person has, for birthday reminders. */
export async function openGiftIdeaCounts(householdId: string, personIds: string[]): Promise<Map<string, number>> {
  if (personIds.length === 0) return new Map();
  const rows = await prisma.giftIdea.groupBy({ by: ["personId"], where: { householdId, personId: { in: personIds }, givenAt: null }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.personId, r._count._all]));
}
