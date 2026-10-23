"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";

/**
 * Phase 40.3: "Sign in with <provider>" for the install's OIDC provider. An account the app
 * doesn't know is refused there (it needs an invite first); `signUp` is setup's first sign-in,
 * the one time asking to sign up is allowed without an invite (lib/oidc-sign-up.ts).
 */
export function ProviderSignInButton({ name, callbackURL, errorURL, signUp = false, label }: { name: string; callbackURL: string; errorURL: string; signUp?: boolean; label?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={async () => {
          setPending(true);
          setFailed(false);
          const res = await authClient.signIn
            .social({ provider: OIDC_PROVIDER_ID, callbackURL, errorCallbackURL: errorURL, ...(signUp ? { requestSignUp: true } : {}) })
            .catch(() => null);
          // On success the browser is already on its way to the provider.
          if (!res || res.error) {
            setPending(false);
            setFailed(true);
          }
        }}
        className="flex w-full items-center justify-center gap-3 rounded-md bg-card px-4 py-3 font-medium text-foreground shadow-sm ring-1 ring-border transition hover:bg-muted disabled:opacity-60"
      >
        {pending ? "Redirecting…" : (label ?? `Sign in with ${name}`)}
      </button>
      {failed && (
        <p role="alert" className="text-center text-xs text-destructive">
          Couldn&apos;t start the sign-in. Try again.
        </p>
      )}
    </div>
  );
}
