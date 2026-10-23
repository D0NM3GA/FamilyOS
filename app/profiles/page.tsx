import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthPerson } from "@/lib/active-profile";
import { syncActivePersonFromEntra } from "@/lib/entra-sync";
import { devSelectProfile, selectOwnProfile } from "./actions";
import { getServerSession } from "@/lib/session";
import { isDevUser } from "@/lib/dev-auth";
import { ProfileGrid } from "./profile-grid";
import { personColor } from "@/lib/person-color";
import { SignOutButton } from "./sign-out-button";
import { ownTileLocked } from "./own-tile";
import { getAppName } from "@/lib/household-settings";
import { microsoftLinkedUserIds, signInKindOf } from "@/lib/sign-in-kind";
import { SubmitButton } from "@/components/submit";

export const metadata = { title: "Pick your profile" };

export default async function ProfilesPage() {
  let authPerson = await getAuthPerson();
  if (!authPerson) redirect("/sign-in");

  // Phase 40.1b: only a Microsoft sign-in has a Microsoft profile to fill in from.
  if (!authPerson.entraSyncedAt && (await microsoftLinkedUserIds([authPerson.authUserId])).size > 0) {
    // Best-effort — a Graph hiccup should never block the profile picker from rendering.
    await syncActivePersonFromEntra("fill").catch(() => {});
    authPerson = await getAuthPerson();
    if (!authPerson) redirect("/sign-in");
  }

  const devSession = isDevUser((await getServerSession())?.user);
  const selfLocked = await ownTileLocked(authPerson.id);

  const [household, withPin, appName] = await Promise.all([
    prisma.person.findMany({
      where: { householdId: authPerson.householdId, isHouseholdMember: true },
      omit: { photo: true },
      orderBy: { firstName: "asc" },
    }),
    // Only who has one, never the hash.
    prisma.person.findMany({
      where: { householdId: authPerson.householdId, isHouseholdMember: true, pinHash: { not: null } },
      select: { id: true },
    }),
    getAppName(authPerson.householdId),
  ]);
  const hasPin = new Set(withPin.map((p) => p.id));
  const microsoftUsers = await microsoftLinkedUserIds(household.map((p) => p.authUserId));

  const others = household
    .filter((p) => p.id !== authPerson.id)
    .map((p) => ({
      id: p.id,
      label: p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName,
      role: p.role,
      hasPhoto: p.photoContentType !== null,
      color: personColor(p),
      // Someone with their own sign-in (Microsoft or a passkey) only opens for that sign-in,
      // never a PIN (lib/active-profile.ts), so their tile explains instead of asking for one.
      opensWith: (() => {
        const kind = signInKindOf(p.authUserId, microsoftUsers);
        if (kind !== "pin") return kind;
        return hasPin.has(p.id) ? ("pin" as const) : ("nothing" as const);
      })(),
    }));

  // Only profiles a PIN could open: someone with their own sign-in only ever opens for it
  // (lib/active-profile.ts).
  const unlinked = new Set(household.filter((p) => p.authUserId === null).map((p) => p.id));
  const devTargets = others.filter((p) => unlinked.has(p.id));

  return (
    <main className="graph-paper flex flex-1 flex-col items-center justify-center gap-10 bg-muted px-4 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold text-foreground">Who&apos;s using {appName}?</h1>
        <p className="mt-1 font-hand text-2xl text-brand-text">Tap your sticker!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {authPerson.firstName} ·{" "}
          <SignOutButton className="inline-flex min-h-11 items-center font-bold underline hover:text-foreground sm:min-h-0">
            Not {authPerson.firstName}? Sign out
          </SignOutButton>
        </p>
      </div>

      <ProfileGrid
        self={{
          id: authPerson.id,
          label: authPerson.firstName,
          hasPhoto: authPerson.photoContentType !== null,
          color: personColor(authPerson),
          action: selectOwnProfile.bind(null, authPerson.id),
          locked: selfLocked,
        }}
        people={others}
      />

      {!hasPin.has(authPerson.id) && others.some((p) => p.role === "KID") && (
        <p className="max-w-md text-center text-sm text-muted-foreground">
          🔒 Kids can open your tile too. Lock it with a PIN in Settings → Lock my tile.
        </p>
      )}

      {/* DEV-ONLY (lib/dev-auth.ts): remove before shipping. */}
      {devSession && devTargets.length > 0 && (
        <div className="w-full max-w-md rounded-2xl border-2 border-dashed border-tomato p-4 text-center">
          <p className="text-sm font-extrabold text-tomato">Dev sign-in · open a profile without its PIN</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {devTargets.map((p) => (
              <form key={p.id} action={devSelectProfile.bind(null, p.id)}>
                <SubmitButton className="rounded-full px-3 py-1 text-sm font-bold ring-1 ring-input hover:bg-card">
                  {p.label} ({p.role?.toLowerCase() ?? "member"})
                </SubmitButton>
              </form>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
