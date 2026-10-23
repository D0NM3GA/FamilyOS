import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { toISODate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { updateAssignment } from "../../../actions";
import { AssignmentForm } from "../../../forms";
import { backLink } from "@/components/styles";
import { requireAppOn } from "@/lib/app-guard";

/** Adults: edit an assignment, including its grade. */
export default async function EditAssignmentPage({ params }: { params: Promise<{ kidId: string; assignmentId: string }> }) {
  await requireAppOn("school");
  const viewer = await requireActiveProfile();
  if (!isAdult(viewer)) notFound();
  const { kidId, assignmentId } = await params;
  const a = await prisma.schoolAssignment.findFirst({
    where: { id: assignmentId, profile: { personId: kidId, person: { householdId: viewer.householdId } } },
    include: { profile: { select: { person: { select: { firstName: true } } } } },
  });
  if (!a) notFound();

  return (
    <div className="p-4 sm:p-6">
      <Link href={`/school?kid=${kidId}`} className={backLink}>
        ← School
      </Link>
      <PageHeader className="mt-1" title={`${a.profile.person.firstName}: ${a.title}`} />
      <div className="mt-6 max-w-lg">
        <AssignmentForm
          action={updateAssignment.bind(null, a.id)}
          canGrade
          startOpen
          submitLabel="Save"
          defaults={{
            className: a.className,
            title: a.title,
            dueDate: a.dueDate ? toISODate(a.dueDate) : "",
            status: a.status,
            score: a.score,
            maxScore: a.maxScore,
            notes: a.notes,
          }}
        />
      </div>
    </div>
  );
}
