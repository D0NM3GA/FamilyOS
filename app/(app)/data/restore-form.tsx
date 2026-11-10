"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RewardWord } from "@/components/family-look";
import { field } from "@/components/styles";
import { isLockedBackup, lockBackup, passphraseProblem, PASSPHRASE_MAX, PASSPHRASE_MIN, unlockBackup } from "@/lib/backup/locked";

type Preview = {
  deletes: Record<string, number>;
  inserts: Record<string, number>;
  matched: { backupName: string; linkedName: string }[];
  keptLinked: string[];
  newMembersNeedingPin: number;
  matchedButRemoved: number;
  timeZoneNote: string | null;
  giftNote?: string | null;
  anythingToDelete: boolean;
  sealedMoneyJars: number;
  money: { canRestore: true; counts: MoneyCounts } | { canRestore: false; reason: string } | null;
  unsignedJarMembers: number;
  planDigest: string;
};

type MoneyCounts = { jars: number; jarsSkipped: number; membersKept: number; membersWaiting: number; membersDropped: number };

type Step =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "locked"; lockedText: string; error?: string }
  // `passphrase`: the one that opened a locked file, which locks the before-restore copy too.
  | { kind: "preview"; text: string; preview: Preview; fileHash: string; passphrase: string | null }
  | { kind: "errors"; errors: string[] }
  | { kind: "done"; previousBackup: unknown; moneyRestored: MoneyCounts | null; passphrase: string };

// A dropped connection or an unreadable reply after apply means we can't know whether the
// restore committed, so the message must not claim "nothing changed".
const UNKNOWN = "The server didn't answer clearly, so it's not certain whether the restore finished. Check the household's data before trying again.";

async function post(text: string, query: string): Promise<{ ok: boolean; body: Record<string, unknown> & { errors?: string[] } }> {
  try {
    const res = await fetch(`/api/backup/restore?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    const body = await res.json();
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: { errors: [UNKNOWN] } };
  }
}

/**
 * Saves the automatic pre-restore snapshot the server returns, locked like any household backup
 * (lib/backup/locked.ts), here in the browser.
 */
async function saveSnapshot(previousBackup: unknown, passphrase: string) {
  const locked = await lockBackup(JSON.stringify(previousBackup, null, 2), passphrase);
  const blob = new Blob([locked], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.download = `familyos-backup-before-restore-${stamp}-locked.json`;
  // Attached, and revoked later: Firefox and Safari can drop a download whose URL is
  // revoked in the same tick, and this file is the only copy.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/**
 * Restore from a backup file (Phase 16.5): choose file -> preview (no changes) -> type
 * REPLACE -> apply. The file is read in the browser and sent to the server twice; nothing
 * is kept server-side between the two calls.
 */
export function RestoreForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [confirm, setConfirm] = useState("");
  const [withMoney, setWithMoney] = useState(false);
  // A plain (older) file brings no passphrase, so the before-restore copy needs one chosen here.
  const [copyPass, setCopyPass] = useState("");
  const [copyPassAgain, setCopyPassAgain] = useState("");
  const [unlockWith, setUnlockWith] = useState("");
  // Set before the first await, so a second Enter can't start a second unlock.
  const [busy, setBusy] = useState(false);
  // Each step replaces the last one whole, taking the focused control with it: focus moves to the
  // start of the new step (what it says, or the file box again) instead of the top of the page.
  // Not on first load: only once someone has started.
  const lead = useRef<HTMLElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (step.kind === "working" || !started.current) return;
    lead.current?.focus();
  }, [step.kind]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    started.current = true;
    setStep({ kind: "working", label: "Checking the file…" });
    const text = await file.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // The server says what's wrong with it.
    }
    if (isLockedBackup(json)) {
      setUnlockWith("");
      return setStep({ kind: "locked", lockedText: text });
    }
    await checkPlain(text, null);
  }

  async function checkPlain(text: string, passphrase: string | null) {
    const { ok, body } = await post(text, "mode=preview");
    if (!ok) return setStep({ kind: "errors", errors: body.errors ?? ["That didn't work."] });
    setConfirm("");
    setWithMoney(false);
    setCopyPass("");
    setCopyPassAgain("");
    setStep({ kind: "preview", text, preview: body.preview as Preview, fileHash: body.fileHash as string, passphrase });
  }

  async function onUnlock() {
    if (step.kind !== "locked" || busy) return;
    setBusy(true);
    const { lockedText } = step;
    const passphrase = unlockWith;
    setStep({ kind: "working", label: "Opening the file…" });
    const opened = await unlockBackup(lockedText, passphrase);
    setUnlockWith("");
    if (!opened.ok) {
      setBusy(false);
      return setStep({ kind: "locked", lockedText, error: opened.error });
    }
    setStep({ kind: "working", label: "Checking the file…" });
    await checkPlain(opened.text, passphrase);
    setBusy(false);
  }

  async function onApply() {
    if (step.kind !== "preview") return;
    const query = new URLSearchParams({ mode: "apply", confirm, hash: step.fileHash, plan: step.preview.planDigest });
    if (withMoney) query.set("money", "1");
    setStep({ kind: "working", label: "Restoring… keep this page open." });
    const { ok, body } = await post(step.text, query.toString());
    if (!ok) return setStep({ kind: "errors", errors: body.errors ?? [UNKNOWN] });
    if (!body.previousBackup) return setStep({ kind: "errors", errors: [UNKNOWN] });
    const passphrase = step.passphrase ?? copyPass;
    setStep({ kind: "done", previousBackup: body.previousBackup, moneyRestored: (body.moneyRestored as MoneyCounts | null) ?? null, passphrase });
    await saveSnapshot(body.previousBackup, passphrase).catch(() => {});
    // Drops the client router cache, so no page shows data from before the restore.
    router.refresh();
  }

  if (step.kind === "working") return <p className="mt-3 text-sm text-muted-foreground">{step.label}</p>;

  if (step.kind === "done") {
    const { previousBackup, passphrase } = step;
    return (
      <div className="mt-3 space-y-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30">
        <p ref={(el) => void (lead.current = el)} tabIndex={-1} className="font-medium outline-none">
          Restore complete.
        </p>
        {step.moneyRestored && (
          <p>
            {step.moneyRestored.jars} money jar{step.moneyRestored.jars === 1 ? " is" : "s are"} back. Each jar&apos;s members reconnect its bank
            feed and Privacy.com in the jar&apos;s Settings.
          </p>
        )}
        <p>
          A copy of the household from just before the restore should have downloaded, locked with the same
          passphrase. It&apos;s the only copy, so keep it until you&apos;re sure everything looks right.{" "}
          <button type="button" onClick={() => void saveSnapshot(previousBackup, passphrase)} className="font-medium underline">
            Download it again
          </button>
        </p>
        <p>
          Next, set PINs for restored family members in{" "}
          <Link href="/settings/household" className="font-medium underline">
            Settings → Household
          </Link>
          .
        </p>
      </div>
    );
  }

  if (step.kind === "preview") {
    const p = step.preview;
    const copyReady = step.passphrase !== null || (passphraseProblem(copyPass) === null && copyPass === copyPassAgain);
    const canApply = confirm === "REPLACE" && copyReady;
    return (
      <div className="mt-3 space-y-3 text-sm">
        <p ref={(el) => void (lead.current = el)} tabIndex={-1} className="font-medium text-foreground outline-none">
          This will replace the household&apos;s data with the backup&apos;s.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CountList title="Deleted now" counts={p.deletes} />
          <CountList title="Restored from the file" counts={p.inserts} />
        </div>
        {p.matched.length > 0 && (
          <p className="text-muted-foreground">
            Kept as the same signed-in person:{" "}
            {p.matched.map((m) => `${m.backupName} → ${m.linkedName}`).join(", ")}.
          </p>
        )}
        {p.keptLinked.length > 0 && (
          <p className="text-muted-foreground">
            With their own sign-in and not in the file, so kept: {p.keptLinked.join(", ")}. Their sign-in stays; their
            birthdays, <RewardWord /> and log entries are replaced by the file&apos;s like everyone else&apos;s.
          </p>
        )}
        {p.newMembersNeedingPin > 0 && (
          <p className="text-muted-foreground">
            {p.newMembersNeedingPin} household member(s) will need a PIN set afterwards (Settings → Household).
          </p>
        )}
        {p.money && !p.money.canRestore && (
          <p className="text-muted-foreground">
            The file has {p.sealedMoneyJars} money jar{p.sealedMoneyJars === 1 ? "" : "s"}, sealed, but they can&apos;t be put back: {p.money.reason}{" "}
            Today&apos;s jars stay as they are.
          </p>
        )}
        {p.money?.canRestore && (
          <div className="space-y-1 rounded-md bg-muted/50 p-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={withMoney} onChange={(e) => setWithMoney(e.target.checked)} className="mt-1" />
              <span>
                <strong>Also put the money jars back as they were in this file</strong> ({p.money.counts.jars} jar{p.money.counts.jars === 1 ? "" : "s"}).
                This replaces today&apos;s jars. You won&apos;t see what&apos;s in them; their members are told.
              </span>
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              {p.money.counts.membersKept} member(s) keep their jars
              {p.money.counts.membersWaiting > 0 && `, ${p.money.counts.membersWaiting} of them once they sign in`}
              {p.money.counts.membersDropped > 0 && `; ${p.money.counts.membersDropped} who aren't grown-ups in this household any more won't`}
              {p.money.counts.jarsSkipped > 0 && `; ${p.money.counts.jarsSkipped} jar(s) with nobody left are skipped`}. Bank feeds need reconnecting.
            </p>
          </div>
        )}
        {(!p.money || !p.money.canRestore) && p.unsignedJarMembers > 0 && (
          <p className="font-medium text-destructive">
            {p.unsignedJarMembers} money jar member(s) haven&apos;t signed in yet, and this file can&apos;t put jars back, so
            restoring it would take them out of their jars. Have them sign in first.
          </p>
        )}
        {p.money?.canRestore && p.unsignedJarMembers > 0 && !withMoney && (
          <p className="font-medium text-destructive">
            {p.unsignedJarMembers} money jar member(s) haven&apos;t signed in yet: tick the box above, or have them sign in first.
          </p>
        )}
        {p.matchedButRemoved > 0 && (
          <p className="text-muted-foreground">{p.matchedButRemoved} matched person(s) were removed from the household and stay removed.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Not in a backup, so not restored: PINs, photos (they come back from Microsoft 365), and connected services.
          A copy of the household as it is now downloads automatically before anything changes.
        </p>
        {/* Phase 49: a backup from another zone has its days moved, not shifted. */}
        {p.timeZoneNote && <p className="text-xs text-muted-foreground">{p.timeZoneNote}</p>}
        {p.giftNote && <p className="text-xs text-muted-foreground">{p.giftNote}</p>}
        {step.passphrase === null && (
          <div className="space-y-2 rounded-md bg-muted/50 p-2">
            <p className="text-xs text-muted-foreground">
              This file isn&apos;t locked (it&apos;s from before backups were). Choose a passphrase for the copy of today&apos;s household
              that downloads first: at least {PASSPHRASE_MIN} characters, and save it somewhere safe.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="new-password"
                value={copyPass}
                maxLength={PASSPHRASE_MAX}
                onChange={(e) => setCopyPass(e.target.value)}
                aria-label="Passphrase for the copy of today's household"
                placeholder="Passphrase"
                className={`${field} w-56`}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={copyPassAgain}
                maxLength={PASSPHRASE_MAX}
                onChange={(e) => setCopyPassAgain(e.target.value)}
                aria-label="The same passphrase again"
                placeholder="The same again"
                className={`${field} w-56`}
              />
            </div>
            {copyPassAgain.length > 0 && copyPass !== copyPassAgain && (
              <p className="text-xs font-medium text-destructive">The two passphrases don&apos;t match.</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type REPLACE"
            aria-label="Type REPLACE to confirm"
            className="min-h-11 w-40 rounded-md border border-input px-2 py-1.5 text-sm focus:border-ring focus:outline-none sm:min-h-9"
          />
          <button
            type="button"
            disabled={!canApply}
            onClick={onApply}
            className="inline-flex min-h-11 items-center rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 sm:min-h-9"
          >
            Replace household data
          </button>
          <button
            type="button"
            onClick={() => setStep({ kind: "idle" })}
            className="inline-flex min-h-11 items-center px-1 text-sm text-muted-foreground hover:underline sm:min-h-9"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === "locked") {
    return (
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onUnlock();
        }}
      >
        <label className="block text-sm">
          <span className="font-medium text-foreground">This backup is locked. Its passphrase:</span>
          <input
            ref={(el) => void (lead.current = el)}
            type="password"
            autoComplete="current-password"
            required
            value={unlockWith}
            maxLength={PASSPHRASE_MAX}
            onChange={(e) => setUnlockWith(e.target.value)}
            aria-describedby={step.error ? "unlock-error" : undefined}
            className={`${field} mt-1 block w-full max-w-xs`}
          />
        </label>
        <p className="text-xs text-muted-foreground">It opens here, in this browser: the passphrase isn&apos;t sent anywhere.</p>
        {step.error && (
          <p id="unlock-error" role="alert" className="text-xs font-medium text-destructive">
            {step.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="ui-btn ui-btn-primary inline-flex min-h-11 items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-hover sm:min-h-9"
          >
            Open it
          </button>
          <button
            type="button"
            onClick={() => setStep({ kind: "idle" })}
            className="inline-flex min-h-11 items-center px-1 text-sm text-muted-foreground hover:underline sm:min-h-9"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <input
        ref={(el) => void (lead.current = el)}
        type="file"
        accept="application/json,.json"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label="Backup file"
        className="block max-w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-3 file:text-sm file:font-medium file:text-foreground sm:file:py-1.5"
      />
      <p className="text-xs text-muted-foreground">You&apos;ll see exactly what changes before anything happens.</p>
      {step.kind === "errors" && (
        <ul role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
          {step.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        After a restore, set PINs for restored family members in{" "}
        <Link href="/settings/household" className="underline">
          Settings → Household
        </Link>
        .
      </p>
    </div>
  );
}

function CountList({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div className="rounded-md bg-muted p-2">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {Object.entries(counts).map(([label, n]) => (
          <li key={label}>
            {n.toLocaleString()} {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
