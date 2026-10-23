"use client";

import { useActionState, useState, useTransition } from "react";
import { btnDanger } from "@/components/styles";
import { ConfirmAction } from "@/components/submit";
import { disconnectTeams, removeDevice, resetPhoneAlertKeys, saveTeamsLink, sendTestAlert, setChannel, type AlertFormState } from "./actions";

const btn = "inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-input hover:bg-muted disabled:opacity-50 sm:min-h-9";

function Messages({ state }: { state: AlertFormState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm text-foreground">
          {state.ok}
        </p>
      )}
    </>
  );
}

/** One person's switch + test for one channel. Stays switch-offable even when unavailable. */
export function PersonChannel({
  personId,
  channel,
  label,
  enabled,
  available,
  status,
}: {
  personId: string;
  channel: "teams" | "email";
  label: string;
  enabled: boolean;
  available: boolean;
  status: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertFormState>({});
  const run = (fn: () => Promise<AlertFormState>) =>
    start(async () => {
      setMsg(await fn());
    });

  return (
    <div className="space-y-1.5">
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending || (!available && !enabled)}
          onChange={(e) => {
            const on = e.target.checked;
            run(() => setChannel(personId, channel, on));
          }}
          className="size-4"
        />
        <span className="break-all">{label}</span>
      </label>
      {available && (
        <button type="button" disabled={pending} onClick={() => run(() => sendTestAlert(personId, channel))} className={btn}>
          Send a test
        </button>
      )}
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <Messages state={msg} />
    </div>
  );
}

export function TeamsLinkForm({ replacing }: { replacing: boolean }) {
  const [state, action, pending] = useActionState<AlertFormState, FormData>(saveTeamsLink, {});
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="teams-url">
        {replacing ? "Replace the family's Teams link" : "The family's Teams workflow link"}
      </label>
      <div className="flex gap-2">
        {/* type=password: it's a bearer secret, so it shouldn't sit on screen or in autofill. */}
        <input
          id="teams-url"
          name="url"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          required
          placeholder="https://…logic.azure.com/workflows/…"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm sm:min-h-9"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 sm:min-h-9"
        >
          Save
        </button>
      </div>
      <Messages state={state} />
    </form>
  );
}

export function DisconnectTeamsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertFormState>({});
  return (
    <div>
      <ConfirmAction
        question="Disconnect Teams for everyone? Nobody gets Teams alerts until an admin pastes a workflow link again."
        yes="Disconnect"
        pending={pending}
        onConfirm={() =>
          start(async () => {
            setMsg(await disconnectTeams());
          })
        }
        className={btn}
        yesClassName={btnDanger}
      >
        Disconnect Teams for everyone
      </ConfirmAction>
      <Messages state={msg} />
    </div>
  );
}

/**
 * Phase 21.6: one person's phones. No on/off switch — registered phones are the opt-in.
 * Any admin can remove any admin's phone (a lost phone is the reason to).
 */
export function PersonPhones({
  personId,
  devices,
  canTest,
  status,
}: {
  personId: string;
  devices: { id: string; added: string }[];
  canTest: boolean;
  status: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertFormState>({});
  const run = (fn: () => Promise<AlertFormState>) =>
    start(async () => {
      setMsg(await fn());
    });
  return (
    <div className="space-y-1.5">
      <p className="text-sm">
        Phone {devices.length === 0 ? "(none set up)" : `(${devices.length} ${devices.length === 1 ? "phone" : "phones"})`}
      </p>
      {devices.length > 0 && (
        <ul className="space-y-1">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              Device added {d.added}
              <ConfirmAction
                question="Remove this phone? It stops getting alerts until it's set up again on the phone itself."
                yes="Remove"
                pending={pending}
                onConfirm={() => run(() => removeDevice(d.id))}
                aria-label={`Remove the phone added ${d.added}`}
                className="inline-flex min-h-11 items-center underline hover:text-foreground sm:min-h-0"
                yesClassName={btnDanger}
              >
                Remove
              </ConfirmAction>
            </li>
          ))}
        </ul>
      )}
      {canTest && devices.length > 0 && (
        <button type="button" disabled={pending} onClick={() => run(() => sendTestAlert(personId, "push"))} className={btn}>
          Send a test
        </button>
      )}
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      <Messages state={msg} />
    </div>
  );
}

/** Phase 45.2: replace phone-alert keys the server can no longer read (an admin, asked first). */
export function ResetPhoneKeysButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertFormState>({});
  return (
    <div>
      <ConfirmAction
        question="Make new phone-alert keys? Every phone stops getting alerts until its person turns them on again."
        yes="Make new keys"
        pending={pending}
        onConfirm={() =>
          start(async () => {
            setMsg(await resetPhoneAlertKeys());
          })
        }
        className={btn}
        yesClassName={btnDanger}
      >
        Make new phone-alert keys
      </ConfirmAction>
      <Messages state={msg} />
    </div>
  );
}
