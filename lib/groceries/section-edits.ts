import { prisma, type Tx } from "@/lib/prisma";
import { nameTaken, sameListName } from "@/lib/list-names";
import { guessSection, MAX_SECTIONS, moveSection, STARTING_SECTIONS } from "./sections";

/**
 * Phase 37: the Store sections page's writes, scoped by household. Callers have checked the
 * person is a grown-up and validated the name and emoji (lib/list-names.ts). One write at a
 * time per household (an advisory lock), so "names are unique ignoring case", the cap and
 * "keep at least one" can't be raced past by a double tap or two phones at once.
 */

export type SectionEdit = { ok: true; name: string } | { ok: false; error: string };
export type SectionRemoval = { ok: true; name: string; moved: number; to: string | null } | { ok: false; error: string };

const GONE = { ok: false, error: "That section isn't here anymore. Reload to see the latest." } as const;
const taken = (name: string) => ({ ok: false, error: `There's already a section called ${name}.` }) as const;

async function lockSections(tx: Tx, householdId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"product_group:" + householdId}))`;
}

/** Every section in walking order: the order the page shows and Shop walks. */
function readSections(db: Tx | typeof prisma, householdId: string) {
  return db.productGroup.findMany({
    where: { householdId },
    select: { id: true, name: true, emoji: true, sortOrder: true, starterKey: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}

/** The page: sections in order, each with how many Pantry items are in it. */
export async function sectionsWithCounts(householdId: string) {
  const [sections, counts] = await Promise.all([
    readSections(prisma, householdId),
    prisma.product.groupBy({ by: ["groupId"], where: { householdId, groupId: { not: null } }, _count: { _all: true } }),
  ]);
  const countOf = new Map(counts.map((c) => [c.groupId, c._count._all]));
  return sections.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, items: countOf.get(s.id) ?? 0 }));
}

/** The section a brand-new item named `name` is guessed into: its starting section, if the family kept it. */
export async function guessedSectionId(householdId: string, name: string): Promise<string | null> {
  const starterKey = guessSection(name);
  if (!starterKey) return null;
  const group = await prisma.productGroup.findUnique({ where: { householdId_starterKey: { householdId, starterKey } }, select: { id: true } });
  return group?.id ?? null;
}

export async function renameSection(householdId: string, id: string, input: { name: string; emoji: string | null }): Promise<SectionEdit> {
  return prisma.$transaction(async (tx) => {
    await lockSections(tx, householdId);
    const all = await readSections(tx, householdId);
    const section = all.find((s) => s.id === id);
    if (!section) return GONE;
    if (nameTaken(input.name, all, section.id)) return taken(input.name);
    await tx.productGroup.update({ where: { id: section.id }, data: { name: input.name, emoji: input.emoji } });
    return { ok: true, name: input.name };
  });
}

/**
 * A new section goes at the end of the walk. One named like a starting section the family
 * removed earlier takes its key back, so its guesses come back with it.
 */
export async function addSection(householdId: string, input: { name: string; emoji: string | null }): Promise<SectionEdit> {
  return prisma.$transaction(async (tx) => {
    await lockSections(tx, householdId);
    const all = await readSections(tx, householdId);
    if (all.length >= MAX_SECTIONS) return { ok: false, error: "That's a lot of sections already. Remove one you don't need first." };
    if (nameTaken(input.name, all)) return taken(input.name);
    const starter = STARTING_SECTIONS.find((s) => sameListName(s.name, input.name));
    const starterKey = starter && !all.some((s) => s.starterKey === starter.key) ? starter.key : null;
    const sortOrder = all.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
    await tx.productGroup.create({ data: { householdId, name: input.name, emoji: input.emoji, sortOrder, starterKey } });
    return { ok: true, name: input.name };
  });
}

/** One step up or down the walk. False when it can't move (already at that end, or gone). */
export async function moveSectionStep(householdId: string, id: string, direction: "up" | "down"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockSections(tx, householdId);
    const all = await readSections(tx, householdId);
    const order = moveSection(
      all.map((s) => s.id),
      id,
      direction,
    );
    if (!order) return false;
    const was = new Map(all.map((s) => [s.id, s.sortOrder]));
    for (const [i, sectionId] of order.entries()) {
      if (was.get(sectionId) !== i) await tx.productGroup.update({ where: { id: sectionId }, data: { sortOrder: i } });
    }
    return true;
  });
}

/**
 * Removes a section, moving its items to another section (or to no section) first, in one
 * transaction. The last section stays: with none at all, the starting twelve would be seeded
 * again on the next visit.
 */
export async function removeSection(householdId: string, id: string, targetId: string | null): Promise<SectionRemoval> {
  return prisma.$transaction(async (tx) => {
    await lockSections(tx, householdId);
    const all = await readSections(tx, householdId);
    const section = all.find((s) => s.id === id);
    if (!section) return GONE;
    if (all.length <= 1) return { ok: false, error: "Keep at least one section. Rename this one instead." };
    const target = targetId ? all.find((s) => s.id === targetId && s.id !== section.id) : null;
    if (targetId && !target) return { ok: false, error: "That section isn't here anymore. Pick another one." };
    const { count } = await tx.product.updateMany({ where: { householdId, groupId: section.id }, data: { groupId: target?.id ?? null } });
    await tx.productGroup.delete({ where: { id: section.id } });
    return { ok: true, name: section.name, moved: count, to: target?.name ?? null };
  });
}
