"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, signOut } from "@/lib/auth-client";
import { continueAsYourself } from "@/app/profiles/actions";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";

/**
 * Phase 28 step-up: a fresh sign-in, coming back to this page. With Microsoft, `loginHint`
 * keeps the account picker on the same person. Phase 40.1b: someone without a Microsoft
 * sign-in signs out and back in instead (a new sign-in is a fresh one, whatever the kind).
 * Phase 40.1c: a passkey signs in again in place (and, 40.2a, carries on as you). Phase 40.3: the
 * OIDC provider is asked to check again (`prompt=login`; a provider may still skip it, and
 * there's no Conditional Access behind it like Entra's). `dev` (DEV-ONLY, lib/dev-auth.ts; remove before
 * shipping) re-runs the local test sign-in instead.
 */
export function SignInAgain({
  callbackURL,
  loginHint,
  dev = false,
  microsoft = false,
  passkey = false,
  oidc = false,
}: {
  callbackURL: string;
  loginHint?: string;
  dev?: boolean;
  microsoft?: boolean;
  passkey?: boolean;
  oidc?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setFailed(false);
          if (dev) {
            await fetch("/api/auth/dev/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
            router.replace(callbackURL);
            router.refresh();
            setPending(false);
            return;
          }
          if (microsoft) {
            const res = await authClient.signIn.social({ provider: "microsoft", callbackURL, ...(loginHint ? { loginHint } : {}) }).catch(() => null);
            // On success the browser is already on its way to Microsoft.
            if (!res || res.error) {
              setPending(false);
              setFailed(true);
            }
            return;
          }
          if (oidc) {
            const res = await authClient.signIn
              .social({ provider: OIDC_PROVIDER_ID, callbackURL, errorCallbackURL: callbackURL, additionalParams: { prompt: "login" } })
              .catch(() => null);
            if (!res || res.error) {
              setPending(false);
              setFailed(true);
            }
            return;
          }
          if (passkey) {
            const res = await authClient.signIn.passkey().catch(() => null);
            if (!res || res.error) {
              setPending(false);
              setFailed(true);
              return;
            }
            await continueAsYourself().catch(() => null);
            router.replace(callbackURL);
            router.refresh();
            setPending(false);
            return;
          }
          await signOut().catch(() => null);
          router.push("/sign-in");
        }}
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-medium sm:min-h-9 text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : microsoft || dev || passkey || oidc ? "🔐 Sign in again" : "🔐 Sign out and back in"}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          Couldn&apos;t start the sign-in. Try again.
        </span>
      )}
    </span>
  );
}
