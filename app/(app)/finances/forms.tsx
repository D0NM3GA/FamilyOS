"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { type ReactNode, useState, useTransition } from "react";
import { btnPrimary } from "@/components/styles";
import { SubmitButton } from "@/components/submit";
import type { FormState } from "./actions";

export { ConfirmSubmit } from "@/components/submit";

/** A form wired to a FormState action, showing its error or success line under the fields. */
export function ActionForm({
  action,
  children,
  className = "flex flex-col gap-2",
  resetOnSuccess = false,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, run, , keptForm] = useKeptActionState(action, {});
  return (
    <form ref={keptForm}
      action={run}
      className={className}
      // Secrets (setup token, API key) must not linger in the field after a successful save.
      key={resetOnSuccess && state.ok ? state.ok : undefined}
    >
      {children}
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-tomato">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm font-semibold">
          {state.ok}
        </p>
      )}
    </form>
  );
}

/** A submit button that knows when its form is busy (components/submit.tsx), saying "Working…" while it is. */
export function Submit({ children, className = btnPrimary, pendingText = "Working…" }: { children: ReactNode; className?: string; pendingText?: string }) {
  return (
    <SubmitButton className={className} pendingText={pendingText}>
      {children}
    </SubmitButton>
  );
}

/** "Sync now", with its answer shown inline. */
export function SyncButton({ sync, label = "🔄 Sync now", busy = "Syncing…" }: { sync: () => Promise<FormState>; label?: string; busy?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  // A refusal or a dropped connection says so here; before, only a success showed, and a throw
  // took the whole page to the error screen.
  const run = () =>
    start(async () => {
      try {
        const r = await sync();
        setMsg(r.error ? { text: r.error, bad: true } : r.ok ? { text: r.ok, bad: false } : null);
      } catch (err) {
        console.error("[sync] failed", err);
        setMsg({ text: "That didn't go through. Check your connection and try again.", bad: true });
      }
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="inline-flex min-h-11 items-center rounded-xl border-2 border-ink px-3 text-sm font-bold hover:bg-muted disabled:opacity-50 sm:min-h-9 dark:border-white/20"
      >
        {pending ? busy : label}
      </button>
      {msg && (
        <span role={msg.bad ? "alert" : "status"} className={`text-xs ${msg.bad ? "text-destructive" : "text-muted-foreground"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
