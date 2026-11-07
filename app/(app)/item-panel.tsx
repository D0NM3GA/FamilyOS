import { prisma } from "@/lib/prisma";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { getPanel } from "@/lib/work-items/panel";
import { itemParam, type ItemRef } from "@/lib/work-items/history";
import { formatDateTime } from "@/lib/format";
import { getHouseholdSettings } from "@/lib/household-settings";
import { sectionTitle } from "@/components/styles";
import { ItemStatus, PanelShell } from "./item-panel-parts";
import { PanelAssignmentForms, PanelTaskForm } from "./item-panel-forms";
import { gradeAssignment, setAssignmentDetails, updateTask } from "./school/actions";

/**
 * Phase 59.4a: the side panel for one chore, piece of schoolwork or form, opened from a list row
 * (?item=TYPE:id). Its pill, a few facts, what the viewer may change, and its history. An item the
 * viewer can't see shows nothing, as if the link were wrong.
 */
export async function ItemPanel({ itemRef, closeHref }: { itemRef: ItemRef; closeHref: string }) {
  const viewer = await requireActiveProfile();
  const panel = await getPanel(viewer, itemRef);
  if (!panel) return null;
  const zone = (await getHouseholdSettings(viewer.householdId)).timezone ?? undefined;
  const refParam = itemParam(itemRef.type, itemRef.id);
  const people =
    panel.type === "SCHOOL_TASK"
      ? await prisma.person.findMany({
          where: { householdId: viewer.householdId, isHouseholdMember: true },
          select: { id: true, firstName: true, role: true },
          orderBy: { firstName: "asc" },
        })
      : [];

  return (
    <PanelShell title={panel.item.title} closeHref={closeHref}>
      <div className="space-y-2">
        <ItemStatus item={panel.item} refParam={refParam} />
        {panel.facts.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {panel.facts.map((f) => (
              <li key={f} className="whitespace-pre-line">
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      {panel.type === "ASSIGNMENT" && (panel.details || panel.grade) && (
        <PanelAssignmentForms
          closeHref={closeHref}
          details={panel.details ? { action: setAssignmentDetails.bind(null, itemRef.id), defaults: panel.details } : null}
          grade={panel.grade ? { action: gradeAssignment.bind(null, itemRef.id), defaults: panel.grade } : null}
        />
      )}
      {panel.type === "SCHOOL_TASK" && isAdult(viewer) && (
        <PanelTaskForm
          closeHref={closeHref}
          action={updateTask.bind(null, itemRef.id)}
          defaults={panel.edit}
          kids={people.filter((p) => p.role === "KID").map((p) => ({ id: p.id, name: p.firstName }))}
          adults={people.filter((p) => p.role !== "KID").map((p) => ({ id: p.id, name: p.firstName }))}
        />
      )}

      <div>
        <h3 className={sectionTitle}>History</h3>
        {panel.history.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol className="mt-1 space-y-1.5 text-sm">
            {panel.history.map((h) => (
              <li key={h.id}>
                <span className="font-bold text-foreground">{h.who ?? "Someone"}</span> <span className="text-foreground">{h.text}</span>
                <span className="block text-xs text-muted-foreground">{formatDateTime(h.at, zone)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </PanelShell>
  );
}
