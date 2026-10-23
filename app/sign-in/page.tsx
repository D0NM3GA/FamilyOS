import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInButton } from "./sign-in-button";
import { DevSignInButton } from "./dev-sign-in-button";
import { devAuthEnabled } from "@/lib/dev-auth";
import { getAppName } from "@/lib/household-settings";
import { Wordmark } from "@/components/family-look";
import { microsoftEnabled, oidcSignIn } from "@/lib/auth";
import { isSetUp } from "@/lib/setup";
import { PasskeySignInButton } from "./passkey-button";
import { ProviderSignInButton } from "./provider-button";

export const metadata = { title: "Sign in" };

/**
 * Phase 40.1: Better Auth sends failed sign-ins here with `?error=<code>` (onAPIError in
 * lib/auth.ts). Fixed words per code; the query value itself is never shown.
 */
function signInError(code: string | undefined): string | null {
  if (!code) return null;
  // Phase 40.3: one sentence for "not linked" and "not invited", so a provider account can't be
  // used to learn whether an email is known here.
  if (code === "account_not_linked" || code === "signup_disabled") {
    return "That account isn't set up here. Ask an admin for an invite.";
  }
  return "Sign-in didn't work. Please try again.";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getServerSession();
  const error = signInError((await searchParams).error);
  // A failed step that started while signed in (signing in again for a backup, say) still
  // says what went wrong, with the way back, instead of quietly landing on the profiles.
  if (session && !error) redirect("/profiles");
  // Phase 40.1c: a brand-new install has nobody to sign in yet.
  if (!(await isSetUp())) redirect("/setup");
  const [appName, provider] = await Promise.all([getAppName(), oidcSignIn()]);

  return (
    <main className="relative flex flex-1 items-center justify-center bg-muted px-4">
      {/* No top bar exists pre-sign-in (that's app/(app)/top-bar.tsx, behind auth) — this is
          the one manual override control reachable before signing in at all, e.g. to
          confirm the theme independently of the OS default. Wrapped, not `fixed` passed
          straight into ThemeToggle's own className: that string sits after the component's
          base `relative`, but Tailwind resolves conflicting position utilities by
          stylesheet order, not by which came last in the string, so `fixed` silently lost
          and the button rendered in normal flow instead of pinned to the corner. */}
      <div className="fixed right-4 top-4">
        <ThemeToggle className="ring-1 ring-border text-muted-foreground hover:bg-card hover:text-foreground" />
      </div>
      <div className="w-full max-w-sm space-y-6 rounded-lg bg-card p-8 shadow-sm ring-1 ring-border">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            <Wordmark name={appName} accentClassName="text-brand-text" />
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
            {error}
          </p>
        )}
        {session ? (
          <a href="/profiles" className="block text-center text-sm font-medium text-brand-text underline">
            Back to the app
          </a>
        ) : (
          <div className="space-y-3">
            <PasskeySignInButton />
            {microsoftEnabled() && <SignInButton />}
            {provider && <ProviderSignInButton name={provider.name} callbackURL="/profiles" errorURL="/sign-in" />}
          </div>
        )}
        {/* DEV-ONLY (lib/dev-auth.ts): remove before shipping. */}
        {!session && devAuthEnabled() && <DevSignInButton />}
      </div>
    </main>
  );
}
