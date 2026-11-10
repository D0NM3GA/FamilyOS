"use client";

import { useId, useRef } from "react";
import { field } from "@/components/styles";
import { PASSPHRASE_MAX, PASSPHRASE_MIN } from "@/lib/backup/locked";

/**
 * The household backup's download (a plain form post, so the browser saves the file itself),
 * with the passphrase that locks it (lib/backup/locked.ts). Typed twice, since a typo would
 * lock the file for good; the route checks both again. The fields empty once it's sent, so the
 * passphrase doesn't sit on the page.
 */
export function BackupDownloadForm() {
  const id = useId();
  const again = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);

  function checkMatch() {
    const a = again.current;
    if (a) a.setCustomValidity(a.value && a.value !== first.current?.value ? "The two passphrases don't match." : "");
  }

  return (
    <form
      method="post"
      action="/api/backup/download"
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        const form = e.currentTarget;
        // After the browser has taken the values for the post.
        setTimeout(() => {
          form.reset();
          again.current?.setCustomValidity("");
        }, 0);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-foreground">Passphrase</span>
          <input
            ref={first}
            id={`${id}-pass`}
            name="passphrase"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSPHRASE_MIN}
            maxLength={PASSPHRASE_MAX}
            aria-describedby={`${id}-hint`}
            onChange={checkMatch}
            className={`${field} mt-1 w-full`}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-foreground">The same again</span>
          <input
            ref={again}
            name="passphraseAgain"
            type="password"
            autoComplete="new-password"
            required
            maxLength={PASSPHRASE_MAX}
            onChange={checkMatch}
            className={`${field} mt-1 w-full`}
          />
        </label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        At least {PASSPHRASE_MIN} characters; a few words works well. It locks the file, and isn&apos;t kept anywhere: without
        it, nobody can open the backup, this app included.
      </p>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" required className="mt-1 size-4" />
        <span>I&apos;ve saved this passphrase somewhere safe, like the family password manager.</span>
      </label>
      <button
        type="submit"
        className="ui-btn ui-btn-primary inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-on-brand transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95 sm:min-h-9"
      >
        Download backup (.json)
      </button>
    </form>
  );
}
