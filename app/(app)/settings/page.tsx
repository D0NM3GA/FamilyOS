import Link from "next/link";
import { backupSignInState, isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { prisma } from "@/lib/prisma";
import { isAdmin, isAdult } from "@/lib/authz";
import { ThemePicker } from "@/components/theme-toggle";
import { getHouseholdMembers } from "@/lib/people";
import { appOn } from "@/lib/app-switches";
import { resolveViewMode } from "@/lib/view-prefs";
import { microsoftEnabled } from "@/lib/auth";
import { getFamilyLook, getHouseholdRow } from "@/lib/household-settings";
import { pendingInvites } from "@/lib/invites";
import { alertMailbox } from "@/lib/alerts/email";
import { cleanDisabledApps } from "@/lib/apps";
import { formatRelative } from "@/lib/format";
import { buildHub } from "@/lib/settings-hub";
import { btn } from "@/components/styles";
import { SettingsHub } from "./hub";
import { SetupCard } from "./setup-card";
import { loadSetupChecklist } from "./setup-facts";

export const metadata = { title: "Settings" };

const ROLE_LABEL = { ADMIN: "Admin", ADULT: "Grown-up", KID: "Kid", NONE: "Contact" } as const;

/**
 * Phase 45.3: Settings as a hub. Your own card first (who you are, the theme), then groups of
 * tiles, each saying who it changes things for and what it's set to right now, read in one
 * parallel batch (Phase 39's rule). The settings themselves live on the sub-pages, which keep
 * their addresses. Kids see only their own card, as before.
 */
export default async function SettingsPage() {
  const profile = await requireActiveProfile();
  const adult = isAdult(profile);
  const admin = isAdmin(profile);
  const none = Promise.resolve(null);

  const [signIn, owner, members, household, look, invites, phones, passkeys, hasPin, alerts, alertChannels, lastBackup, outlookSync, calendarOn, setup] = await Promise.all([
    adult && profile.authUserId ? backupSignInState(profile) : none,
    isSessionOwner(profile),
    adult ? getHouseholdMembers(profile.householdId) : Promise.resolve([]),
    admin ? getHouseholdRow(profile.householdId) : none,
    admin ? getFamilyLook(profile.householdId) : none,
    admin ? pendingInvites(profile.householdId) : Promise.resolve([]),
    adult ? prisma.pushSubscription.count({ where: { personId: profile.id } }) : 0,
    adult && profile.authUserId ? prisma.passkey.count({ where: { userId: profile.authUserId } }) : 0,
    adult ? prisma.person.count({ where: { id: profile.id, pinHash: { not: null } } }).then((n) => n > 0) : false,
    admin ? prisma.householdAlerts.findUnique({ where: { householdId: profile.householdId }, select: { teamsAppId: true } }) : none,
    // Who actually gets Teams or email: a channel is only "on" once an admin has switched it on.
    admin
      ? prisma.alertPrefs.findMany({
          where: { person: { householdId: profile.householdId, role: "ADMIN", isHouseholdMember: true } },
          select: { teamsEnabled: true, emailEnabled: true },
        })
      : Promise.resolve([]),
    adult
      ? prisma.backupEvent.findFirst({
          where: { householdId: profile.householdId, kind: "HOUSEHOLD_BACKUP" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : none,
    adult ? prisma.calendarSync.findUnique({ where: { householdId: profile.householdId }, select: { lastError: true } }) : none,
    // Phase 36: the Outlook tile goes with the Calendar app.
    appOn(profile.householdId, "calendar"),
    // Phase 45.4: what's left to set up.
    loadSetupChecklist(profile),
  ]);

  const groups = buildHub({
    adult,
    admin,
    ownSignIn: Boolean(signIn?.own),
    passkeySignIn: Boolean(signIn?.passkey),
    microsoftOwner: Boolean(adult && owner && signIn?.microsoft),
    phones,
    passkeys,
    hasPin,
    homeCalendarPicked: Boolean(profile.homeCalendarId),
    familyCalendarName: process.env.FAMILY_CALENDAR_NAME?.trim() || null,
    people: members.length,
    bigButtons: members.filter((m) => resolveViewMode(m.viewMode, isAdult(m)) === "BIG").length,
    homeSet: household?.latitude != null && household?.longitude != null,
    invitesWaiting: invites.filter((i) => !i.recovery && i.usable).length,
    look: look ? { appName: look.appName, rewardMany: look.reward.many, mascot: look.mascot.on ? look.mascot.name : null } : { appName: "", rewardMany: "", mascot: null },
    appsHidden: household ? cleanDisabledApps(household.disabledApps).length : 0,
    alertsTeams: Boolean(alerts?.teamsAppId) && alertChannels.some((p) => p.teamsEnabled),
    alertsEmail: Boolean(alertMailbox()) && alertChannels.some((p) => p.emailEnabled),
    outlookOn: adult && calendarOn && microsoftEnabled(),
    outlookSync: outlookSync ? { error: Boolean(outlookSync.lastError) } : null,
    lastBackup: lastBackup ? { at: lastBackup.createdAt, label: formatRelative(lastBackup.createdAt) } : null,
    now: new Date(),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-3xl font-extrabold text-foreground">Settings</h1>
        {adult && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each group says who it changes things for: just you, or everyone in the family. Anything that could use a look is
            marked in yellow, and says why.
          </p>
        )}
      </div>

      <SetupCard items={setup} hidden={profile.setupCardHidden} admin={admin} />

      <section aria-label="You" className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border-2 border-border bg-card p-5">
        <div className="flex min-w-0 flex-[1_1_16rem] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading text-xl font-extrabold text-foreground">
              {profile.firstName} {profile.lastName ?? ""}
            </p>
            <p className="text-sm text-muted-foreground">{ROLE_LABEL[profile.role ?? "NONE"]}</p>
          </div>
          <Link href="/profiles" className={btn}>
            Switch profile
          </Link>
        </div>
        <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-3">
          <p className="text-sm font-bold text-foreground">Theme</p>
          <div className="min-w-0 flex-1">
            <ThemePicker />
          </div>
        </div>
      </section>

      <SettingsHub groups={groups} />
    </div>
  );
}
