import Link from "next/link";
import { redirect } from "next/navigation";
import { backupSignInState, requireActiveProfile } from "@/lib/active-profile";
import { prisma } from "@/lib/prisma";
import { isAdult } from "@/lib/authz";
import { SignInAgain } from "@/components/sign-in-again";
import { backLink } from "@/components/styles";
import { MyPin } from "../my-pin";

export const metadata = { title: "Lock my tile" };

/**
 * Phase 45.3: locking your own picker tile (app/profiles/own-tile.ts), moved off the Settings
 * page onto its own, as the hub's Lock my tile tile. Grown-ups on their own sign-in only;
 * changing the PIN needs a fresh sign-in, as before.
 */
export default async function LockMyTilePage() {
  const profile = await requireActiveProfile();
  if (!isAdult(profile) || !profile.authUserId) redirect("/settings");
  const signIn = await backupSignInState(profile);
  if (!signIn.own) redirect("/settings");
  const hasPin = (await prisma.person.count({ where: { id: profile.id, pinHash: { not: null } } })) > 0;

  return (
    <div className="max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <Link href="/settings" className={backLink}>
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Lock my tile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only changes things for you. On a shared tablet anyone can tap your tile on the profile picker; a PIN keeps the
          kids out of your profile, and out of the money. Forgot it? Sign out and back in: your tile opens without it once,
          right after.
        </p>
      </div>
      <div className="rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        {signIn.fresh ? (
          <MyPin hasPin={hasPin} />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              {hasPin ? "Your tile is locked. " : "Your tile isn't locked yet: anyone can open it. "}
              To {hasPin ? "change the PIN" : "add one"}, sign in again first.
            </p>
            <SignInAgain callbackURL="/settings/lock-my-tile" loginHint={signIn.email} dev={signIn.dev} microsoft={signIn.microsoft} passkey={signIn.passkey} oidc={signIn.oidc} />
          </div>
        )}
      </div>
    </div>
  );
}
