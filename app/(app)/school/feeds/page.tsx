import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { listStudents } from "@/lib/school/queries";
import { PageHeader } from "@/components/page-header";
import { backLink, card } from "@/components/styles";
import { ConfirmSubmit } from "@/components/submit";
import { addFeed, refreshFeedNow, removeFeed } from "./actions";
import { AddFeedForm } from "./add-feed-form";
import { RefreshButton } from "./refresh-button";
import { requireAppOn } from "@/lib/app-guard";

/** What removing a feed takes with it: its upcoming events leave School and Home. */
function removeFeedQuestion(name: string, events: number): string {
  const what = events === 0 ? "" : ` Its ${events} upcoming ${events === 1 ? "event leaves" : "events leave"} School and Home.`;
  return `Remove ${name}?${what} You can add it again with the same link.`;
}

/**
 * School calendar feeds (Phase 18.5), admin-only. The saved address is never shown again
 * (it can carry a private token); only its host.
 */
export default async function SchoolFeedsPage() {
  await requireAppOn("school");
  const viewer = await requireActiveProfile();
  if (!isAdmin(viewer)) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">Only an admin can manage school calendars.</p>
      </div>
    );
  }
  const [feeds, students] = await Promise.all([
    prisma.schoolFeed.findMany({
      where: { householdId: viewer.householdId },
      select: {
        id: true,
        name: true,
        host: true,
        lastSuccessAt: true,
        lastError: true,
        kid: { select: { firstName: true } },
        _count: { select: { events: true } },
      },
      orderBy: { name: "asc" },
    }),
    listStudents(viewer),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <Link href="/school" className={backLink}>
        ← School
      </Link>
      <PageHeader className="mt-1" title="🗓️ School calendars" />
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Subscribe to the school&apos;s calendar feed and no-school days, early release and events show up on School and Home.
        They refresh a few times a day. To see them in Outlook too, subscribe to the same link there.
      </p>

      {feeds.length > 0 && (
        <ul className="mt-6 max-w-2xl divide-y divide-border rounded-xl bg-card shadow-sm ring-1 ring-border">
          {feeds.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-bold text-foreground">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {f.host} · {f.kid ? f.kid.firstName : "Whole family"} · {f._count.events} upcoming
                  {f.lastSuccessAt && ` · updated ${formatDateTime(f.lastSuccessAt)}`}
                </p>
                {f.lastError && <p className="break-words text-xs text-destructive">{f.lastError}</p>}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <RefreshButton action={refreshFeedNow.bind(null, f.id)} name={f.name} />
                <form action={removeFeed.bind(null, f.id)}>
                  <ConfirmSubmit question={removeFeedQuestion(f.name, f._count.events)} yes="Remove" aria-label={`Remove ${f.name}`}>
                    Remove
                  </ConfirmSubmit>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className={`mt-6 max-w-2xl ${card}`}>
        <h2 className="text-lg font-extrabold text-foreground">Add a calendar</h2>
        <div className="mt-3">
          <AddFeedForm action={addFeed} students={students.map((s) => ({ id: s.id, name: s.firstName }))} />
        </div>
      </section>
    </div>
  );
}
