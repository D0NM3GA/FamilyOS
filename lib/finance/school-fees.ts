import type { prisma, Tx } from "@/lib/prisma";

type Db = Tx | typeof prisma;

/**
 * Phase 63b: open school fees with an amount and a due day, for a jar that counts them
 * (MoneyJar.countSchoolFees). Money may read School (School never reads Money); queried directly,
 * since the finance zone can't import School's modules. Jar members are grown-ups, so a fee's
 * title reaches nobody new.
 */
export type SchoolFee = { taskId: string; name: string; amountCents: number; due: string };

/** A local-midnight Date as "YYYY-MM-DD" (school due days are stored at local midnight, not UTC). */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function readSchoolFees(db: Db, householdId: string): Promise<SchoolFee[]> {
  const tasks = await db.schoolTask.findMany({
    where: { householdId, kind: "FEE", status: "OPEN", amountCents: { gt: 0 }, dueDate: { not: null } },
    select: { id: true, title: true, amountCents: true, dueDate: true, kid: { select: { firstName: true } } },
    orderBy: { dueDate: "asc" },
  });
  return tasks.map((t) => ({
    taskId: t.id,
    name: t.kid ? `${t.kid.firstName}'s ${t.title}` : t.title,
    amountCents: t.amountCents!,
    due: localDay(t.dueDate!),
  }));
}
