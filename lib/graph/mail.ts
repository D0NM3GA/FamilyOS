import { graphFetchJson, GraphAuthError } from "./client";

export type MailMessage = {
  id: string;
  subject: string;
  /** The other party in the exchange — sender's name if received, recipient's if sent. */
  counterpart: string;
  direction: "sent" | "received";
  receivedAt: Date;
  preview: string;
  isRead: boolean;
  webLink: string;
};

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };

type GraphMessage = {
  id: string;
  subject: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime: string;
  bodyPreview: string;
  isRead: boolean;
  webLink: string;
};

export type RecentMailResult =
  | { ok: true; messages: MailMessage[] }
  | { ok: false; error: string };

const SELECT_FIELDS =
  "subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,webLink";

function findRecipient(
  recipients: GraphRecipient[] | undefined,
  email: string,
): GraphRecipient | undefined {
  return recipients?.find((r) => r.emailAddress?.address?.toLowerCase() === email);
}

function mapReceived(m: GraphMessage): MailMessage {
  return {
    id: m.id,
    subject: m.subject || "(No subject)",
    counterpart: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unknown",
    direction: "received",
    receivedAt: new Date(m.receivedDateTime),
    preview: m.bodyPreview,
    isRead: m.isRead,
    webLink: m.webLink,
  };
}

function mapSent(m: GraphMessage, email: string): MailMessage {
  const match = findRecipient(m.toRecipients, email) ?? findRecipient(m.ccRecipients, email);
  return {
    id: m.id,
    subject: m.subject || "(No subject)",
    counterpart: match?.emailAddress?.name || match?.emailAddress?.address || "Unknown",
    direction: "sent",
    receivedAt: new Date(m.receivedDateTime),
    preview: m.bodyPreview,
    isRead: m.isRead,
    webLink: m.webLink,
  };
}

/**
 * Recent messages that are DIRECT correspondence with this email address — sent BY them,
 * or sent TO them (to/cc) by the mailbox owner.
 *
 * Deliberately narrower than a plain text search: Graph's mail $search for an address also
 * matches anything merely MENTIONING it — e.g. a third party emailing both the mailbox
 * owner and this contact on an unrelated thread. Verified against live data: a $search for
 * a real contact's address returned 10 results that were 100% third-party marketing/
 * security mail and 0% genuine correspondence. `$filter=from/emailAddress/address eq ...`
 * gives precise, server-side-filtered results for the received side (confirmed against the
 * same mailbox: 10/10 genuine family correspondence). Graph's mail $filter doesn't support
 * `any()` lambda filtering on recipient collections for the sent side (confirmed —
 * `toRecipients/any(...)` returns `ErrorInvalidUrlQueryFilter`), so that side fetches a
 * bounded recent batch from Sent Items and filters client-side instead.
 */
export async function searchRecentMail(email: string, limit = 5): Promise<RecentMailResult> {
  const normalizedEmail = email.toLowerCase();
  // OData string literals escape a single quote by doubling it. Emails may legally
  // contain apostrophes (RFC 5321), and the Entra-sync path sets this field without
  // going through the form's validation — so escape at the point of use rather than
  // trusting the input to be quote-free.
  const odataEmail = normalizedEmail.replaceAll("'", "''");

  try {
    const receivedParams = new URLSearchParams({
      $filter: `from/emailAddress/address eq '${odataEmail}'`,
      $select: SELECT_FIELDS,
      $top: String(limit),
    });

    // No $filter here (Sent Items has no useful `from` to filter on — it's always the
    // mailbox owner), so no $orderby/$filter property-ordering conflict either.
    const sentParams = new URLSearchParams({
      $select: SELECT_FIELDS,
      $top: "50",
      $orderby: "receivedDateTime desc",
    });

    const [receivedData, sentBatch] = await Promise.all([
      graphFetchJson<{ value: GraphMessage[] }>(`/me/messages?${receivedParams}`),
      graphFetchJson<{ value: GraphMessage[] }>(
        `/me/mailFolders('sentitems')/messages?${sentParams}`,
      ).catch(() => ({ value: [] as GraphMessage[] })), // don't lose the whole card over one half
    ]);

    const sentMatches = sentBatch.value.filter(
      (m) => findRecipient(m.toRecipients, normalizedEmail) || findRecipient(m.ccRecipients, normalizedEmail),
    );

    const messages: MailMessage[] = [
      ...receivedData.value.map(mapReceived),
      ...sentMatches.map((m) => mapSent(m, normalizedEmail)),
    ]
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, limit);

    return { ok: true, messages };
  } catch (err) {
    if (err instanceof GraphAuthError) return { ok: false, error: err.message };
    return { ok: false, error: "Couldn't load recent emails right now." };
  }
}
