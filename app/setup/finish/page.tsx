import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { isSetUp, readFinishDetails } from "@/lib/setup";
import { PRODUCT_NAME } from "@/lib/app-name";
import { FinishForm } from "./finish-form";
import { SignOutButton } from "@/app/not-provisioned/sign-out-button";
import { getEntraRole } from "@/lib/active-profile";

export const metadata = { title: "Finish setting up" };

/**
 * Phase 40.1c, setup's second step: signed in (setup's own passkey, or the first Microsoft
 * sign-in), no household yet. Usually reached only if the first step's finish didn't run (a
 * closed tab) or for a Microsoft setup, which names the household here.
 */
export default async function FinishSetupPage() {
  const session = await getServerSession();
  if (!session) redirect("/setup");
  if (await isSetUp()) redirect("/profiles");
  if (await prisma.person.findFirst({ where: { authUserId: session.user.id }, select: { id: true } })) redirect("/profiles");

  const kept = await readFinishDetails(session.user.id);
  // A Microsoft sign-in sets up only with the Admin role in Entra (its role's source of truth).
  // Without it there's nothing to finish here, so say why and offer the way out.
  const microsoft = (await prisma.account.count({ where: { userId: session.user.id, providerId: "microsoft" } })) > 0;
  const blocked = microsoft && (await getEntraRole(session.user.id)) !== "ADMIN";
  return (
    <main className="flex flex-1 items-center justify-center bg-muted px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-card p-8 shadow-sm ring-1 ring-border">
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-foreground">Finish setting up {PRODUCT_NAME}</h1>
          <p className="text-sm text-muted-foreground">You&apos;re signed in. One last step and you&apos;re the admin.</p>
        </div>
        {blocked ? (
          <p className="text-sm text-foreground">
            Your Microsoft account needs the Admin role for this app in Entra to set it up. Ask whoever manages your
            Microsoft 365 to assign it, then sign in again; or sign out and set the app up with a passkey.
          </p>
        ) : (
          <FinishForm kept={kept !== null} householdName={kept?.householdName ?? ""} firstName={kept?.firstName ?? session.user.name.split(/\s+/)[0] ?? ""} />
        )}
        <div className="border-t border-border pt-4">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
