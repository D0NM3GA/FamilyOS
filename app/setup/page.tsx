import { redirect } from "next/navigation";
import { microsoftEnabled, oidcSignIn } from "@/lib/auth";
import { getServerSession } from "@/lib/session";
import { isSetUp } from "@/lib/setup";
import { PRODUCT_NAME } from "@/lib/app-name";
import { ThemeToggle } from "@/components/theme-toggle";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };

/**
 * Phase 40.1c: a brand-new install's first page. Only while there's no household; whoever opens
 * it first sets the app up and becomes its admin (the owner's call; docs/BUILD.md Phase 40).
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isSetUp()) redirect("/sign-in");
  // Phase 40.3: a provider setup that didn't work comes back here with Better Auth's ?error=.
  const failed = Boolean((await searchParams).error);
  if (await getServerSession()) redirect("/setup/finish");

  return (
    <main className="relative flex flex-1 items-center justify-center bg-muted px-4 py-10">
      <div className="fixed right-4 top-4">
        <ThemeToggle className="ring-1 ring-border text-muted-foreground hover:bg-card hover:text-foreground" />
      </div>
      <div className="w-full max-w-md space-y-6 rounded-lg bg-card p-8 shadow-sm ring-1 ring-border">
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-foreground">Set up {PRODUCT_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;re the first one here, so you&apos;ll be the admin. Finish this now: until it&apos;s done, anyone who
            opens this address can set it up instead.
          </p>
        </div>
        {failed && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            That sign-in didn&apos;t work. Try again, or set up with a passkey.
          </p>
        )}
        <SetupForm microsoft={microsoftEnabled()} provider={(await oidcSignIn())?.name ?? null} />
      </div>
    </main>
  );
}
