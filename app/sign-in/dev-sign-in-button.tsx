"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * DEV-ONLY testing sign-in (lib/dev-auth.ts). REMOVE BEFORE SHIPPING. Rendered only when
 * DEV_AUTH=1 outside production; the endpoint itself also refuses non-localhost hosts.
 */
export function DevSignInButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  return (
    <div className="space-y-2 rounded-md border-2 border-dashed border-tomato p-3 text-center">
      <button
        type="button"
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          const res = await fetch("/api/auth/dev/sign-in", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }).catch(() => null);
          if (res?.ok) router.replace("/profiles");
          else setState("failed");
        }}
        className="w-full rounded-md bg-tomato px-4 py-2 font-bold text-white disabled:opacity-60"
      >
        {state === "pending" ? "Signing in…" : "Dev sign-in (testing only)"}
      </button>
      <p className="text-xs text-muted-foreground">
        {state === "failed" ? "Dev sign-in refused. It only works on localhost with DEV_AUTH=1." : "Local testing only. Removed before shipping."}
      </p>
    </div>
  );
}
