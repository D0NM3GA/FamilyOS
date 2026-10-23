import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { getServerSession, signedInRecently, signedInWithin } from "@/lib/session";
import { listPasskeys, passkeyPerson, PASSKEY_ERRORS } from "@/lib/my-passkeys";
import { NEW_WAY_IN_SECONDS } from "@/lib/fresh-sign-in";
import { describeSignInEvent, signInHistoryFor } from "@/lib/sign-in-events";
import { formatRelative } from "@/lib/format";
import { ConfirmSubmit } from "@/components/submit";
import { SignInAgain } from "@/components/sign-in-again";
import { btnDanger } from "@/components/styles";
import { AddPasskey } from "./add-passkey";
import { RenamePasskey } from "./rename-passkey";
import { removeMyPasskey, renameMyPasskey } from "./actions";

export const metadata = { title: "My passkeys" };

/**
 * Phase 40.2a: a passkey person's own passkeys. Add one on each device you use (or a spare),
 * so losing a phone doesn't lock you out; rename them; remove one you don't use. Adding asks for
 * a sign-in from the last 5 minutes, removing from the last 15, and the last one can't go.
 * People on Microsoft or the install's OIDC provider sign in with that only (the owner's call), so
 * they don't come here.
 */
export default async function MyPasskeysPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireActiveProfile();
  const session = await getServerSession();
  const own = session !== null && (await isSessionOwner(profile));
  const person = own ? await passkeyPerson(session.user.id) : null;
  const back = (
    <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
      ← Settings
    </Link>
  );
  if (!person || !session) {
    return (
      <div className="max-w-3xl space-y-2 p-4 sm:p-6">
        {back}
        <p className="text-muted-foreground">Passkeys are for grown-ups who sign in with one, on their own profile.</p>
      </div>
    );
  }

  // canAdd/canRemove: what the server allows right now; the actions and the passkey routes check again.
  const [passkeys, history, canAdd, canRemove, { error: code }] = await Promise.all([
    listPasskeys(session.user.id),
    signInHistoryFor(person.id),
    signedInWithin(NEW_WAY_IN_SECONDS),
    signedInRecently(),
    searchParams,
  ]);
  const onlyOne = passkeys.length === 1;
  // Own keys only: "__proto__" and friends aren't codes.
  const error = code && Object.hasOwn(PASSKEY_ERRORS, code) ? PASSKEY_ERRORS[code as keyof typeof PASSKEY_ERRORS] : null;

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        {back}
        <h1 className="text-xl font-semibold text-foreground">My passkeys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A passkey signs you in with your device&apos;s PIN, fingerprint or face. Add one on each device you use, or a spare, so
          losing a phone doesn&apos;t lock you out.{onlyOne ? " Your only passkey can't be removed: add another first." : ""}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">Passkeys</h2>
        <ul className="divide-y divide-border">
          {passkeys.map((p) => {
            const name = p.name || "Passkey";
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.createdAt ? `Added ${formatRelative(p.createdAt).toLowerCase()} · ` : ""}
                    {p.backedUp ? "syncs to your other devices" : "on one device"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <RenamePasskey action={renameMyPasskey.bind(null, p.id)} name={p.name ?? ""} />
                  {!onlyOne && canRemove && (
                    <form action={removeMyPasskey.bind(null, p.id)}>
                      <ConfirmSubmit
                        question={`Remove “${name}”? It won't sign you in anymore, and you'll be signed out on your other devices.`}
                        yes="Remove"
                        aria-label={`Remove ${name}`}
                        className="inline-flex min-h-11 items-center text-xs font-medium text-destructive hover:text-red-800 dark:hover:text-red-400 sm:min-h-0"
                        yesClassName={btnDanger}
                      >
                        Remove
                      </ConfirmSubmit>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canAdd ? (
          <AddPasskey />
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              {canRemove ? "To add a passkey, sign in again first." : "To add or remove a passkey, sign in again first."}
            </p>
            <SignInAgain callbackURL="/settings/passkeys" passkey={passkeys.length > 0} />
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Recent changes</h2>
          <ul className="space-y-1">
            {history.map((e) => (
              <li key={e.id} className="text-sm text-foreground">
                {describeSignInEvent(e, person.id)} <span className="text-xs text-muted-foreground">· {formatRelative(e.createdAt).toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
