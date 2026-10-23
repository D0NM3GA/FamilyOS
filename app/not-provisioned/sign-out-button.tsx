"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.push("/sign-in");
      }}
      className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
