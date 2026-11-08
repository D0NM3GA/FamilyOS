import Link from "next/link";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { microsoftEnabled } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { getHouseholdMembers, shortNames } from "@/lib/people";
import { COPY_ERRORS, listMailboxCalendars } from "@/lib/graph/app-calendar";
import { householdMailboxes } from "@/lib/outlook-copy/mailbox";
import { ConfirmSubmit, SubmitButton } from "@/components/submit";
import { backLink, btn, btnPrimary } from "@/components/styles";
import { chooseFamilyCalendar, copyAllNow, copyPersonCalendar, stopFamilyCalendar, stopPersonCalendar } from "./actions";

export const metadata = { title: "Outlook calendars" };

const DONE: Record<string, string> = {
  person: "Saved. Their calendar is copied from now on.",
  family: "Saved. The family calendar is copied from now on.",
  stopped: "Stopped. Its events are gone from the app.",
  checked: "Copied again. Each calendar below says how it went.",
  checkedSomeWaiting: "Copied again, except where Outlook asked the app to wait. Each calendar below says how it went.",
};
const ERRORS: Record<string, string> = {
  noMailbox: "There's no mailbox for them yet: add their email on their People page.",
  outlook: "Outlook didn't list that mailbox's calendars. Check the Exchange setup in the README (Outlook calendars).",
  notListed: "That calendar isn't in their mailbox anymore. Pick another.",
};

type Row = { id: string; kind: "PERSON" | "FAMILY"; personId: string; calendarName: string | null; lastSuccessAt: Date | null; lastError: string | null; active: boolean };

/** Each row's state is a status, not an alert: a page with several failing rows shouldn't shout them all at once. */
function Status({ row }: { row: Row }) {
  const partial = row.lastError === COPY_ERRORS.truncated;
  if (row.lastError && !partial) return <p role="status" className="text-sm text-destructive">{row.lastError}</p>;
  if (row.lastSuccessAt)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Copied {formatRelative(row.lastSuccessAt)}.{partial && ` ${COPY_ERRORS.truncated}`}
      </p>
    );
  return <p role="status" className="text-sm text-muted-foreground">Not copied yet.</p>;
}

/**
 * Phase 70a: which Outlook calendars the app copies for everyone to see (admins). Each person's own
 * calendar shows to them and the grown-ups; the family calendar to everyone. The app reads with its
 * own token, scoped in Exchange to the family's mailboxes (README "Outlook calendars").
 */
export default async function OutlookCalendarsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; family?: string }> }) {
  const profile = await requireActiveProfile();
  const { done, error, family } = await searchParams;
  if (!isAdmin(profile)) {
    return (
      <div className="max-w-2xl space-y-4 p-4 sm:p-6">
        <Link href="/settings" className={backLink}>
          ← Settings
        </Link>
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border">Only admins choose which Outlook calendars the app copies.</p>
      </div>
    );
  }

  const [members, mailboxes, rows] = await Promise.all([
    getHouseholdMembers(profile.householdId),
    householdMailboxes(profile.householdId),
    prisma.outlookCalendar.findMany({
      where: { householdId: profile.householdId },
      select: { id: true, kind: true, personId: true, calendarName: true, lastSuccessAt: true, lastError: true, active: true },
    }),
  ]);
  // Someone the Entra check cut off has no mailbox here, so they drop out of the list.
  const people = members.filter((m) => mailboxes.has(m.id));
  const names = shortNames(members);
  const familyRow = rows.find((r) => r.kind === "FAMILY") ?? null;
  const ownRows = new Map(rows.filter((r) => r.kind === "PERSON").map((r) => [r.personId, r]));
  const pickingFor = family && mailboxes.get(family) ? family : null;
  const pickList = pickingFor ? await listMailboxCalendars(mailboxes.get(pickingFor)!.mailbox) : null;

  return (
    <div className="max-w-2xl space-y-5 p-4 sm:p-6">
      <div>
        <Link href="/settings" className={backLink}>
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Outlook calendars</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The app copies these again once they&apos;re 15 minutes old (on a visit to Home or Calendar, or its half-hourly
          background run), so everyone sees them without signing in to Microsoft. Grown-ups see every
          calendar here; kids see the family calendar and their own. Anything marked Private in Outlook shows only as
          &ldquo;Busy&rdquo;. The app only reads: nothing here changes anyone&apos;s Outlook.
        </p>
        {!microsoftEnabled() && (
          <p role="alert" className="mt-2 text-sm text-destructive">Microsoft sign-in isn&apos;t set up on this server, so nothing can be copied yet.</p>
        )}
      </div>

      {done && DONE[done] && <p role="status" className="text-sm text-green-700 dark:text-green-400">{DONE[done]}</p>}
      {error && ERRORS[error] && <p role="alert" className="text-sm text-destructive">{ERRORS[error]}</p>}

      <section aria-labelledby="family-cal" className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 id="family-cal" className="text-base font-bold text-foreground">The family calendar</h2>
        {familyRow && !pickingFor ? (
          <>
            <p className="text-sm text-foreground">
              {familyRow.calendarName ?? "Main calendar"}, in {names.get(familyRow.personId) ?? "someone"}&apos;s mailbox.
            </p>
            <Status row={familyRow} />
            <div className="flex flex-wrap gap-2">
              <Link href={`?family=${encodeURIComponent(familyRow.personId)}`} className={btn}>
                Change
              </Link>
              <form action={stopFamilyCalendar}>
                <ConfirmSubmit question="Stop copying the family calendar? Its events leave the app; Outlook keeps them." yes="Stop copying">
                  Stop copying
                </ConfirmSubmit>
              </form>
            </div>
          </>
        ) : pickingFor ? (
          !pickList?.ok ? (
            <>
              <p role="alert" className="text-sm text-destructive">{pickList?.error}</p>
              <Link href="?" className={btn}>
                Back
              </Link>
            </>
          ) : (
            <form action={chooseFamilyCalendar} className="space-y-3">
              <input type="hidden" name="personId" value={pickingFor} />
              <fieldset className="space-y-1">
                <legend className="mb-2 text-sm font-medium text-foreground">Which of {names.get(pickingFor)}&apos;s calendars is the family&apos;s?</legend>
                {pickList.calendars.map((c, i) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted">
                    <input type="radio" name="calendarId" value={c.id} defaultChecked={i === 0} required className="size-4" />
                    <span className="text-sm text-foreground">
                      {c.name}
                      {c.isDefault && <span className="text-muted-foreground"> (main calendar)</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
              {people.some((p) => p.id !== pickingFor && mailboxes.get(p.id)) && (
                <p className="text-sm text-muted-foreground">
                  Or another mailbox:{" "}
                  {people
                    .filter((p) => p.id !== pickingFor && mailboxes.get(p.id))
                    .map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link href={`?family=${encodeURIComponent(p.id)}`} className="font-bold underline">
                          {names.get(p.id)}
                        </Link>
                      </span>
                    ))}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <SubmitButton className={btnPrimary}>Copy this calendar</SubmitButton>
                <Link href="?" className={btn}>
                  Cancel
                </Link>
              </div>
            </form>
          )
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Whose mailbox is it in? Then pick it from their calendars.</p>
            <ul className="flex flex-wrap gap-2">
              {people
                .filter((p) => mailboxes.get(p.id))
                .map((p) => (
                  <li key={p.id}>
                    <Link href={`?family=${encodeURIComponent(p.id)}`} className={btn}>
                      {names.get(p.id)}
                    </Link>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="own-cals" className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 id="own-cals" className="text-base font-bold text-foreground">Everyone&apos;s own calendar</h2>
        <p className="text-sm text-muted-foreground">
          Grown-ups who sign in with Microsoft are read by their sign-in; anyone else by the email on their People page.
        </p>
        <ul className="divide-y divide-border">
          {people.map((p) => {
            const row = ownRows.get(p.id);
            const mailbox = mailboxes.get(p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{names.get(p.id)}</p>
                  {row ? (
                    <Status row={row} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {mailbox ? (mailbox.from === "microsoft" ? "By their Microsoft sign-in." : "By the email on their People page.") : "No email yet: add one on their People page."}
                    </p>
                  )}
                </div>
                {row ? (
                  <form action={stopPersonCalendar}>
                    <input type="hidden" name="personId" value={p.id} />
                    <ConfirmSubmit question={`Stop copying ${names.get(p.id)}'s calendar? Its events leave the app; Outlook keeps them.`} yes="Stop copying">
                      Stop copying
                    </ConfirmSubmit>
                  </form>
                ) : mailbox ? (
                  <form action={copyPersonCalendar}>
                    <input type="hidden" name="personId" value={p.id} />
                    <SubmitButton className={btn}>Copy their calendar</SubmitButton>
                  </form>
                ) : (
                  <Link href={`/people/${encodeURIComponent(p.id)}`} className={btn}>
                    Add an email
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {rows.some((r) => r.active) && (
        <form action={copyAllNow}>
          <SubmitButton className={btn}>Check access and copy now</SubmitButton>
        </form>
      )}
    </div>
  );
}
