import type { Instance } from "@/components/tasks/task-instance-card";
import type { getBoardInstances } from "@/lib/tasks/queries";

type BoardInstance = Awaited<ReturnType<typeof getBoardInstances>>["overdue"][number];

/**
 * TaskInstanceCard is a client component, so every field it's handed serializes into the
 * page's HTML/RSC payload. getBoardInstances only omits `photo` from assignedTo/completedBy
 * — everything else on those Person rows (pinHash, email, phone, notes, authUserId) would
 * otherwise ship to every browser. Narrow to exactly what the card needs before crossing
 * that boundary. Shared by Chores, Meds and Home's big-buttons view (Phase 19.5) so the
 * narrowing can't drift between three copies.
 */
export function toCardInstance(i: BoardInstance): Instance {
  return {
    id: i.id,
    dueDate: i.dueDate,
    status: i.status,
    completedAt: i.completedAt,
    definition: { title: i.definition.title, points: i.definition.points },
    assignedTo: i.assignedTo
      ? { id: i.assignedTo.id, firstName: i.assignedTo.firstName, lastName: i.assignedTo.lastName }
      : null,
    completedBy: i.completedBy ? { id: i.completedBy.id, firstName: i.completedBy.firstName } : null,
  };
}
