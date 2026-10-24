import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { fullName } from "@/lib/people";
import { getHouseholdSettings, listTimeZones } from "@/lib/household-settings";
import { removeHouseholdMember, setMemberPin, updateHouseholdSettings } from "./actions";
import { PinForm } from "./pin-form";
import { HouseholdSettingsForm } from "./household-settings-form";
import { HomeLocation } from "@/components/home-location";
import { nearestZip } from "@/lib/zip";
import { ConfirmSubmit } from "@/components/submit";
import { btnDanger } from "@/components/styles";
import { canRemoveFromHousehold } from "@/lib/household-members";
import type { PersonRole } from "@/app/generated/prisma/enums";
import { microsoftLinkedUserIds, signInKindOf, type SignInKind } from "@/lib/sign-in-kind";

export const metadata = { title: "Household and people" };

const SIGN_IN_LABEL: Record<SignInKind, string> = { microsoft: "Microsoft", own: "Own sign-in", pin: "PIN only" };

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  ADULT: "Adult",
  KID: "Kid",
};

const isRemovable = (p: { authUserId: string | null; role: PersonRole | null; _count: { moneyJars: number } }) =>
  canRemoveFromHousehold({ authUserId: p.authUserId, role: p.role, jarCount: p._count.moneyJars });

export default async function HouseholdSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) redirect("/settings");

  const { error } = await searchParams;

  const household = await getHouseholdSettings(profile.householdId);
  const timeZones = listTimeZones(household.timezone);
  const { statementDateOrder: dateOrder } = await prisma.household.findUniqueOrThrow({ where: { id: profile.householdId }, select: { statementDateOrder: true } });
  // Phase 45.1: a saved home is shown as the ZIP code it's near, never as coordinates.
  const home = household.latitude != null && household.longitude != null ? nearestZip(household.latitude, household.longitude).zip : null;

  const members = await prisma.person.findMany({
    where: { householdId: profile.householdId, isHouseholdMember: true },
    omit: { photo: true },
    include: { _count: { select: { moneyJars: true } } },
    orderBy: { firstName: "asc" },
  });
  const microsoftUsers = await microsoftLinkedUserIds(members.map((p) => p.authUserId));
  // Whether each member has a PIN, as a boolean only — the hash never leaves the server.
  const withPin = new Set(
    (
      await prisma.person.findMany({
        where: { householdId: profile.householdId, isHouseholdMember: true, pinHash: { not: null } },
        select: { id: true },
      })
    ).map((p) => p.id),
  );

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-semibold text-foreground">Household</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin-only. Household name and timezone, plus who&apos;s in the household and
            removing someone who&apos;s left. People who sign in on their own (or will, after a
            restore) have no Remove here; Microsoft sign-ins are added and removed in Entra. To
            let a grown-up sign in on their own with a passkey, invite them from{" "}
            <Link href="/settings/sign-in" className="underline hover:text-foreground">
              Sign-in
            </Link>
            . The app&apos;s name and look are in Make it yours.
          </p>
        </div>
        <Link
          href="/people/new"
          className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95 sm:min-h-9"
        >
          + Add member
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
          {error}
        </p>
      )}

      <div className="mt-6">
        <HouseholdSettingsForm
          action={updateHouseholdSettings}
          defaults={{
            name: household.name,
            timezone: household.timezone,
            statementDateOrder: dateOrder,
          }}
          timeZones={timeZones}
        />
      </div>

      <section aria-labelledby="home-heading" className="mt-6 max-w-lg space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <div>
          <h2 id="home-heading" className="text-sm font-medium text-foreground">Where&apos;s home?</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            So chores marked &ldquo;outdoor&rdquo; can warn when rain is on the way. The app keeps it to
            about a kilometre, never your street address; only the US National Weather Service sees
            it, to send the forecast.
          </p>
        </div>
        <HomeLocation nearZip={home} />
      </section>

      <div className="mt-6 overflow-x-auto rounded-lg bg-card shadow-sm ring-1 ring-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Signs in with</th>
              <th className="px-4 py-3 font-medium">Profile PIN</th>
              <th className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((person) => {
              const isSelf = person.id === profile.id;
              const kind = signInKindOf(person.authUserId, microsoftUsers);
              return (
                <tr key={person.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {fullName(person)} {isSelf && <span className="text-muted-foreground">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{person.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {person.role ? ROLE_LABEL[person.role] : "—"}
                    {kind === "microsoft" && <span className="ml-1 text-xs text-muted-foreground">(via Entra)</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {SIGN_IN_LABEL[kind]}
                  </td>
                  <td className="px-4 py-3">
                    {person.authUserId ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : person.role === "ADMIN" ? (
                      // Phase 42: a PIN never opens an admin. A restored admin reconnects by invite.
                      <Link href="/settings/sign-in" className="text-xs font-medium text-brand-text underline">
                        Send an invite
                      </Link>
                    ) : (
                      <PinForm action={setMemberPin.bind(null, person.id)} hasPin={withPin.has(person.id)} kid={person.role === "KID"} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && isRemovable(person) && (
                      <form action={removeHouseholdMember.bind(null, person.id)} className="flex justify-end">
                        <ConfirmSubmit
                          question={`Remove ${person.firstName} from the household? They leave the profile picker. You can add them back from their People page.`}
                          yes="Remove"
                          aria-label={`Remove ${person.firstName}`}
                          className="inline-flex min-h-11 items-center text-xs font-medium text-destructive hover:text-red-800 dark:hover:text-red-400 sm:min-h-0"
                          yesClassName={btnDanger}
                        >
                          Remove
                        </ConfirmSubmit>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-muted-foreground">
        Role comes from Entra (Admin/Adult app-role assignment) for anyone signed in via
        Microsoft, and re-syncs automatically on every request — it isn&apos;t editable here or
        in the People form. Someone with their own sign-in doesn&apos;t need a profile PIN. Removing someone here takes their tile off the profile picker.
        To add them back, tick &ldquo;Lives in our household&rdquo; on their People page and
        pick their role again.
      </p>
    </div>
  );
}
