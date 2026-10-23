import Link from "next/link";
import { backupSignInState, isSessionOwner } from "@/lib/active-profile";
import { requireAppOn } from "@/lib/app-guard";
import { isAdmin } from "@/lib/authz";
import { backupHistory } from "@/lib/backup/audit";
import { SignInAgain } from "@/components/sign-in-again";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getDisabledApps } from "@/lib/app-switches";
import { isAppOn, isLinkOn } from "@/lib/apps";
import { exportCatalog } from "./catalog";
import { RestoreForm } from "./restore-form";

/**
 * Data & backups (Phase 16): every CSV export, plus the whole-household backup for admins.
 * A cross-domain page like /search (it lists every domain's exports), so it lives outside
 * the domain zones. Downloads are plain <a> links to route handlers; their
 * Content-Disposition: attachment makes the browser save the file (no `download` attribute,
 * which would also save a sign-in redirect as the "file"). Each handler re-checks who's
 * asking (lib/export.ts).
 *
 * Phase 28 (AAA): the household backup is a POST by the admin themselves, signed in within
 * 15 minutes, and every backup and restore is in the history below and announced. Money
 * jars ride in it sealed; each person's own readable money copy is on /finances (this page
 * may not read money).
 */
const KIND_LABEL = { HOUSEHOLD_BACKUP: "Household backup", MONEY_BACKUP: "Own money jars", HOUSEHOLD_RESTORE: "Restore" } as const;

export default async function DataPage({ searchParams }: { searchParams: Promise<{ stepup?: string }> }) {
  const profile = await requireAppOn("data");
  const stepup = (await searchParams).stepup;

  // Phase 36: a turned-off app's spreadsheets aren't offered (its route says 404); the
  // household backup below still has everything.
  const disabled = await getDisabledApps(profile.householdId);
  const groups = exportCatalog().filter((g) => isLinkOn(disabled, `/${g.domain}`));
  const moneyOn = isAppOn(disabled, "money");
  // Restore is only for an admin on their own sign-in (Microsoft or a passkey), not a profile
  // switched to with a PIN, so it can never delete its own runner (the route re-checks).
  const canRestore = isAdmin(profile) && profile.authUserId != null && (await isSessionOwner(profile));
  const signIn = isAdmin(profile) ? await backupSignInState(profile) : null;
  const history = await backupHistory(profile);
  const timeZone = (await getHouseholdSettings(profile.householdId)).timezone ?? undefined;
  const again = signIn && <SignInAgain callbackURL="/data" loginHint={signIn.email} dev={signIn.dev} microsoft={signIn.microsoft} passkey={signIn.passkey} oidc={signIn.oidc} />;

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-foreground">Data &amp; backups</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Download what lives only in this app — to keep a copy, open it in Excel, or share it. Things that already live in
        Microsoft 365 (photos, calendar, mail) and anything security-related (PINs, sign-in links) are never included.
      </p>
      {/* Spreadsheets first: they're what people come here for most; backups are further down. */}
      <h2 className="mt-6 text-sm font-semibold text-foreground">Spreadsheets</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {moneyOn && "Money's spreadsheets are on each jar's page. "}Backups and restores are{" "}
        <a href="#backups" className="underline">
          further down
        </a>
        .
      </p>
      <div className="mt-3 grid max-w-4xl gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.domain} id={group.domain} className="scroll-mt-6 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
            <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
            <ul className="mt-2 space-y-2">
              {group.files.map((file) => (
                <li key={file.name}>
                  <a href={file.href} className="inline-flex min-h-11 items-center text-sm font-medium text-brand-text hover:underline sm:min-h-0">
                    {file.entry.label} (.csv)
                  </a>
                  <p className="text-xs text-muted-foreground">{file.entry.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>


      {isAdmin(profile) && (
        <section id="backups" className="mt-8 max-w-2xl scroll-mt-6 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-sm font-semibold text-foreground">Whole-household backup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One file with everything below, in a format this app can restore from. It contains
            meds, contacts, notes and your home location, so store it somewhere private — not a shared folder.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone&apos;s money jars are in it too, <strong>sealed</strong>: you can&apos;t open them, only this server can (with its{" "}
            <code>INTEGRATION_ENCRYPTION_KEY</code>, so keep that key safe alongside your backups). The other admins and everyone in a
            money jar are told when a backup is made.
          </p>
          {stepup === "blocked" && (
            <p role="alert" className="mt-2 text-sm font-medium text-destructive">
              Your browser didn&apos;t confirm this came from here, so no backup was made. Update the browser or try another one.
            </p>
          )}
          {stepup === "own" && (
            <p role="alert" className="mt-2 text-sm font-medium text-destructive">
              Backups are made by the person themselves: switch back to your own profile.
            </p>
          )}
          {!signIn?.own ? (
            <p className="mt-3 text-xs text-muted-foreground">Switch to your own profile (on your own sign-in) to make a backup.</p>
          ) : !signIn.fresh ? (
            <div className="mt-3 space-y-2">
              <p role={stepup === "fresh" ? "alert" : undefined} className={`text-sm ${stepup === "fresh" ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                Backups need a sign-in from the last 15 minutes. Sign in again, then download.
              </p>
              {again}
            </div>
          ) : (
            <form method="post" action="/api/backup/download" className="mt-3">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:scale-105 hover:-translate-y-0.5 hover:bg-brand-hover active:scale-95 sm:min-h-9"
              >
                Download backup (.json)
              </button>
            </form>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            This is different from <code>npm run db:backup</code>, which copies the entire database (including sign-in and
            security data) for disaster recovery on this machine. This file is readable, portable, and household-only.
          </p>

          <h3 className="mt-5 text-sm font-semibold text-foreground">Restore from a backup</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Replaces this household&apos;s data with a backup&apos;s. People with their own sign-in keep
            it. Ask everyone to stop using the app for a minute first. Money jars stay as they are unless you choose to put
            the file&apos;s jars back (you never see inside them, and bank feeds need reconnecting); left as they are, their links to
            grocery trips are cleared (automatic ones come back on the next sync).
          </p>
          {canRestore && signIn?.fresh ? (
            <RestoreForm />
          ) : canRestore ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">A restore needs a sign-in from the last 15 minutes.</p>
              {again}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Only an admin on their own sign-in — not a profile switched to with a PIN — can restore.
            </p>
          )}
        </section>
      )}

      <section id="history" className="mt-6 max-w-2xl scroll-mt-6 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-sm font-semibold text-foreground">Backup history</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isAdmin(profile) ? "Household backups and restores, and backups of your own money jars." : "Backups you made or that include your money jars."}
          {moneyOn && (
            <>
              {" "}
              Your own money jars: download your copy on{" "}
              <Link href="/finances" className="underline">
                Money
              </Link>
              .
            </>
          )}
        </p>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {history.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span className="font-medium text-foreground">{KIND_LABEL[e.kind]}</span>
                <span className="text-muted-foreground">
                  by {e.actor?.firstName ?? "someone no longer here"} ·{" "}
                  {e.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })}
                  {e.includesMoney &&
                    (e.kind === "MONEY_BACKUP"
                      ? // How many jars someone has is theirs to know (lib/finance/access.ts).
                        e.actorId === profile.id
                        ? ` · ${e.jarCount} money jar${e.jarCount === 1 ? "" : "s"}`
                        : " · a money jar you share"
                      : // How many jars the household has isn't everyone's to know either.
                        " · money jars (sealed)")}
                  {e.moneyRestored && " · money jars put back"}
                  {" · "}
                  {Math.max(1, Math.round(e.bytes / 1024))} KB
                </span>
                <code className="text-xs text-muted-foreground" title={e.fileSha256}>
                  {e.fileSha256.slice(0, 12)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
