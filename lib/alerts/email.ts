import { getAppGraphToken } from "@/lib/graph/app-token";
import { microsoftConfigFrom } from "@/lib/microsoft-config";

/**
 * Phase 21: alert email from the app's dedicated mailbox (ALERT_MAILBOX) via Graph
 * sendMail with an app-only token. The app can only send as that one mailbox — Exchange
 * RBAC for Applications scopes it (README "Alerts"). Errors are fixed text.
 */

export function alertMailbox(): string | null {
  // Phase 40.1b: mail goes out through the Microsoft app registration; without it, no email.
  if (!microsoftConfigFrom(process.env)) return null;
  const m = process.env.ALERT_MAILBOX?.trim();
  return m && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) ? m : null;
}

/**
 * `appName` is the family's name for the app, so the mail says who it's from. `linkText` says
 * what the link opens (a card's, like Teams'); store orders, the first emails, keep their words.
 */
export function emailPayload(to: string, title: string, link: string, appName: string, linkText = "Open the store to make it happen") {
  return {
    message: {
      subject: `${appName}: ${title}`,
      body: {
        contentType: "Text",
        content: `${title}\n\n${linkText}: ${link}\n\n— ${appName}`,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: false,
  };
}

export async function sendEmail(
  to: string,
  title: string,
  link: string,
  appName: string,
  deps: { fetchFn?: typeof fetch; token?: () => Promise<string> } = {},
  linkText?: string,
): Promise<void> {
  const mailbox = alertMailbox();
  if (!mailbox) throw new Error("The alert mailbox isn't set up yet.");
  let token: string;
  try {
    token = await (deps.token ?? (() => getAppGraphToken({ fetchFn: deps.fetchFn })))();
  } catch {
    throw new Error("Couldn't sign in to Microsoft to send email.");
  }
  let res: Response;
  try {
    res = await (deps.fetchFn ?? fetch)(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload(to, title, link, appName, linkText)),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Couldn't reach Microsoft to send email.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("Microsoft won't let this app send from its mailbox yet. Check the mailbox permission setup.");
  }
  if (!res.ok) throw new Error(`Microsoft couldn't send the email (${res.status}).`);
}
