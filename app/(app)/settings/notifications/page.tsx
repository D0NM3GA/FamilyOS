import Link from "next/link";
import { isOwnSignIn, isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin, isAdult } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getVapid } from "@/lib/alerts/vapid";
import { formatRelative } from "@/lib/format";
import { ThisDevice } from "../alerts/this-device";
import { RemoveMyDevice } from "./remove-my-device";
import { RewardWord } from "@/components/family-look";
import { SubmitButton } from "@/components/submit";
import { btn } from "@/components/styles";
import { othersSignInNoticesOn } from "@/lib/sign-in-notices";
import { saveReminders, setSignInNotices } from "./actions";
import { appOn } from "@/lib/app-switches";
import { listedKinds, readReminderPrefs, reminderChannels } from "@/lib/reminders/prefs";
import { clockText } from "@/lib/reminders/quiet";
import { field, fieldLabel } from "@/components/styles";

export const metadata = { title: "My notifications" };

/**
 * Every grown-up's own alert settings in one place: this phone, their other phones, and
 * which jars' money alerts they get. Store-order alerts for the family stay on the admins'
 * Alerts page. Plain, like the rest of Settings.
 */
export default async function MyNotificationsPage({ searchParams }: { searchParams: Promise<{ reminders?: string }> }) {
  const profile = await requireActiveProfile();
  const remindersNote = (await searchParams).reminders;
  if (!isAdult(profile)) {
    return <p className="p-4 text-muted-foreground sm:p-6">Notifications are for grown-ups for now.</p>;
  }
  // Jar names only for someone using the app as themselves: the Money app's own rule
  // (lib/finance/access.ts moneyViewer), checked here with the same kernel helper.
  const asThemselves = profile.isHouseholdMember && (await isOwnSignIn(profile));
  const [devices, jars] = await Promise.all([
    prisma.pushSubscription.findMany({
      where: { personId: profile.id },
      select: { id: true, createdAt: true, lastSuccessAt: true },
      orderBy: { createdAt: "asc" },
    }),
    asThemselves
      ? prisma.moneyJar.findMany({
          where: { householdId: profile.householdId, members: { some: { personId: profile.id } } },
          select: { id: true, name: true, emoji: true },
          orderBy: { createdAt: "asc" },
        })
      : [],
  ]);
  const vapid = await getVapid();
  // Phase 62: reminders, only the kinds whose app is on.
  const [medsOn, schoolOn, carsOn, choresOn, reminderPrefs, channels] = await Promise.all([
    appOn(profile.householdId, "meds"),
    appOn(profile.householdId, "school"),
    appOn(profile.householdId, "cars"),
    appOn(profile.householdId, "chores"),
    readReminderPrefs(profile.id),
    reminderChannels(profile.householdId, profile.id),
  ]);
  const kinds = listedKinds((app) => ({ meds: medsOn, school: schoolOn, cars: carsOn, chores: choresOn })[app], isAdmin(profile));
  const off = new Set(reminderPrefs?.off ?? []);
  // Phase 68a: opt-in kinds are ticked only once switched on.
  const optIn = new Set(reminderPrefs?.optIn ?? []);
  // Phase 40.2c: an admin's notices about other people's sign-ins can be switched off.
  // Own sign-in only, as the switch's action checks (not the DEV-ONLY dev sign-in).
  const signInSwitch = isAdmin(profile) && (await isSessionOwner(profile)) ? await othersSignInNoticesOn(profile.id) : null;

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">My notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The bell always has everything. Turn on this phone to get the important ones even when the app isn&apos;t open.
        </p>
      </div>

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">This phone</h2>
        <ThisDevice key={devices.map((d) => d.id).join(",")} vapidPublicKey={vapid?.publicKey ?? null} />
      </section>

      <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">My phones</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d, i) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  Phone {i + 1} · added {formatRelative(d.createdAt).toLowerCase()}
                  {d.lastSuccessAt ? ` · last alert ${formatRelative(d.lastSuccessAt).toLowerCase()}` : ""}
                </span>
                <RemoveMyDevice deviceId={d.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="reminders" className="scroll-mt-6 space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">Reminders</h2>
        <p className="text-sm text-muted-foreground">
          The app reminds you about these in the bell and on your phones{channels.teams || channels.email ? ", and where you choose below" : ""}.
        </p>
        <form action={saveReminders} className="space-y-4">
          <fieldset className="space-y-1">
            <legend className="sr-only">Remind me when</legend>
            {kinds.map((k) => (
              <label key={k.kind} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                <input type="checkbox" name="kind" value={k.kind} defaultChecked={k.optIn ? optIn.has(k.kind) : !off.has(k.kind)} className="size-4" />
                {k.label}
              </label>
            ))}
          </fieldset>
          {(channels.teams || channels.email) && (
            <fieldset className="space-y-1">
              <legend className={`${fieldLabel} block`}>Also send them</legend>
              {channels.teams && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="checkbox" name="teams" defaultChecked={reminderPrefs?.teamsEnabled ?? false} className="size-4" />
                  In Teams
                </label>
              )}
              {channels.email && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="checkbox" name="email" defaultChecked={reminderPrefs?.emailEnabled ?? false} className="size-4" />
                  By email
                </label>
              )}
            </fieldset>
          )}
          {(channels.teams || channels.email) && (
            <fieldset className="space-y-1">
              <legend className={`${fieldLabel} block`}>Morning summary</legend>
              <p className="text-xs text-muted-foreground">
                At 7:00 am (or when your quiet hours end): today&apos;s chores and doses, school due, car work and birthdays this week.
              </p>
              {channels.teams && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="checkbox" name="digestTeams" defaultChecked={reminderPrefs?.digestTeams ?? false} className="size-4" />
                  In Teams
                </label>
              )}
              {channels.email && (
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                  <input type="checkbox" name="digestEmail" defaultChecked={reminderPrefs?.digestEmail ?? false} className="size-4" />
                  By email
                </label>
              )}
            </fieldset>
          )}
          <fieldset>
            <legend className={`${fieldLabel} block`}>Quiet hours</legend>
            <p className="text-xs text-muted-foreground">Nothing comes to your phones, Teams or email in these hours, except a missed dose. Leave both empty for none.</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                From <input type="time" name="quietFrom" defaultValue={clockText(reminderPrefs?.quietStart ?? null)} className={field} />
              </label>
              <label className="flex items-center gap-1">
                to <input type="time" name="quietTo" defaultValue={clockText(reminderPrefs?.quietEnd ?? null)} className={field} />
              </label>
            </div>
          </fieldset>
          {remindersNote === "quiet" && <p role="alert" className="text-sm font-bold text-destructive">Give quiet hours both a start and an end, or leave both empty.</p>}
          {remindersNote === "saved" && <p role="status" className="text-sm font-bold text-foreground">Saved.</p>}
          <SubmitButton className={btn} pendingText="Saving…">
            Save reminders
          </SubmitButton>
        </form>
      </section>

      {jars.length > 0 && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Money alerts</h2>
          <p className="text-sm text-muted-foreground">Each jar has its own switches: bills due, a broken bank feed, over budget, running low.</p>
          <ul>
            {jars.map((j) => (
              <li key={j.id}>
                <Link href={`/finances/${j.id}/settings`} className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline sm:min-h-0">
                  {j.emoji ?? "💰"} {j.name}: alerts for me
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {signInSwitch !== null && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Sign-in changes</h2>
          <p className="text-sm text-muted-foreground">
            Notices about your own sign-in always come. As an admin you also hear when another admin resets, removes or changes
            someone else&apos;s sign-in, and when someone uses your invite: {signInSwitch ? "on" : "off"}.
          </p>
          <form action={setSignInNotices.bind(null, !signInSwitch)}>
            <SubmitButton className={btn} pendingText="Saving…">
              {signInSwitch ? "Turn these off" : "Turn these on"}
            </SubmitButton>
          </form>
        </section>
      )}

      {isAdmin(profile) && (
        <p className="text-sm text-muted-foreground">
          <RewardWord form="store" /> alerts for the family (Teams, email) are on{" "}
          <Link href="/settings/alerts" className="underline">
            Alerts
          </Link>
          .
        </p>
      )}
    </div>
  );
}
