import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { pickAlertMailbox, serverAlertMailbox } from "@/lib/alerts/email";
import { mailboxPowerShell } from "@/lib/microsoft-admin";
import { pushProblem, recipientEmail, teamsRecipient } from "@/lib/alerts/dispatch";
import { familyTeamsApp, teamsBotAppId } from "@/lib/teams/family-app";
import { listAlertTargets } from "@/lib/alerts/targets";
import { formatRelative } from "@/lib/format";
import { CopyCommands, DisconnectTeamsButton, MailboxForm, PersonChannel, PersonPhones, ResetPhoneKeysButton, TeamsAppButtons } from "./controls";
import { ThisDevice } from "./this-device";
import { getVapidState } from "@/lib/alerts/vapid";
import { RewardWord } from "@/components/family-look";
import { microsoftEnabled } from "@/lib/auth";

export const metadata = { title: "Alerts" };

/**
 * Phase 21.5: the family's alert settings (admins only). Teams set up once for everyone, then
 * a row per admin where any admin can switch Teams/email on. Quiet like the rest of
 * Settings. Phase 50: Teams is the family's own Teams app, published from here.
 */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ grant?: string }> }) {
  const { grant } = await searchParams;
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) {
    return <p className="p-4 text-muted-foreground sm:p-6">Only admins can change the family&apos;s alerts.</p>;
  }
  const [link, people, owner, household, entra] = await Promise.all([
    prisma.householdAlerts.findUnique({
      where: { householdId: profile.householdId },
      select: { updatedBy: { select: { firstName: true } } },
    }),
    listAlertTargets(profile.householdId),
    isSessionOwner(profile),
    prisma.household.findUniqueOrThrow({ where: { id: profile.householdId }, select: { alertMailbox: true } }),
    prisma.entraCheck.findUnique({ where: { householdId: profile.householdId }, select: { servicePrincipalId: true } }),
  ]);
  // Null without Microsoft too (Phase 40.1b): alert email goes through its app registration.
  const mailbox = pickAlertMailbox(household.alertMailbox);
  const fallback = serverAlertMailbox();
  // Phase 53: the Exchange steps, filled in once the Entra check has seen the app's object id.
  const commands = mailbox ? mailboxPowerShell(process.env.MICROSOFT_CLIENT_ID?.trim(), entra?.servicePrincipalId, mailbox) : null;
  // Only the public key goes to the browser (it's what subscriptions are made with).
  // Phase 45.2: the server's own keys unless `.env` has some; a problem is said in words here.
  const keys = await getVapidState();
  const vapid = keys.ok ? keys.vapid : null;
  const teamsApp = teamsBotAppId() ? await familyTeamsApp(profile.householdId) : null;
  const connected = Boolean(teamsApp?.teamsAppId);

  return (
    <div className="max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/settings" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          When a kid buys something in the <RewardWord form="store" />, every admin gets the bell. Set up Teams once for the whole family,
          then choose below who also hears about it in Teams, by email, or on their phone.
        </p>
      </div>

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">This phone</h2>
        {/* Keyed on the viewer's devices so a Remove below re-checks this phone. */}
        <ThisDevice
          key={people.find((x) => x.id === profile.id)?.pushSubscriptions.map((d) => d.id).join(",") ?? ""}
          vapidPublicKey={vapid?.publicKey ?? null}
        />
        {!keys.ok && (
          <>
            <p role="alert" className="text-sm text-destructive">
              {pushProblem(keys)}
            </p>
            {keys.reason === "unreadable" && <ResetPhoneKeysButton />}
          </>
        )}
      </section>

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">Teams for the family</h2>
        {!teamsApp ? (
          <p className="text-sm text-muted-foreground">Teams alerts need Microsoft 365 sign-in set up on this install (README, Microsoft).</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The family&apos;s own Teams app messages each person below in their own Teams chat with it, and a money jar&apos;s group chat
              if the jar picks one. It only sends; it can&apos;t read anyone&apos;s chats. Set up once by an admin who is also a Teams
              administrator (README, Teams: an Azure Bot, three permissions, then the button here).
            </p>
            {connected && (
              <p className="text-sm text-muted-foreground">
                ✅ In Teams{link?.updatedBy ? `, added by ${link.updatedBy.firstName}` : ""}
                {teamsApp.publishedAt ? ` · ${formatRelative(teamsApp.publishedAt).toLowerCase()}` : ""}.
                {teamsApp.outOfDate && " The family's name or icon changed since: update it so Teams shows the new one."}
              </p>
            )}
            {grant === "teams" && <p className="text-sm font-semibold">Thanks, Microsoft gave the permission. Now add the app to Teams.</p>}
            {grant === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                Microsoft didn&apos;t give the permission. It needs a Teams or Global administrator.
              </p>
            )}
            {owner ? (
              (!connected || teamsApp.outOfDate) && (
                <TeamsAppButtons label={connected ? "Update in Teams" : "Add to Teams"} askFirst={!connected && grant !== "teams"} />
              )
            ) : (
              <p className="text-sm text-muted-foreground">Use the app on your own sign-in to change Teams for the family.</p>
            )}
            {owner && connected && <DisconnectTeamsButton />}
          </>
        )}
      </section>

      {microsoftEnabled() && (
        <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
          <h2 className="text-base font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">
            Alert email comes from a shared mailbox in your Microsoft 365, which Exchange lets the app send from and nothing else.
            {fallback ? ` Leave it empty to use the server's setting (${fallback}).` : ""}
          </p>
          {owner ? (
            <MailboxForm saved={household.alertMailbox} fallback={fallback} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {mailbox ? `Emails come from ${mailbox}. ` : ""}Use the app on your own sign-in to change the mailbox.
            </p>
          )}
          {mailbox && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-foreground">Let the app send from {mailbox}</summary>
              <div className="mt-2 space-y-2 text-muted-foreground">
                <p>
                  Once, by a Microsoft 365 admin: in Exchange Online PowerShell, run these. The last line should show Application
                  Mail.Send as InScope: True. Exchange can take up to two hours to apply them; then Send a test below.
                </p>
                {commands ? (
                  <CopyCommands text={commands} />
                ) : (
                  <p>The commands appear here once the app has checked Entra (Settings → Sign-in → Check now). README, Alerts, has them too.</p>
                )}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">Who gets alerts</h2>
        <p className="text-sm text-muted-foreground">
          {mailbox
            ? `Emails come from ${mailbox}.`
            : microsoftEnabled()
              ? "Email isn't available yet: set the alert mailbox under Email above."
              : "Email alerts need Microsoft 365, which isn't set up on this install."}
        </p>
        <ul className="divide-y divide-border">
          {people.map((p) => {
            const prefs = p.alertPrefs;
            const teamsTo = teamsRecipient(p);
            const emailTo = recipientEmail(p);
            return (
              <li key={p.id} className="space-y-3 py-3">
                <p className="font-medium text-foreground">
                  {p.firstName}
                  {p.id === profile.id && <span className="text-muted-foreground"> (you)</span>}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <PersonChannel
                    personId={p.id}
                    channel="teams"
                    label={teamsTo ? `Teams (${p.authUser?.email ?? "Microsoft sign-in"})` : microsoftEnabled() ? "Teams (needs one Microsoft sign-in first)" : "Teams (needs Microsoft 365)"}
                    enabled={prefs?.teamsEnabled ?? false}
                    available={connected && Boolean(teamsTo)}
                    status={status(prefs?.lastErrorTeams ?? null, prefs?.lastSentTeams ?? null, "Last sent to Teams")}
                  />
                  <PersonChannel
                    personId={p.id}
                    channel="email"
                    label={emailTo ? `Email (${emailTo})` : "Email (no address yet)"}
                    enabled={prefs?.emailEnabled ?? false}
                    available={Boolean(mailbox && emailTo)}
                    status={status(prefs?.lastErrorEmail ?? null, prefs?.lastSentEmail ?? null, "Last emailed")}
                  />
                  <PersonPhones
                    personId={p.id}
                    devices={p.pushSubscriptions.map((d) => ({
                      id: d.id,
                      added: formatRelative(d.createdAt).toLowerCase(),
                    }))}
                    canTest={Boolean(vapid)}
                    status={status(prefs?.lastErrorPush ?? null, prefs?.lastSentPush ?? null, "Last sent to a phone")}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Store alerts go to admins (people with the Admin role in Entra). Kids are the shoppers, so they don&apos;t get these.
        </p>
      </section>
    </div>
  );
}

function status(error: string | null, sent: Date | null, sentLabel: string): string | null {
  if (error) return `Last try didn't work: ${error}`;
  if (sent) return `${sentLabel} ${formatRelative(sent).toLowerCase()}.`;
  return null;
}
