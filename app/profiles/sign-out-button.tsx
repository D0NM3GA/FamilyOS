"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";

/** Ends this device's sign-in, so someone else can sign in with theirs; then goes to `to`. */
export function SignOutButton({ className, children, to = "/sign-in" }: { className: string; children: React.ReactNode; to?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        router.push(to);
        router.refresh();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
