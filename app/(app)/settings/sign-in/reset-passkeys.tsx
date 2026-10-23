"use client";

import { useActionState, useState } from "react";
import { ConfirmSubmit } from "@/components/submit";
import { btn, btnDanger, field } from "@/components/styles";
import type { ResetState } from "./actions";

type Action = (prevState: ResetState, formData: FormData) => Promise<ResetState>;

/**
 * Phase 40.2c: "Reset passkeys" for someone who lost their phone. It asks first, in place; then
 * the new sign-in link comes back once, to hand over (the server keeps only a hash of it).
 */
export function ResetPasskeys({ action, name, hours }: { action: Action; name: string; hours: number }) {
  const [state, formAction] = useActionState<ResetState, FormData>(action, {});
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  if (state.link && state.link !== shownLink) {
    const link = state.link;
    return (
      <div className="basis-full space-y-2 rounded-md bg-muted p-3">
        <p role="status" className="text-sm text-foreground">
          {name}&apos;s passkeys are cleared and they&apos;re signed out everywhere. This link gets them back in: it works once,
          for the next {hours === 1 ? "hour" : `${hours} hours`}, and this is the only time it&apos;s shown. Hand it over in person,
          not through anything on the lost phone. If a device still lists an old passkey for the app, they pick the newest.
        </p>
        <input readOnly value={link} aria-label={`New sign-in link for ${name}`} onFocus={(e) => e.currentTarget.select()} className={`${field} w-full font-mono text-xs`} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            onClick={async () => {
              if (!navigator.clipboard) return setCopied(false);
              await navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className={btn} onClick={() => setShownLink(link)}>
            Done
          </button>
        </div>
        {copied === false && <p className="text-xs text-muted-foreground">Couldn&apos;t copy it here: select the link above and copy it.</p>}
      </div>
    );
  }

  return (
    <form action={formAction}>
      <ConfirmSubmit
        question={`Reset ${name}'s passkeys? Every passkey they have stops working and they're signed out everywhere. You get a link, good for ${hours === 1 ? "an hour" : `${hours} hours`}, to give them so they can make a new one. ${name} and the other admins are told.`}
        yes="Reset"
        aria-label={`Reset ${name}'s passkeys`}
        className="inline-flex min-h-11 items-center text-xs font-medium text-destructive hover:text-red-800 dark:hover:text-red-400 sm:min-h-0"
        yesClassName={btnDanger}
      >
        Reset passkeys
      </ConfirmSubmit>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
