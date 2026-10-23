"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import { createInviteAction, type InviteFormState } from "./actions";

type Member = { id: string; firstName: string; lastName: string | null; email: string | null };

const noSubscription = () => () => {};

/**
 * Phase 40.2b: invite a grown-up, someone in the household on a PIN or someone new. The link
 * comes back once: copy it or share it, then it's gone from this screen (the server keeps only
 * a hash). `microsoft` adds a word about people who'd sign in with Microsoft instead.
 */
export function InviteForm({ members, microsoft, hours }: { members: Member[]; microsoft: boolean; hours: number }) {
  // A new form (and a new link) each time: the key resets the action's state.
  const [round, setRound] = useState(0);
  return <InviteRound key={round} members={members} microsoft={microsoft} hours={hours} onDone={() => setRound((r) => r + 1)} />;
}

function InviteRound({ members, microsoft, hours, onDone }: { members: Member[]; microsoft: boolean; hours: number; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(createInviteAction, {});
  const [who, setWho] = useState<"member" | "new">(members.length > 0 ? "member" : "new");
  const [personId, setPersonId] = useState(members[0]?.id ?? "");
  const [email, setEmail] = useState(members[0]?.email ?? "");
  const [copied, setCopied] = useState<boolean | null>(null);
  // Known only in the browser: false on the server's render and while hydrating, then the truth.
  const canShare = useSyncExternalStore(noSubscription, () => typeof navigator.share === "function", () => false);
  const chosen = members.find((m) => m.id === personId);

  if (state.link) {
    const link = state.link;
    const name = state.firstName ?? chosen?.firstName ?? "them";
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-foreground">
          The invite for {name} is ready. Send them this link yourself: it works once, for the next {hours} hours, and this is the
          only time it&apos;s shown.
        </p>
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className={`${field} w-full font-mono text-xs`} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnPrimary}
            onClick={async () => {
              // No clipboard off a secure origin (npm run dev:lan): say how instead.
              if (!navigator.clipboard) return setCopied(false);
              await navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          {canShare && (
            <button type="button" className={btn} onClick={() => navigator.share({ url: link }).catch(() => {})}>
              Share…
            </button>
          )}
          <button type="button" className={btn} onClick={onDone}>
            Done
          </button>
        </div>
        {copied === false && <p className="text-xs text-muted-foreground">Couldn&apos;t copy it here: select the link above and copy it.</p>}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className={fieldLabel}>Who</legend>
        {members.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="radio"
              name="who"
              value="member"
              checked={who === "member"}
              onChange={() => {
                setWho("member");
                setEmail(chosen?.email ?? "");
              }}
            />
            Someone in the household
            <select
              name="personId"
              value={personId}
              disabled={who !== "member"}
              onChange={(e) => {
                setPersonId(e.target.value);
                setEmail(members.find((m) => m.id === e.target.value)?.email ?? "");
              }}
              className={field}
              aria-label="Household member"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.lastName ? `${m.firstName} ${m.lastName}` : m.firstName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="who"
            value="new"
            checked={who === "new"}
            onChange={() => {
              setWho("new");
              // A household member's address isn't the new person's.
              setEmail("");
            }}
          />
          Someone new
        </label>
        {who === "new" && (
          <div className="flex flex-wrap gap-2 pl-6">
            <input name="firstName" required maxLength={40} placeholder="First name" aria-label="First name" className={`${field} w-40`} />
            <input name="lastName" maxLength={60} placeholder="Last name (optional)" aria-label="Last name" className={`${field} w-48`} />
          </div>
        )}
      </fieldset>
      <label className="block">
        <span className={`${fieldLabel} block`}>Their email</span>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${field} mt-1 w-full max-w-sm`}
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          It names their passkey on their device. The app doesn&apos;t send it anywhere.
          {microsoft ? " Someone with a Microsoft account in the family's tenant just signs in with that instead." : ""}
        </span>
      </label>
      <label className="block">
        <span className={`${fieldLabel} block`}>Role</span>
        <select name="role" defaultValue="ADULT" className={`${field} mt-1`}>
          <option value="ADULT">Adult</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      {state.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={btnPrimary}>
        {pending ? "One moment…" : "Make the invite link"}
      </button>
    </form>
  );
}
