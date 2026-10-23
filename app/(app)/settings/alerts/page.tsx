import Link from "next/link";
import { isSessionOwner, requireActiveProfile } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { alertMailbox } from "@/lib/alerts/email";
import { householdTeamsUrl, pushProblem, recipientEmail, teamsRecipient } from "@/lib/alerts/dispatch";
import { listAlertTargets } from "@/lib/alerts/targets";
import { formatRelative } from "@/lib/format";
import { DisconnectTeamsButton, PersonChannel, PersonPhones, ResetPhoneKeysButton, TeamsLinkForm } from "./controls";
import { ThisDevice } from "./this-device";
import { getVapidState } from "@/lib/alerts/vapid";
import { RewardWord } from "@/components/family-look";
import { microsoftEnabled } from "@/lib/auth";

export const metadata = { title: "Alerts" };

/**
 * Phase 21.5: the family's alert settings (admins only). One Teams link for everyone, then
 * a row per admin where any admin can switch Teams/email on. Quiet like the rest of
 * Settings. The Teams link never comes back to the browser — only its host.
 */
export default async function AlertsPage() {
  const profile = await requireActiveProfile();
  if (!isAdmin(profile)) {
    return <p className="p-4 text-muted-foreground sm:p-6">Only admins can change the family&apos;s alerts.</p>;
  }
  const [link, people, owner] = await Promise.all([
    prisma.householdAlerts.findUnique({
      where: { householdId: profile.householdId },
      select: { teamsWebhookHost: true, updatedAt: true, updatedBy: { select: { firstName: true } } },
    }),
    listAlertTargets(profile.householdId),
    isSessionOwner(profile),
  ]);
  // Null without Microsoft too (Phase 40.1b): alert email goes through its app registration.
  const mailbox = alertMailbox();
  // Only the public key goes to the browser (it's what subscriptions are made with).
  // Phase 45.2: the server's own keys unless `.env` has some; a problem is said in words here.
  const keys = await getVapidState();
  const vapid = keys.ok ? keys.vapid : null;
  // Readable, not just present: a rotated key leaves the host behind but breaks the link.
  const readable = await householdTeamsUrl(profile.householdId).then(
    (url) => Boolean(url),
    () => false,
  );
  const connected = Boolean(link?.teamsWebhookHost) && readable;
  const broken = Boolean(link?.teamsWebhookHost) && !readable;

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
        {broken && (
          <p role="alert" className="text-sm text-destructive">
            The family&apos;s Teams link can&apos;t be read anymore (the server&apos;s encryption key may have changed). Paste it again.
          </p>
        )}
        {connected ? (
          <p className="break-words text-sm text-muted-foreground">
            Connected through a Teams workflow ({link?.teamsWebhookHost})
            {link?.updatedBy ? ` by ${link.updatedBy.firstName}` : ""} · {formatRelative(link!.updatedAt).toLowerCase()}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            One person builds a small Teams workflow once (README, Alerts — about five minutes); after that it messages each
            person below in their own Teams chat. Nobody else has to set anything up.
          </p>
        )}
        {owner ? (
          <>
            <TeamsLinkForm replacing={connected} />
            {connected && <DisconnectTeamsButton />}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Use the app on your own sign-in to change the family&apos;s Teams link.</p>
        )}
      </section>

      <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
        <h2 className="text-base font-semibold">Who gets alerts</h2>
        <p className="text-sm text-muted-foreground">
          {mailbox
            ? `Emails come from ${mailbox}.`
            : microsoftEnabled()
              ? "Email isn't available yet: the alert mailbox needs setting up (README, Alerts)."
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
                    label={teamsTo ? `Teams (${teamsTo})` : microsoftEnabled() ? "Teams (needs one Microsoft sign-in first)" : "Teams (needs Microsoft 365)"}
                    enabled={prefs?.teamsEnabled ?? false}
                    available={connected && Boolean(teamsTo)}
                    status={status(prefs?.lastErrorTeams ?? null, prefs?.lastSentTeams ?? null, "Last handed to Teams")}
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
