"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { btn, btnPrimary } from "@/components/styles";
import { continueAsYourself } from "@/app/profiles/actions";
import { OIDC_PROVIDER_ID } from "@/lib/oidc-config";
import { startProviderInvite } from "./actions";

/**
 * One tap: the device makes the passkey (browsers only start one from a tap), then you're in.
 * Phase 40.3: or, when the install has an OIDC provider (`provider`, its name), "Use it instead":
 * the server checks the invite and lets this one sign-in sign up, then the browser goes to the
 * provider and comes back to /invite/<token>/finish.
 */
export function AcceptInvite({ token, provider, initialError }: { token: string; provider: string | null; initialError?: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialError ?? null);
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        className={`${btnPrimary} w-full justify-center`}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await authClient.passkey.addPasskey({ context: token, createSession: true }).catch(() => null);
            if (!res || res.error) {
              setError(res?.error?.message ?? "The passkey wasn't made. Try again.");
              return;
            }
            await continueAsYourself().catch(() => null);
            router.push("/");
            router.refresh();
          })
        }
      >
        {pending ? "Waiting for your device…" : "Make my passkey"}
      </button>
      {provider && (
        <button
          type="button"
          disabled={pending}
          className={`${btn} w-full justify-center`}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const started = await startProviderInvite(token).catch(() => ({ error: "That didn't work. Try again." }));
              if (started.error) {
                setError(started.error);
                return;
              }
              const back = `/invite/${encodeURIComponent(token)}`;
              const res = await authClient.signIn
                .social({ provider: OIDC_PROVIDER_ID, requestSignUp: true, callbackURL: `${back}/finish`, errorCallbackURL: back })
                .catch(() => null);
              // On success the browser is already on its way to the provider.
              if (!res || res.error) setError("That didn't work. Try again, or make a passkey instead.");
            })
          }
        >
          Use {provider} instead
        </button>
      )}
    </div>
  );
}
