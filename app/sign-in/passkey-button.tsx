"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * Phase 40.1c: sign in with a passkey this device knows (no username: the device offers the
 * ones it has for this site). The device's own lock unlocks it.
 */
export function PasskeySignInButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await authClient.signIn.passkey().catch(() => null);
          if (!res || res.error) {
            setPending(false);
            setError("That didn't sign you in. Try again, or use another way.");
            return;
          }
          router.push("/profiles");
          router.refresh();
        }}
        className="flex w-full items-center justify-center gap-3 rounded-md bg-brand px-4 py-3 font-medium text-white shadow-sm transition hover:bg-brand-hover disabled:opacity-60"
      >
        <span aria-hidden>🔑</span>
        {pending ? "Waiting for your device…" : "Sign in with a passkey"}
      </button>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
