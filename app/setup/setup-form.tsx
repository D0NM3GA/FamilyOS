"use client";

import { useActionState, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import { completeSetup, startSetup, type SetupState } from "./actions";
import { ProviderSignInButton } from "@/app/sign-in/provider-button";

/**
 * The setup form (Phase 40.1c): the household's name, yours and your email; then a tap to make
 * a passkey on this device (browsers, Safari above all, only start one from a tap, not after a
 * trip to the server); then the app finishes setting itself up and opens your profile. Or, when
 * the install has Microsoft, sign in with it instead.
 */
export function SetupForm({ microsoft, provider }: { microsoft: boolean; provider: string | null }) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(startSetup, {});
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [finishing, startFinishing] = useTransition();
  const [microsoftPending, setMicrosoftPending] = useState(false);
  // The passkey exists once this is true, so a retry goes on to finishing, not another passkey.
  const [passkeyMade, setPasskeyMade] = useState(false);

  function makePasskey(token: string) {
    startFinishing(async () => {
      setPasskeyError(null);
      const res = await authClient.passkey.addPasskey({ context: token, createSession: true }).catch(() => null);
      if (!res || res.error) {
        setPasskeyError(res?.error?.message ?? "The passkey wasn't made. Try again.");
        return;
      }
      setPasskeyMade(true);
      // Phase 45.2: the household starts on this device's time zone.
      const details = new FormData();
      details.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      const done = await completeSetup({}, details);
      if (done?.error) setPasskeyError(done.error);
    });
  }

  if (state.token) {
    const token = state.token;
    return (
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          Now make your passkey. Your device will ask for its PIN, fingerprint or face; that&apos;s how you&apos;ll sign in
          from now on, with no password to remember.
        </p>
        {passkeyError && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {passkeyError}
          </p>
        )}
        {passkeyMade && !finishing ? (
          <a href="/setup/finish" className={`${btnPrimary} w-full justify-center`}>
            Continue
          </a>
        ) : (
          <button type="button" disabled={finishing} aria-busy={finishing || undefined} onClick={() => makePasskey(token)} className={`${btnPrimary} w-full justify-center`}>
            {finishing ? "Setting up…" : "Make the passkey"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className={`${fieldLabel} block`}>Your household&apos;s name</span>
          <input name="householdName" required maxLength={60} placeholder="The Parkers" className={`${field} mt-1 w-full`} />
        </label>
        <label className="block">
          <span className={`${fieldLabel} block`}>Your first name</span>
          <input name="firstName" required maxLength={40} autoComplete="given-name" className={`${field} mt-1 w-full`} />
        </label>
        <label className="block">
          <span className={`${fieldLabel} block`}>Your email</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={`${field} mt-1 w-full`} />
          <span className="mt-1 block text-xs text-muted-foreground">
            It names your passkey and links another sign-in to you later. The app doesn&apos;t send it anywhere.
          </span>
        </label>
        {state.error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${btnPrimary} w-full justify-center`}>
          {pending ? "One moment…" : "Next"}
        </button>
      </form>

      {microsoft && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">Or, if your family uses Microsoft 365:</p>
          <button
            type="button"
            disabled={pending || microsoftPending}
            className={`${btn} w-full justify-center`}
            onClick={async () => {
              setMicrosoftPending(true);
              const res = await authClient.signIn.social({ provider: "microsoft", callbackURL: "/setup/finish" }).catch(() => null);
              if (!res || res.error) setMicrosoftPending(false);
            }}
          >
            {microsoftPending ? "Opening Microsoft…" : "Set up with Microsoft"}
          </button>
        </div>
      )}

      {/* Phase 40.3: the install's OIDC provider; the one sign-up it allows without an invite. */}
      {provider && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">Or with your family&apos;s {provider} account:</p>
          <ProviderSignInButton name={provider} callbackURL="/setup/finish" errorURL="/setup" signUp label={`Set up with ${provider}`} />
        </div>
      )}
    </div>
  );
}
