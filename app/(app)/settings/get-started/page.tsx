import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { backupSignInState, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getDisabledApps } from "@/lib/app-switches";
import { isAppOn } from "@/lib/apps";
import { getVapid } from "@/lib/alerts/vapid";
import { getHouseholdSettings } from "@/lib/household-settings";
import { INVITE_HOURS, invitableMembers } from "@/lib/invites";
import { microsoftEnabled } from "@/lib/auth";
import { signedInWithin } from "@/lib/session";
import { NEW_WAY_IN_SECONDS } from "@/lib/fresh-sign-in";
import { nearestZip } from "@/lib/zip";
import { SETUP_PATH } from "@/lib/setup-checklist";
import { FocusHeading } from "@/components/focus-heading";
import { HomeLocation } from "@/components/home-location";
import { SignInAgain } from "@/components/sign-in-again";
import { SubmitButton } from "@/components/submit";
import { btn, btnPrimary } from "@/components/styles";
import { LookForm } from "../make-it-yours/look-form";
import { lookFormDefaults } from "../make-it-yours/defaults";
import { AppSwitchList } from "../apps/app-switch-list";
import { ThisDevice } from "../alerts/this-device";
import { AddPasskey } from "../passkeys/add-passkey";
import { InviteForm } from "../sign-in/invite-form";
import { MyPin } from "../my-pin";
import { loadSetupChecklist } from "../setup-facts";
import { continueSetup } from "./actions";
import { AddMember } from "./add-member";
import { nextStep, previousStep, STEPS, stepOf, type StepId } from "./steps";

export const metadata = { title: "Get started" };

/**
 * Phase 45.4: the guided setup. New installs land here right after first-run setup; later it's
 * reached from the "Finish setting up" card. Admins only. Every step can be skipped and saves
 * as it goes, through the same actions its Settings page uses, so leaving halfway loses
 * nothing. What's left waits on the checklist.
 */
export default async function GetStartedPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) redirect("/settings");
  const step = stepOf((await searchParams).step);
  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-6 p-4 sm:p-6">
      <nav aria-label="Setup steps" className="w-full max-w-full flex-[1_1_15rem] rounded-2xl border-2 border-border bg-card p-3 sm:w-auto">
        <ol className="space-y-1">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`${SETUP_PATH}?step=${s.id}`}
                aria-current={s.id === step ? "step" : undefined}
                className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm font-semibold text-foreground hover:bg-muted aria-[current=step]:bg-sun/40 aria-[current=step]:font-extrabold"
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-extrabold ${
                    i < index ? "border-transparent bg-sun text-ink" : s.id === step ? "border-ink bg-ink text-white dark:border-sun dark:bg-sun dark:text-ink" : "border-border"
                  }`}
                >
                  {i < index ? <Check className="size-4" aria-hidden="true" /> : i === 0 ? "·" : i === STEPS.length - 1 ? "★" : i}
                </span>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {/* A div, not <main>: the (app) layout has the page's one main (and its graph paper). */}
      <div className="min-w-0 flex-[999_1_34rem] space-y-6 rounded-3xl border-2 border-border bg-card p-5 sm:p-7">
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={STEPS.length - 1} aria-valuenow={index} className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-ink dark:bg-sun" style={{ width: `${Math.round((index / (STEPS.length - 1)) * 100)}%` }} />
        </div>
        <Step step={step} profile={profile} />
        {step !== "done" && <Footer step={step} />}
      </div>
    </div>
  );
}

function Heading({ n, title, intro }: { n?: number; title: string; intro?: string }) {
  return (
    <div>
      {n && <p className="text-sm font-extrabold text-muted-foreground">Step {n} of 5</p>}
      {/* Keyed on the title, so each new step's heading takes focus. */}
      <FocusHeading key={title} className="font-heading text-3xl font-extrabold leading-tight text-foreground sm:text-4xl">
        {title}
      </FocusHeading>
      {intro && <p className="mt-2 max-w-2xl text-base text-muted-foreground">{intro}</p>}
    </div>
  );
}

function Footer({ step }: { step: StepId }) {
  return (
    <form action={continueSetup.bind(null, step)} className="flex flex-wrap items-center gap-3 border-t-2 border-border pt-5">
      {step !== "welcome" && (
        <Link href={`${SETUP_PATH}?step=${previousStep(step)}`} className={btn}>
          Back
        </Link>
      )}
      <span className="flex-1" />
      {step !== "welcome" && (
        <Link href={`${SETUP_PATH}?step=${nextStep(step)}`} className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-brand-text underline sm:min-h-9">
          Skip for now
        </Link>
      )}
      <SubmitButton className={btnPrimary}>{step === "welcome" ? "Let's go" : step === "phone" ? "Finish" : "Continue"}</SubmitButton>
    </form>
  );
}

type Profile = Awaited<ReturnType<typeof requireActiveProfile>>;

async function Step({ step, profile }: { step: StepId; profile: Profile }) {
  switch (step) {
    case "welcome": {
      // Right after setup with a passkey, say so; anyone else (Microsoft, or back later) gets a plain hello.
      const [signIn, people] = await Promise.all([
        profile.authUserId ? backupSignInState(profile) : null,
        prisma.person.count({ where: { householdId: profile.householdId, isHouseholdMember: true } }),
      ]);
      return (
        <div className="space-y-5">
          <p className="font-hand text-3xl text-brand-text">{people > 1 ? "Welcome back." : signIn?.passkey ? "Your passkey is made. Nice." : "You're signed in. Nice."}</p>
          <Heading
            title={`Let's get your family settled in, ${profile.firstName}.`}
            intro="Five short steps, about five minutes. Each one makes the app more useful from day one. Skip any you like: the app works without them, and Settings keeps a list of what's left."
          />
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
            {[
              ["Household basics", "So outdoor chores can warn about rain"],
              ["Make it yours", "Your family's name and colors on every screen"],
              ["Who's in your family", "So everyone gets their own chores, meds and calendar"],
              ["Pick your apps", "Short menus, with only what you use"],
              ["Phone and safety", "Reminders that reach you, and no lockouts"],
            ].map(([title, why]) => (
              <li key={title} className="rounded-2xl bg-muted p-4">
                <p className="font-extrabold text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground">{why}</p>
              </li>
            ))}
          </ol>
        </div>
      );
    }

    case "home": {
      const household = await getHouseholdSettings(profile.householdId);
      const near = household.latitude != null && household.longitude != null ? nearestZip(household.latitude, household.longitude).zip : null;
      return (
        <div className="space-y-5">
          <Heading n={1} title="Household basics" intro={`${household.name}: the name you gave at setup. You can change it any time in Settings → Household.`} />
          <section className="space-y-2">
            <h2 className="text-lg font-extrabold text-foreground">Where&apos;s home?</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              So chores marked &ldquo;outdoor&rdquo; can warn the kids when rain is on the way. The app keeps it to about a kilometre, never
              your street address; only the US National Weather Service sees it, to send the forecast.
            </p>
            <HomeLocation nearZip={near} />
          </section>
          <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            Timezone: <span className="font-bold text-foreground">{household.timezone ? household.timezone.replace(/_/g, " ") : "not set"}</span>, taken from
            the device you set up on. <Link href="/settings/household" className="underline hover:text-foreground">Change it</Link>
          </p>
        </div>
      );
    }

    case "look":
      return (
        <div className="space-y-5">
          <Heading n={2} title="Make it yours" intro="Your family's name, its color and what the kids earn, on every screen and every device. Save, then Continue." />
          <LookForm defaults={await lookFormDefaults(profile.householdId)} />
        </div>
      );

    case "people": {
      const people = await prisma.person.findMany({
        where: { householdId: profile.householdId, isHouseholdMember: true },
        select: { id: true, firstName: true, role: true, authUserId: true },
        orderBy: { createdAt: "asc" },
      });
      const roleOf = (p: (typeof people)[number]) =>
        p.id === profile.id ? "You · Admin" : p.role === "KID" ? "Kid" : p.authUserId ? "Grown-up · signs in" : "Grown-up · invite at the end";
      return (
        <div className="space-y-5">
          <Heading n={3} title="Who's in your family?" intro="Add everyone who should have their own chores, meds or calendar. You can add more any time from Settings." />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
            {people.map((p) => (
              <li key={p.id} className="flex flex-col items-center gap-1 rounded-2xl border-2 border-border p-3 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-sun/50 font-heading text-xl font-extrabold text-ink">{p.firstName[0]?.toUpperCase()}</span>
                <span className="font-extrabold text-foreground">{p.firstName}</span>
                <span className="text-xs text-muted-foreground">{roleOf(p)}</span>
              </li>
            ))}
          </ul>
          <AddMember />
        </div>
      );
    }

    case "apps": {
      const [disabled, outlookConnected] = await Promise.all([
        getDisabledApps(profile.householdId),
        prisma.calendarSync.count({ where: { householdId: profile.householdId } }).then((n) => n > 0),
      ]);
      return (
        <div className="space-y-5">
          <Heading n={4} title="Pick your apps" intro="Turn off any you won't use, so menus stay short. Nothing is deleted, and you can turn one back on any time. Each switch saves as you flip it." />
          <AppSwitchList disabled={disabled} outlook={outlookConnected && isAppOn(disabled, "calendar")} />
          <p className="text-sm text-muted-foreground">Home, People, Data and Settings are always here.</p>
        </div>
      );
    }

    case "phone": {
      const [vapid, signIn, hasPin] = await Promise.all([
        getVapid(),
        profile.authUserId ? backupSignInState(profile) : null,
        prisma.person.count({ where: { id: profile.id, pinHash: { not: null } } }).then((n) => n > 0),
      ]);
      return (
        <div className="space-y-5">
          <Heading n={5} title="Phone and safety" intro="Three quick extras for this device. Do any, all or none." />
          <section className="space-y-2 rounded-2xl border-2 border-border p-4">
            <h2 className="text-lg font-extrabold text-foreground">Get alerts on this phone</h2>
            <p className="text-sm text-muted-foreground">Hear about store orders, bills due and budgets running low without opening the app.</p>
            <ThisDevice vapidPublicKey={vapid?.publicKey ?? null} />
          </section>
          {signIn?.own && (
            <section className="space-y-2 rounded-2xl border-2 border-border p-4">
              <h2 className="text-lg font-extrabold text-foreground">Lock your tile with a PIN</h2>
              <p className="text-sm text-muted-foreground">On a shared tablet, this keeps the kids out of your profile, and out of the money.</p>
              {signIn.fresh ? (
                <MyPin hasPin={hasPin} />
              ) : (
                <Link href="/settings/lock-my-tile" className={btn}>
                  {hasPin ? "Change the PIN" : "Set a PIN"}
                </Link>
              )}
            </section>
          )}
          {signIn?.own && signIn.passkey && (
            <section className="space-y-2 rounded-2xl border-2 border-border p-4">
              <h2 className="text-lg font-extrabold text-foreground">Add a spare passkey</h2>
              <p className="text-sm text-muted-foreground">Make one on a second device, so a lost phone doesn&apos;t lock you out.</p>
              <AddPasskey />
            </section>
          )}
        </div>
      );
    }

    case "done": {
      const [left, members, fresh, signIn] = await Promise.all([
        loadSetupChecklist(profile).then((items) => items.filter((i) => !i.done)),
        invitableMembers(profile.householdId),
        signedInWithin(NEW_WAY_IN_SECONDS),
        profile.authUserId ? backupSignInState(profile) : null,
      ]);
      return (
        <div className="space-y-6">
          <p className="font-hand text-3xl text-brand-text">All set!</p>
          <Heading title="Welcome home." />
          {members.length > 0 && (
            <section className="space-y-3 rounded-2xl bg-sun/25 p-4">
              <h2 className="text-lg font-extrabold text-foreground">Send the invite links</h2>
              <p className="text-sm text-foreground">
                Grown-ups sign in with a one-time link that makes their own passkey. Send it by text or in person: it works for {INVITE_HOURS} hours.
              </p>
              {fresh ? (
                <InviteForm members={members.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email }))} microsoft={microsoftEnabled()} hours={INVITE_HOURS} />
              ) : signIn ? (
                <>
                  <p className="text-sm text-foreground">Making an invite needs a sign-in from the last few minutes. Sign in again first:</p>
                  <SignInAgain callbackURL={`${SETUP_PATH}?step=done`} loginHint={signIn.email} dev={signIn.dev} microsoft={signIn.microsoft} passkey={signIn.passkey} oidc={signIn.oidc} />
                </>
              ) : null}
            </section>
          )}
          {left.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-extrabold text-foreground">Left for later</h2>
              <ul className="flex flex-wrap gap-2">
                {left.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="inline-flex min-h-11 items-center rounded-full bg-amber-100 px-3 text-sm font-bold text-amber-900 hover:underline dark:bg-amber-500/15 dark:text-amber-200 sm:min-h-9">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">No rush. They wait at the top of Settings under &ldquo;Finish setting up&rdquo;.</p>
            </section>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/" className={btnPrimary}>
              Go to Home
            </Link>
            <Link href="/settings" className={btn}>
              Open Settings
            </Link>
          </div>
        </div>
      );
    }
  }
}
