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
import { setSignInNotices } from "./actions";

export const metadata = { title: "My notifications" };

/**
 * Every grown-up's own alert settings in one place: this phone, their other phones, and
 * which jars' money alerts they get. Store-order alerts for the family stay on the admins'
 * Alerts page. Plain, like the rest of Settings.
 */
export default async function MyNotificationsPage() {
  const profile = await requireActiveProfile();
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
