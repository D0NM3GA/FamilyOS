import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { captureError } from "@/lib/observability";
import { getAppName } from "@/lib/household-settings";
import { alertMailbox, sendEmail } from "./email";
import { householdTeamsAad, sendTeams, type TeamsCard } from "./teams";
import { sendPush, type PushOutcome, type PushTarget, type Vapid } from "./webpush";
import { getVapidState, type VapidState } from "./vapid";

/**
 * Phase 21: delivers bell notifications to each recipient's chosen channels (Teams, email).
 * Called from a server action's after(), only once the order has committed, so the rows
 * are there. Never throws: an alert that can't be delivered is recorded on the person's
 * AlertPrefs as fixed text (shown on /settings/alerts) and reported without secrets.
 *
 * Phase 21.5: Teams goes through the family's one link, naming each recipient by their
 * Microsoft sign-in address.
 *
 * Phase 27: deliverNotifications serves any bell notifications. "prefs" follows each
 * person's Alerts switches (store orders); "teams-first" (money alerts) goes to Teams
 * whenever the family link is set, plus phones, because the per-jar switches are the opt-in.
 * Either way the last outcome lands on the person's AlertPrefs.
 */

export type Channel = "teams" | "email" | "push";

export type PushPayload = { title: string; body: string; path: string };

export type Senders = {
  teams: (url: string, recipient: string, title: string, link: string, card?: TeamsCard) => Promise<void>;
  email: (to: string, title: string, link: string, appName: string, linkText?: string) => Promise<void>;
  push: (sub: PushTarget, payload: PushPayload, vapid: Vapid) => Promise<PushOutcome>;
};

const defaultSenders: Senders = {
  teams: (u, r, t, l, card) => sendTeams(u, r, t, l, fetch, card),
  email: (to, t, l, appName, linkText) => sendEmail(to, t, l, appName, {}, linkText),
  push: (sub, payload, vapid) => sendPush(sub, payload, { vapid }),
};

/**
 * Why phone alerts can't go out on this install (Phase 45.2: the server makes its own keys, so
 * what's left is a contact address, broken keys in `.env`, or stored keys it can't read).
 */
export function pushProblem(state: Extract<VapidState, { ok: false }>): string {
  switch (state.reason) {
    case "noSubject":
      return "Phone alerts need a contact address for this install: set CONTACT_EMAIL, or serve the app over https. See README, Alerts.";
    case "badSubject":
      return "VAPID_SUBJECT in .env isn't a mailto: address or an https:// address. Fix it, or remove it to use CONTACT_EMAIL. See README, Alerts.";
    case "badEnv":
      return "The phone-alert keys in .env don't match each other. Fix or remove VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. See README, Alerts.";
    case "unreadable":
      return "The phone-alert keys can't be read since INTEGRATION_ENCRYPTION_KEY changed. An admin can make new ones in Settings → Alerts.";
  }
}

export function storeLink(path = "/points#orders"): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** A setup problem (shown on the Alerts page, not reported to Sentry). */
export class ConfigError extends Error {}

type Recipient = {
  id: string;
  firstName: string;
  email: string | null;
  /** `accounts`: their Microsoft sign-in, if any (Teams can only reach those). */
  authUser: { email: string | null; accounts: { id: string }[] } | null;
  pushSubscriptions?: { id: string; endpoint: string; p256dh: string; auth: string; failureCount: number }[];
};

/** Email: the signed-in identity's address first (it's verified), then the profile's. */
export function recipientEmail(r: Pick<Recipient, "email" | "authUser">): string | null {
  return r.authUser?.email || r.email || null;
}

/**
 * Teams: only the Microsoft sign-in address. The Flow bot can only reach accounts in the
 * family's tenant, and a profile email might be a personal one that silently goes nowhere.
 * Phase 40.2c: a passkey sign-in's email is anyone's address, so it needs the Microsoft account.
 */
export function teamsRecipient(r: Pick<Recipient, "authUser">): string | null {
  return r.authUser && r.authUser.accounts.length > 0 ? r.authUser.email || null : null;
}

/** For any query that feeds teamsRecipient: the person's Microsoft account, if they have one. */
export const MICROSOFT_ACCOUNTS = { where: { providerId: "microsoft" }, select: { id: true } } as const;

/** The family's Teams link, decrypted; null when it isn't set up. Throws ConfigError if unreadable. */
export async function householdTeamsUrl(householdId: string): Promise<string | null> {
  const row = await prisma.householdAlerts.findUnique({ where: { householdId } });
  if (!row?.teamsWebhookEnc || !row.teamsWebhookIv || !row.teamsWebhookTag) return null;
  try {
    return decryptSecret(
      { encryptedValue: Buffer.from(row.teamsWebhookEnc), iv: Buffer.from(row.teamsWebhookIv), authTag: Buffer.from(row.teamsWebhookTag) },
      householdTeamsAad(householdId),
    );
  } catch {
    // Key rotated or row damaged: Node's own message means nothing to an admin.
    throw new ConfigError("The family's Teams link can't be read anymore. Paste it again.");
  }
}

async function record(personId: string, channel: Channel, error: string | null) {
  const now = new Date();
  const data =
    channel === "teams"
      ? error
        ? { lastErrorTeams: error }
        : { lastErrorTeams: null, lastSentTeams: now }
      : channel === "email"
        ? error
          ? { lastErrorEmail: error }
          : { lastErrorEmail: null, lastSentEmail: now }
        : error
          ? { lastErrorPush: error }
          : { lastErrorPush: null, lastSentPush: now };
  await prisma.alertPrefs.upsert({ where: { personId }, create: { personId, ...data }, update: data }).catch(() => {});
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * Push to every device a person has. Succeeds if any device took it. Housekeeping per
 * device: gone (404/410, or keys that can never work) is deleted; other 4xx counts toward
 * deleting at 5; transient failures (429, 5xx, network) don't count. Errors are fixed text.
 */
async function pushToDevices(r: Recipient, payload: PushPayload, senders: Senders): Promise<void> {
  const subs = r.pushSubscriptions ?? [];
  if (subs.length === 0) throw new ConfigError(`No phones are set up for ${r.firstName} yet.`);
  const keys = await getVapidState();
  if (!keys.ok) throw new ConfigError(pushProblem(keys));
  const vapid = keys.vapid;
  const outcomes = await Promise.all(
    subs.map(async (s): Promise<PushOutcome> => {
      const outcome = await senders.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, vapid).catch(() => "transient" as const);
      if (outcome === "ok") {
        await prisma.pushSubscription.updateMany({ where: { id: s.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } });
      } else if (outcome === "gone" || (outcome === "rejected" && s.failureCount + 1 >= 5)) {
        await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
      } else if (outcome === "rejected") {
        await prisma.pushSubscription.updateMany({ where: { id: s.id }, data: { failureCount: { increment: 1 } } });
      }
      return outcome;
    }),
  );
  if (outcomes.includes("ok")) return;
  if (outcomes.includes("badVapid")) throw new Error("The phone service rejected this server's keys. They may have changed; turn phone alerts on again on each phone.");
  if (outcomes.every((o) => o === "gone")) throw new ConfigError(`${r.firstName}'s phone isn't subscribed anymore. Turn phone alerts on again on that phone.`);
  throw new Error("Couldn't reach the phone right now. It'll try again with the next order.");
}

/**
 * Sends one message to one person on the given channels; returns per-channel outcomes.
 * `appName` is the family's name for the app: a phone alert's title, an email's subject.
 */
async function sendToPerson(
  r: Recipient,
  channels: Channel[],
  teamsUrl: string | null,
  title: string,
  path: string,
  appName: string,
  senders: Senders,
  card?: TeamsCard,
): Promise<Partial<Record<Channel, string | null>>> {
  const link = storeLink(path);
  const out: Partial<Record<Channel, string | null>> = {};
  await Promise.allSettled(
    channels.map(async (channel) => {
      let error: string | null = null;
      try {
        if (channel === "teams") {
          if (!teamsUrl) throw new ConfigError("Teams isn't set up for the family yet.");
          const to = teamsRecipient(r);
          if (!to) throw new ConfigError(`${r.firstName} needs to sign in here with Microsoft once before Teams can reach them.`);
          await (card ? senders.teams(teamsUrl, to, title, link, card) : senders.teams(teamsUrl, to, title, link));
        } else if (channel === "email") {
          const to = recipientEmail(r);
          if (!to) throw new ConfigError(`There's no email address for ${r.firstName}.`);
          await senders.email(to, title, link, appName, card?.linkText);
        } else {
          await pushToDevices(r, { title: appName, body: title, path }, senders);
        }
      } catch (err) {
        // Every sender throws fixed text only (never a URL, token or secret).
        error = message(err);
        if (!(err instanceof ConfigError)) captureError(new Error(`Alert delivery failed (${channel}): ${error}`));
      }
      out[channel] = error;
      await record(r.id, channel, error);
    }),
  );
  return out;
}

const recipientSelect = {
  id: true,
  firstName: true,
  email: true,
  authUser: { select: { email: true, accounts: MICROSOFT_ACCOUNTS } },
  entraAccessEndedAt: true,
  alertPrefs: { select: { teamsEnabled: true, emailEnabled: true } },
  pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true } },
} as const;

/** Delivers every placement ping created for one Sticker Store order. */
export async function deliverOrderAlerts(orderId: string, senders: Senders = defaultSenders): Promise<void> {
  // Only the placement pings — a later phase may add order-status notifications.
  await deliverNotifications({ orderId, kind: { in: ["ORDER_PLACED", "ORDER_NEEDS_OK"] } }, { channels: "prefs" }, senders);
}

/**
 * "push-only" (Phase 30): the bell and phones, but no Teams, for alerts a jar posts once to
 * its shared Teams chat instead.
 */
export type DeliverOptions = {
  channels: "prefs" | "teams-first" | "push-only";
  card?: TeamsCard;
  /**
   * Phase 40.2c: email too, whatever the person's store-alert email switch, when the install
   * can send email at all: notices about someone's own sign-in (a reset leaves them signed out
   * everywhere, so the bell can wait a long time).
   */
  alsoEmail?: boolean;
  /** Phase 40.4: deliver to someone Entra has cut off too (only their own sign-in notice). */
  includeEnded?: boolean;
};

/** Delivers the matching bell notifications (all from one household) on each recipient's channels. */
export async function deliverNotifications(where: Prisma.NotificationWhereInput, opts: DeliverOptions, senders: Senders = defaultSenders): Promise<void> {
  try {
    const notes = await prisma.notification.findMany({
      where,
      select: { householdId: true, title: true, href: true, recipient: { select: recipientSelect } },
    });
    if (notes.length === 0) return;

    // One household per call: load and decrypt the family link once. No link is a chosen
    // state, so Teams is quietly skipped. An unreadable link is a fault, so it's stamped on
    // every Teams recipient (shown on the Alerts page) instead of failing silently.
    let teamsUrl: string | null = null;
    let teamsFault: string | null = null;
    const keys = await getVapidState();
    try {
      teamsUrl = await householdTeamsUrl(notes[0].householdId);
    } catch (err) {
      teamsFault = message(err);
    }
    const appName = await getAppName(notes[0].householdId);

    await Promise.allSettled(
      notes.map(async (n) => {
        // Phase 40.4: nothing leaves the app for someone Entra cut off (the bell keeps it).
        if (n.recipient.entraAccessEndedAt && !opts.includeEnded) return Promise.resolve();
        const p = n.recipient.alertPrefs;
        const wantsTeams = opts.channels === "teams-first" || (opts.channels === "prefs" && Boolean(p?.teamsEnabled));
        if (wantsTeams && teamsFault) await record(n.recipient.id, "teams", teamsFault);
        // Push has no switch: registered devices are the opt-in. Keys missing while devices
        // exist is a fault (they were set up once), so it's recorded, not skipped.
        const hasPhones = n.recipient.pushSubscriptions.length > 0;
        if (hasPhones && !keys.ok) await record(n.recipient.id, "push", pushProblem(keys));
        const channels: Channel[] = [];
        if (wantsTeams && teamsUrl) channels.push("teams");
        if ((opts.channels === "prefs" && p?.emailEnabled) || (opts.alsoEmail && alertMailbox() !== null)) channels.push("email");
        if (hasPhones && keys.ok) channels.push("push");
        if (channels.length === 0) return Promise.resolve();
        return sendToPerson(n.recipient, channels, teamsUrl, n.title, n.href, appName, senders, opts.card);
      }),
    );
  } catch {
    captureError(new Error("Alert delivery failed to load its notifications."));
  }
}

/** "Send a test" on /settings/alerts: one channel, one person, a fixed message. */
export async function sendTest(householdId: string, personId: string, channel: Channel, senders: Senders = defaultSenders) {
  const r = await prisma.person.findFirstOrThrow({ where: { id: personId, householdId }, select: recipientSelect });
  let teamsUrl: string | null = null;
  if (channel === "teams") {
    try {
      teamsUrl = await householdTeamsUrl(householdId);
    } catch (err) {
      const error = message(err);
      await record(r.id, "teams", error);
      return error;
    }
  }
  const appName = await getAppName(householdId);
  const out = await sendToPerson(r, [channel], teamsUrl, `Test from ${appName} — alerts are working! 🎉`, "/points#orders", appName, senders);
  return out[channel] ?? null;
}
