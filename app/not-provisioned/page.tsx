import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export const metadata = { title: "No app access" };

/**
 * Landing spot for a sign-in this app won't provision or continue as (Phase 40.1b: any kind)
 * (see lib/active-profile.ts's getAuthPerson) — either no Adult/Admin role assigned in
 * Entra yet (most likely a kid's own M365 account, or an adult signed in before the
 * household admin finished Entra app-role assignment), or a previously-linked person an
 * admin has since removed from the household. Deliberately not behind
 * requireActiveProfile()/getAuthPerson() itself — this page IS the exit hatch for both of
 * those redirects, so it must not call back into either.
 */
export default async function NotProvisionedPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <main className="flex flex-1 items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-card p-8 text-center shadow-sm ring-1 ring-border">
        <h1 className="text-xl font-semibold text-foreground">No app access</h1>
        <p className="text-sm text-muted-foreground">
          This sign-in ({session.user.email ?? session.user.name}) doesn&apos;t currently have
          access to this app. For a Microsoft account, no Adult/Admin role is assigned to it in
          Entra (yet, or any more); otherwise the household admin hasn&apos;t added it, or has removed it. If you were
          invited, open your invite link again to finish. Otherwise ask the household admin to
          check, then sign in again.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
