"use client";

import { useActionState } from "react";
import { btn } from "@/components/styles";
import type { FeedFormState } from "./actions";

export function RefreshButton({ action, name }: { action: () => Promise<FeedFormState>; name: string }) {
  const [state, formAction, pending] = useActionState<FeedFormState>(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} aria-label={`Refresh ${name}`} className={btn}>
        {pending ? "Refreshing…" : "Refresh"}
      </button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      {state.notice && <span className="text-xs text-muted-foreground">{state.notice}</span>}
    </form>
  );
}
