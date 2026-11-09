"use client";

import { useKeptActionState } from "@/components/keep-typed";
import { RefreshCw } from "lucide-react";
import { SubmitButton } from "@/components/submit";
import { iconBtn } from "@/components/styles";
import { syncFromMicrosoft, type SyncState } from "./actions";

/**
 * Phase 66b: "Sync from Microsoft" on your own page. A Microsoft timeout or refusal says so here,
 * instead of replacing the page with "Something went wrong".
 */
export function SyncFromMicrosoftButton({ personId }: { personId: string }) {
  const [state, action, , keptForm] = useKeptActionState(syncFromMicrosoft.bind(null, personId), {} as SyncState);
  return (
    <form ref={keptForm} action={action} className="flex items-center gap-2">
      <SubmitButton title="Sync from Microsoft" aria-label="Sync from Microsoft" className={`${iconBtn} ring-1 ring-input`}>
        <RefreshCw size={16} />
      </SubmitButton>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
