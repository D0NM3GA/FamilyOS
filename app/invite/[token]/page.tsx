import { getServerSession } from "@/lib/session";
import { halfFinishedProviderSignIn, INVITE_ERRORS, INVITE_GONE, readInvite } from "@/lib/invites";
import { oidcSignIn } from "@/lib/auth";
import { getAppName } from "@/lib/household-settings";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/app/profiles/sign-out-button";
import { btnPrimary } from "@/components/styles";
import { AcceptInvite } from "./accept-invite";

// Never indexed; it's rendered per request (it reads the session), so never cached either.
export const metadata = { title: "You're invited", robots: { index: false, follow: false } };

/**
 * Phase 40.2b: the link an admin hands a grown-up. Signed out, it shows who it's for and makes
 * their passkey on this device, which creates their sign-in (lib/invites.ts acceptInvite).
 * Signed in, it asks to sign out first: a signed-in browser can't take an invite. Phase 40.3:
 * or they use the install's OIDC provider instead (not on a reset's link); someone who came back
 * from the provider without finishing (signed in, nobody yet) finishes from here.
 */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const [invite, session, provider, { error: code }] = await Promise.all([readInvite(token), getServerSession(), oidcSignIn(), searchParams]);
  const appName = invite ? await getAppName(invite.householdId) : null;
  const halfFinished = invite && session ? await halfFinishedProviderSignIn(session.user.id) : false;
  // Our own codes, and Better Auth's provider errors (anything else) as one sentence.
  const error = code ? (Object.hasOwn(INVITE_ERRORS, code) ? INVITE_ERRORS[code as keyof typeof INVITE_ERRORS] : INVITE_ERRORS.provider) : null;

  return (
    <main className="relative flex flex-1 items-center justify-center bg-muted px-4 py-10">
      <div className="fixed right-4 top-4">
        <ThemeToggle className="ring-1 ring-border text-muted-foreground hover:bg-card hover:text-foreground" />
      </div>
      <div className="w-full max-w-md space-y-6 rounded-lg bg-card p-8 shadow-sm ring-1 ring-border">
        {!invite ? (
          <p className="text-sm text-foreground">{INVITE_GONE}</p>
        ) : halfFinished ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">You&apos;re signed in with {provider?.name ?? "your provider"}. Finish joining as {invite.firstName}.</p>
            <a href={`/invite/${encodeURIComponent(token)}/finish`} className={`${btnPrimary} w-full justify-center`}>
              Finish
            </a>
          </div>
        ) : session ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              This invite is for {invite.firstName}. This browser is already signed in: sign out first, and this page comes
              back.
            </p>
            <SignOutButton to={`/invite/${token}`} className={`${btnPrimary} w-full justify-center`}>
              Sign out
            </SignOutButton>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-extrabold text-foreground">Hi {invite.firstName}!</h1>
              {invite.recovery ? (
                <p className="text-sm text-muted-foreground">
                  {invite.from ? `${invite.from} made you a new sign-in link for ${appName}.` : `Here's a new sign-in link for ${appName}.`}{" "}
                  Make a passkey on this device to get back in. If your device lists an old passkey for the app, use the newest.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {invite.from ? `${invite.from} invited you to ${appName}.` : `You're invited to ${appName}.`} Make a passkey on
                    this device: it signs you in with the device&apos;s PIN, fingerprint or face, with no password to remember.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    From now on, your tile on the family&apos;s shared screens opens only when you sign in yourself, not with a PIN.
                  </p>
                </>
              )}
            </div>
            <AcceptInvite token={token} provider={invite.recovery ? null : (provider?.name ?? null)} initialError={error} />
          </>
        )}
      </div>
    </main>
  );
}
