"use client";

import Link from "next/link";
import { useEffect } from "react";
import { captureError } from "@/lib/observability";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";

/**
 * There was no error boundary anywhere in the app before this — a thrown server-action
 * error (or any other render-time throw under this layout) was an unrecoverable 500 with
 * no way back except typing a URL by hand. Next 16 sanitizes Server Component error
 * messages in production regardless, so this deliberately doesn't try to show `error.message`
 * — just a way out. See docs/BUILD.md's Phase 5 and Phase 6 notes for the workarounds this
 * absence forced (redirect() instead of throw, useActionState error state instead of a
 * thrown Error) — those still apply; this boundary is a safety net, not a replacement.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // An error with a digest came from the server, where instrumentation.ts's onRequestError
    // already reported it; capturing it again here would double-count it (with a sanitized
    // message). Only client-side render errors are new to Sentry at this point.
    if (!error.digest) captureError(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm rounded-lg bg-card p-6 text-center shadow-sm ring-1 ring-border">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <BunsonMoment kind="cheer" pose="stand" text={MOMENT_LINES.oops} className="mt-3 flex justify-center" />
        <p className="mt-2 text-sm text-muted-foreground">
          That didn&apos;t work. Try again, or head back home.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground ring-1 ring-input hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
