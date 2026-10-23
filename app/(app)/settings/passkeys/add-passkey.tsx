"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import { startAddingPasskey, type AddPasskeyState } from "./actions";

/**
 * Adding a passkey (Phase 40.2a), in two taps like setup's: the first asks the server (it checks
 * this is you and you signed in in the last 5 minutes, and hands back a ticket, which also holds
 * the name); the second makes the passkey, since browsers (Safari above all) only start one
 * straight from a tap. Whatever happens on the second, the form comes back: a ticket is good
 * for one try, and a fresh one is a tap away.
 */
export function AddPasskey() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AddPasskeyState, FormData>(startAddingPasskey, {});
  const [making, startMaking] = useTransition();
  // The ticket last tried (or put aside), and how that went.
  const [finished, setFinished] = useState<{ ticket: string; error?: string; added?: boolean } | null>(null);

  function makePasskey(ticket: string) {
    startMaking(async () => {
      const res = await authClient.passkey.addPasskey({ context: ticket }).catch(() => null);
      if (!res || res.error) {
        setFinished({ ticket, error: res?.error?.message ?? "The passkey wasn't made. Try again." });
        return;
      }
      setFinished({ ticket, added: true });
      router.refresh();
    });
  }

  if (state.ticket && state.ticket !== finished?.ticket) {
    const ticket = state.ticket;
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-foreground">
          Now make it. Your device will ask for its PIN, fingerprint or face.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" autoFocus disabled={making} aria-busy={making || undefined} onClick={() => makePasskey(ticket)} className={btnPrimary}>
            {making ? "Making it…" : "Make the passkey"}
          </button>
          <button type="button" disabled={making} onClick={() => setFinished({ ticket })} className={btn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // The last try's result, until the next first tap brings its own.
  const lastTry = state.ticket === finished?.ticket ? finished : null;
  const error = lastTry ? lastTry.error : state.error;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className={`${fieldLabel} block`}>Name (optional)</span>
        <input name="name" maxLength={40} placeholder="Work laptop" className={`${field} mt-1 w-48`} />
      </label>
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={btn}>
        {pending ? "One moment…" : "Add a passkey"}
      </button>
      {lastTry?.added && (
        <p role="status" className="basis-full text-sm text-foreground">
          Passkey added.
        </p>
      )}
      {error && (
        <p role="alert" className="basis-full text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
