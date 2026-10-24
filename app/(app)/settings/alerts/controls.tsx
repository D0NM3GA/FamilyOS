"use client";

import { useActionState, useState, useTransition } from "react";
import { btnDanger } from "@/components/styles";
import { ConfirmAction } from "@/components/submit";
import { allowTeamsPublishing, disconnectTeams, publishTeamsApp, removeDevice, resetPhoneAlertKeys, sendTestAlert, setAlertMailbox, setChannel, type AlertFormState } from "./actions";

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

/**
 * Phase 50: "Add to Teams" (or "Update in Teams") publishes the family's Teams app; when Microsoft
 * says the admin can't yet, the permission button shows beside it (its own form: it leaves for
 * Microsoft's sign-in and comes back here).
 */
export function TeamsAppButtons({ label, askFirst }: { label: string; askFirst: boolean }) {
  const [state, action, pending] = useActionState<AlertFormState, FormData>(() => publishTeamsApp(), {});
  const showGrant = askFirst || state.needsGrant;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {showGrant && <AllowPublishingButton />}
        <form action={action}>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50 sm:min-h-9"
          >
            {pending ? "Publishing…" : label}
          </button>
        </form>
      </div>
      <Messages state={state} />
    </div>
  );
}

/** Leaves for Microsoft's sign-in to grant AppCatalog.ReadWrite.All, and comes back to Alerts. */
function AllowPublishingButton() {
  const [state, action, pending] = useActionState<AlertFormState, FormData>(() => allowTeamsPublishing(), {});
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className={btn}>
        Allow publishing (Microsoft)
      </button>
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
        question="Disconnect Teams for everyone? Nobody gets Teams alerts until an admin adds the family's Teams app again."
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

/** Phase 53: the mailbox alert email comes from. Empty uses the server's setting. */
export function MailboxForm({ saved, fallback }: { saved: string | null; fallback: string | null }) {
  const [state, action, pending] = useActionState<AlertFormState, FormData>(setAlertMailbox, {});
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm">
        <span className="font-medium text-foreground">Send alert email from</span>
        <span className="mt-1 flex flex-wrap gap-2">
          <input
            name="mailbox"
            type="email"
            defaultValue={saved ?? ""}
            placeholder={fallback ?? "alerts@example.com"}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 min-w-0 flex-1 rounded-md bg-background px-3 py-1.5 text-sm ring-1 ring-input sm:min-h-9"
          />
          <button type="submit" disabled={pending} className={btn}>
            {pending ? "Saving…" : "Save"}
          </button>
        </span>
      </label>
      <Messages state={state} />
    </form>
  );
}

/** The Exchange PowerShell, filled in, with a copy button. */
export function CopyCommands({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{text}</pre>
      <button
        type="button"
        className={btn}
        onClick={() =>
          navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy the commands"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "The commands are copied." : ""}
      </span>
    </div>
  );
}
