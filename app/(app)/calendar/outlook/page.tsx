import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getHouseholdSettings } from "@/lib/household-settings";
import { formatDateTime } from "@/lib/format";
import { calendarWriteGranted } from "@/lib/calendar-sync/access";
import { getDisabledApps } from "@/lib/app-switches";
import { APPS, isAppOn } from "@/lib/apps";
import { connectCalendar, disconnectCalendar, forgetCalendar, grantCalendarAccess, syncNow, updateCalendarOptions } from "./actions";
import { PageHeader } from "@/components/page-header";
import { backLink, sectionTitle } from "@/components/styles";
import { ConnectForm, DisconnectForm, ForgetForm, GrantAccessButton, OptionsForm, SyncNowForm } from "./forms";
import { requireAppOn } from "@/lib/app-guard";
import { signInKind } from "@/lib/sign-in-kind";
import { microsoftEnabled } from "@/lib/auth";

/**
 * Family calendar in Outlook (Phase 17): a dedicated calendar the app keeps filled with
 * birthdays, car maintenance and (optionally) chores and meds. It lives in the connecting
 * admin's mailbox and is shared with the family from Outlook. Outside the domain zones
 * (like /data): it reads every domain through lib/calendar-sync. A sub-page of the
 * in-app calendar (/calendar), which links here as "Outlook sync".
 */
export default async function OutlookSyncPage({ searchParams }: { searchParams: Promise<{ grant?: string }> }) {
  await requireAppOn("calendar");
  const profile = await requireActiveProfile();
  if (!isAdult(profile)) {
    return (
      <div className="p-4 sm:p-6">
        <Link href="/calendar" className={backLink}>
          ← Calendar
        </Link>
        <p className="text-sm text-muted-foreground">Ask a grown-up to set up the family calendar.</p>
      </div>
    );
  }

  const [sync, sessionOwner, household, disabled] = await Promise.all([
    prisma.calendarSync.findUnique({ where: { householdId: profile.householdId }, include: { owner: { select: { firstName: true } } } }),
    isSessionOwner(profile),
    getHouseholdSettings(profile.householdId),
    getDisabledApps(profile.householdId),
  ]);
  // Phase 36: the sync leaves turned-off apps out whatever's ticked below (lib/calendar-sync/events.ts).
  const offSources = APPS.filter((a) => ["chores", "meds", "school", "cars"].includes(a.id) && !isAppOn(disabled, a.id)).map((a) => a.label);
  // The calendar is made in, and written with, a Microsoft mailbox (Phase 40.1b: not a passkey).
  const canConnect = isAdmin(profile) && sessionOwner && (await signInKind(profile)) === "microsoft";
  const granted = canConnect ? await calendarWriteGranted(profile.authUserId!) : false;
  const isOwner = sync != null && sync.ownerPersonId === profile.id && sessionOwner;
  // The grant's link flow comes back here with ?grant=failed when Microsoft or the link refused.
  const grantFailed = (await searchParams).grant === "failed";

  return (
    <div className="p-4 sm:p-6">
      <Link href="/calendar" className={backLink}>
        ← Calendar
      </Link>
      <PageHeader title="⚙️ Family calendar in Outlook" />
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The app keeps its own Outlook calendar filled in, so birthdays and car maintenance show up next to everything else on
        your phone. It updates when its owner uses the app (every half hour at most) or taps Sync now.
      </p>

      <section className="mt-6 max-w-2xl space-y-4 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        {!sync ? (
          canConnect ? (
            <>
              {!granted && (
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    First, let the app write to your Outlook calendars. Microsoft will ask you to approve it.
                  </p>
                  {grantFailed && <p className="text-sm text-destructive">Microsoft didn&apos;t finish granting access. Try again.</p>}
                  <GrantAccessButton action={grantCalendarAccess} />
                </div>
              )}
              {granted && <ConnectForm action={connectCalendar} defaultName={household.name} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {microsoftEnabled()
                ? "Not set up yet. An admin signed in with Microsoft (not a switched profile) can connect it here."
                : "This needs Microsoft sign-in, which isn't set up on this install."}
            </p>
          )
        ) : (
          <>
            <div>
              <p className="text-sm font-medium text-foreground">
                &ldquo;{sync.calendarName}&rdquo; in {sync.owner.firstName}&apos;s Outlook
              </p>
              <p className="text-xs text-muted-foreground">
                {sync.lastSyncedAt ? `Last synced ${formatDateTime(sync.lastSyncedAt)}: ${sync.lastResult ?? ""}` : "Not synced yet."}
              </p>
              {sync.lastError && <p className="mt-1 text-sm text-destructive">{sync.lastError}</p>}
            </div>
            {isOwner ? (
              <>
                {canConnect && !granted && (
                  <div className="space-y-2">
                    <p className="text-sm text-foreground">Calendar write access is missing from your sign-in.</p>
                    <GrantAccessButton action={grantCalendarAccess} />
                  </div>
                )}
                <SyncNowForm action={syncNow} />
                <div className="border-t border-border pt-4">
                  <h2 className={sectionTitle}>What goes on it</h2>
                  {offSources.length > 0 && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Turned off in Settings → Apps, so left off the calendar for now: {offSources.join(", ")}.
                    </p>
                  )}
                  <div className="mt-2">
                    <OptionsForm
                      action={updateCalendarOptions}
                      options={{
                        includeDates: sync.includeDates,
                        includeVehicles: sync.includeVehicles,
                        includeChores: sync.includeChores,
                        includeMeds: sync.includeMeds,
                        includeSchoolTasks: sync.includeSchoolTasks,
                        includeAssignments: sync.includeAssignments,
                      }}
                    />
                  </div>
                </div>
                <div className="border-t border-border pt-4 text-sm text-muted-foreground">
                  <h2 className={sectionTitle}>Share it with the family</h2>
                  <p className="mt-1">
                    In Outlook, right-click &ldquo;{sync.calendarName}&rdquo; → Sharing and permissions → add each person
                    with &ldquo;Can view all details&rdquo;. Edits made in Outlook are replaced when the app next updates that
                    event.
                  </p>
                </div>
                <div className="border-t border-border pt-4">
                  <h2 className={sectionTitle}>Disconnect</h2>
                  <div className="mt-2">
                    <DisconnectForm action={disconnectCalendar} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Only {sync.owner.firstName}, signed in with Microsoft, can sync or change this calendar.
                </p>
                {isAdmin(profile) && (
                  <div className="border-t border-border pt-4">
                    <p className="mb-2 text-xs text-muted-foreground">
                      If {sync.owner.firstName} can&apos;t sign in any more, stop using it here and connect a new one.
                    </p>
                    <ForgetForm action={forgetCalendar} />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
