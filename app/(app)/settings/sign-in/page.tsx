import Link from "next/link";
import { redirect } from "next/navigation";
import { backupSignInState, isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { signedInRecently, signedInWithin } from "@/lib/session";
import { NEW_WAY_IN_SECONDS } from "@/lib/fresh-sign-in";
import { microsoftEnabled, oidcSignIn } from "@/lib/auth";
import { INVITE_HOURS, invitableMembers, pendingInvites } from "@/lib/invites";
import { managedPeople, RECOVERY_HOURS, SIGN_IN_ERRORS } from "@/lib/sign-ins";
import { describeSignInEvent, householdSignInHistory } from "@/lib/sign-in-events";
import { formatRelative } from "@/lib/format";
import { ConfirmSubmit } from "@/components/submit";
import { SignInAgain } from "@/components/sign-in-again";
import { btnDanger } from "@/components/styles";
import { InviteForm } from "./invite-form";
import { ResetPasskeys } from "./reset-passkeys";
import { changeRoleAction, checkEntraNow, removeSignInAction, resetPasskeysAction, revokeInviteAction } from "./actions";
import { ENTRA_OUTCOME_WORDS, entraCheckStatus } from "@/lib/entra-check";
import { SubmitButton } from "@/components/submit";
import { btn } from "@/components/styles";

export const metadata = { title: "Sign-in" };

const ROLE_LABEL = { ADMIN: "Admin", ADULT: "Adult", KID: "Kid" } as const;

// Fixed words for each refusal code: the URL carries a code, never text.
const ERRORS: Record<string, string> = {
  ...SIGN_IN_ERRORS,
  inviteGone: "That invite isn't waiting anymore.",
  entraWait: "Entra was checked a moment ago. Try again in a minute.",
};

const linkButton = "inline-flex min-h-11 items-center text-xs font-medium sm:min-h-0";

/**
 * Phase 40.2b/c: the admins' page for who gets in. Invite a grown-up (someone in the household on
 * a PIN, or someone new) to sign in on their own with a passkey; look after the other passkey
 * people (role, reset lost passkeys, take a sign-in away); waiting invites; and every recent
 * sign-in change in the household. People on Microsoft are managed in Entra, and your own sign-in
 * is My passkeys' and another admin's, so neither is listed. Every change here asks for a sign-in
 * from the last 5 minutes.
 */
export default async function SignInSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) redirect("/settings");
  const back = (
    <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
      ← Settings
    </Link>
  );
  if (!(await isSessionOwner(profile))) {
    return (
      <div className="max-w-3xl space-y-2 p-4 sm:p-6">
        {back}
        <p className="text-muted-foreground">Switch to your own profile to manage sign-ins.</p>
      </div>
    );
  }

  const [members, people, invites, history, fresh, signIn, provider, { error: code }] = await Promise.all([
    invitableMembers(profile.householdId),
    managedPeople(profile.householdId, profile.id),
    pendingInvites(profile.householdId),
    householdSignInHistory(profile.householdId),
    signedInWithin(NEW_WAY_IN_SECONDS),
    backupSignInState(profile),
    oidcSignIn(),
    searchParams,
  ]);
  // Phase 40.4: how the last Entra check went (who it ended is in Recent changes: the owner's call).
  const entra = microsoftEnabled() ? await entraCheckStatus(profile.householdId) : null;
  // "Check now" asks for a sign-in from the last 15 minutes, like its action (it ends no new way in).
  const recent = entra !== null && (await signedInRecently());
  const microsoft = microsoftEnabled();
  // Phase 40.3: the ways in, in a sentence (the owner's call: providers live in .env).
  const ways = [microsoft ? "Microsoft" : null, provider?.name ?? null, "a passkey"].filter(Boolean) as string[];
  const waysText = ways.length === 1 ? ways[0] : `${ways.slice(0, -1).join(", ")} or ${ways.at(-1)}`;
  // Own keys only: "__proto__" and friends aren't codes (Fable's review).
  const error = code && Object.hasOwn(ERRORS, code) ? ERRORS[code] : undefined;

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        {back}
        <h1 className="text-xl font-semibold text-foreground">Sign-in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This install signs people in with {waysText} (set in the server&apos;s settings). Invite a grown-up to sign in on
          their own{provider ? ` with a passkey or ${provider.name}` : " with a passkey"}: once they do, their tile opens only
          when they sign in themselves, not with a PIN. {microsoft ? "People who sign in with Microsoft are added and removed in Entra. " : ""}
          You aren&apos;t listed here: your passkeys are in My passkeys, and another admin can change your sign-in.
          Someone in a money jar keeps their own sign-in, since jars need it. Kids stay on PIN profiles.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {microsoft && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted-foreground">
            {entra?.outcome && Object.hasOwn(ENTRA_OUTCOME_WORDS, entra.outcome)
              ? `${ENTRA_OUTCOME_WORDS[entra.outcome as keyof typeof ENTRA_OUTCOME_WORDS]}${entra.lastRunAt ? ` (${formatRelative(entra.lastRunAt).toLowerCase()})` : ""}.`
              : "Entra hasn't been checked yet."}{" "}
            Every half hour the app asks Entra who&apos;s assigned to it: roles follow Entra, and anyone no longer assigned is
            signed out until Entra gives them a role again.
          </p>
          {recent && (
            <form action={checkEntraNow}>
              <SubmitButton className={btn} pendingText="Checking…">
                Check now
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      {!fresh && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <p className="text-sm text-muted-foreground">To invite someone or change a sign-in, sign in again first.</p>
          <SignInAgain callbackURL="/settings/sign-in" loginHint={signIn.email} dev={signIn.dev} microsoft={signIn.microsoft} passkey={signIn.passkey} oidc={signIn.oidc} />
        </div>
      )}

      {fresh && (
        <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Invite a grown-up</h2>
          <InviteForm
            members={members.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email }))}
            microsoft={microsoft}
            hours={INVITE_HOURS}
          />
        </section>
      )}

      {fresh && people.length > 0 && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">People who sign in on their own</h2>
          <ul className="divide-y divide-border">
            {people.map((p) => {
              const toAdmin = p.role !== "ADMIN";
              return (
                <li key={p.id} className="space-y-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName} · {ROLE_LABEL[p.role]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.provider
                        ? `Signs in with ${provider?.name ?? "the family's provider"}`
                        : p.passkeys === 0
                          ? "No passkey yet"
                          : p.passkeys === 1
                            ? "1 passkey"
                            : `${p.passkeys} passkeys`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <form action={changeRoleAction.bind(null, p.id, toAdmin ? "ADMIN" : "ADULT")}>
                      <ConfirmSubmit
                        question={
                          toAdmin
                            ? `Make ${p.firstName} an admin? Admins change the family's settings and who can sign in.`
                            : `Make ${p.firstName} a grown-up without admin? They keep their own sign-in.`
                        }
                        yes={toAdmin ? "Make admin" : "Remove admin"}
                        className={`${linkButton} text-brand-text hover:underline`}
                      >
                        {toAdmin ? "Make admin" : "Remove admin"}
                      </ConfirmSubmit>
                    </form>
                    {!p.provider && <ResetPasskeys action={resetPasskeysAction.bind(null, p.id)} name={p.firstName} hours={RECOVERY_HOURS} />}
                    {!p.inJar && (
                      <form action={removeSignInAction.bind(null, p.id)}>
                        <ConfirmSubmit
                          question={`Take away ${p.firstName}'s own sign-in? ${p.provider ? "Their account at the provider stops getting them in" : "Their passkeys stop working"} and they're signed out everywhere. Their profile opens with a PIN again: set one in Household.${p.role === "ADMIN" ? " They stop being an admin." : ""}`}
                          yes="Take it away"
                          aria-label={`Take away ${p.firstName}'s own sign-in`}
                          className={`${linkButton} text-destructive hover:text-red-800 dark:hover:text-red-400`}
                          yesClassName={btnDanger}
                        >
                          Remove sign-in
                        </ConfirmSubmit>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {invites.length > 0 && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Waiting invites</h2>
          <ul className="divide-y divide-border">
            {invites.map((i) => {
              const name = i.person?.firstName ?? i.firstName ?? i.email;
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {name} · {i.recovery ? "new sign-in link" : ROLE_LABEL[i.role]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {i.from ? `From ${i.from} · ` : ""}
                      {i.usable ? `ends ${formatRelative(i.expiresAt).toLowerCase()}` : "won't work: whoever made it isn't an admin now. Cancel it and make a new one."}
                    </p>
                  </div>
                  <form action={revokeInviteAction.bind(null, i.id)}>
                    <ConfirmSubmit
                      question={`Cancel the ${i.recovery ? "link" : "invite"} for ${name}? It stops working.`}
                      yes="Cancel it"
                      aria-label={`Cancel the invite for ${name}`}
                      className={`${linkButton} text-destructive hover:text-red-800 dark:hover:text-red-400`}
                      yesClassName={btnDanger}
                    >
                      Cancel
                    </ConfirmSubmit>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Recent changes</h2>
          <ul className="space-y-1">
            {history.map((e) => (
              <li key={e.id} className="text-sm text-foreground">
                {describeSignInEvent(e, profile.id)} <span className="text-xs text-muted-foreground">· {formatRelative(e.createdAt).toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
