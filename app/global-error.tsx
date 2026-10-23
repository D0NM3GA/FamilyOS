"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/observability";

/**
 * Last-resort boundary for a failure in the root layout itself, where app/(app)/error.tsx
 * can't render. It replaces the whole document, so it brings its own <html>/<body> and no
 * global CSS — plain inline styles only. Always reports: when this renders, even the
 * layout that would normally show a friendlier boundary has failed.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#57534e", fontSize: 14 }}>The app hit an error it couldn&apos;t recover from.</p>
          <button type="button" onClick={() => reset()} style={{ padding: "8px 16px", fontSize: 14 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
