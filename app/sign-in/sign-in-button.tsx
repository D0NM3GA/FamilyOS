"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({
          provider: "microsoft",
          callbackURL: "/profiles",
        });
      }}
      // Microsoft's own sign-in button guidance keeps this white regardless of the host
      // app's theme (like the Google/Apple equivalents) — not swept into bg-card/text-foreground
      // with the rest of the app. dark:ring/shadow just keep it from floating with no edge
      // against the dark theme's near-black page.
      className="flex w-full items-center justify-center gap-3 rounded-md bg-white px-4 py-3 font-medium text-stone-800 shadow-sm ring-1 ring-stone-300 transition hover:bg-stone-50 disabled:opacity-60 dark:shadow-lg dark:ring-white/20"
    >
      <MicrosoftLogo />
      {pending ? "Redirecting…" : "Sign in with Microsoft"}
    </button>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
