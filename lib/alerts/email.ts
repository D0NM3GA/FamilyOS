import { getAppGraphToken } from "@/lib/graph/app-token";
import { microsoftConfigFrom } from "@/lib/microsoft-config";
import { prisma } from "@/lib/prisma";

/**
 * Phase 21: alert email from the app's dedicated mailbox via Graph sendMail with an app-only
 * token. The app can only send as that one mailbox — Exchange RBAC for Applications scopes it
 * (README "Alerts"). Errors are fixed text. Phase 53: the mailbox is set in Settings → Alerts
 * (`Household.alertMailbox`); `ALERT_MAILBOX` in `.env` is the fallback.
 */

// No quotes or shell characters: the address also goes into the Exchange PowerShell the page
// shows (lib/microsoft-admin.ts, the same rule), so one that's saved can always be shown.
const MAILBOX = /^[^@\s'"`$;|&<>()]+@[^@\s'"`$;|&<>()]+\.[^@\s'"`$;|&<>()]+$/;
export const isMailboxAddress = (m: string) => m.length <= 254 && MAILBOX.test(m);

/** The mailbox to send from: the family's setting, else the server's; none without Microsoft. */
export function pickAlertMailbox(saved: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  // Phase 40.1b: mail goes out through the Microsoft app registration; without it, no email.
  if (!microsoftConfigFrom(env)) return null;
  for (const m of [saved?.trim(), env.ALERT_MAILBOX?.trim()]) if (m && isMailboxAddress(m)) return m;
  return null;
}

/** The server's own `ALERT_MAILBOX`, for the page's "leave it empty to use…" line. */
export function serverAlertMailbox(): string | null {
  return pickAlertMailbox(null);
}

export async function alertMailbox(householdId: string): Promise<string | null> {
  const row = await prisma.household.findUnique({ where: { id: householdId }, select: { alertMailbox: true } });
  return pickAlertMailbox(row?.alertMailbox);
}

/**
 * Why Microsoft wouldn't send, from its own error code (Phase 53), so Send a test can say what to
 * fix. "access" is Exchange not letting the app send as the mailbox: the page shows the steps.
 */
export type MailProblem = "signIn" | "noMailbox" | "notReady" | "access" | "failed";

export class MailError extends Error {
  constructor(
    message: string,
    readonly problem: MailProblem,
  ) {
    super(message);
  }
}

export function mailError(status: number, code: string | null, mailbox: string): MailError {
  if (code === "ErrorInvalidUser" || code === "ResourceNotFound" || code === "MailboxNotFound" || (status === 404 && !code)) {
    return new MailError(`Microsoft can't find a mailbox called ${mailbox}. Check the address under Email.`, "noMailbox");
  }
  if (code === "MailboxNotEnabledForRESTAPI" || code === "MailboxNotEnabledForRESTAPI.") {
    return new MailError(`${mailbox} isn't ready for mail yet. A new shared mailbox can take a few minutes: try again soon.`, "notReady");
  }
  if (status === 401) return new MailError("Microsoft didn't accept the app's sign-in to send email.", "signIn");
  if (code === "ErrorAccessDenied" || status === 403) {
    return new MailError("Exchange hasn't let the app send from its mailbox yet. The steps are under Email on the Alerts page.", "access");
  }
  return new MailError(`Microsoft couldn't send the email (${status}).`, "failed");
}

/** Graph's `{ error: { code } }`, or null. Never more than the code: the message can carry details. */
async function graphCode(res: Response): Promise<string | null> {
  try {
    const code = ((await res.json()) as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === "string" && /^[A-Za-z.]{1,80}$/.test(code) ? code : null;
  } catch {
    return null;
  }
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
  from: string,
  to: string,
  title: string,
  link: string,
  appName: string,
  deps: { fetchFn?: typeof fetch; token?: () => Promise<string> } = {},
  linkText?: string,
): Promise<void> {
  const mailbox = from;
  let token: string;
  try {
    token = await (deps.token ?? (() => getAppGraphToken({ fetchFn: deps.fetchFn })))();
  } catch {
    throw new MailError("Couldn't sign in to Microsoft to send email.", "signIn");
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
    throw new MailError("Couldn't reach Microsoft to send email.", "failed");
  }
  if (!res.ok) throw mailError(res.status, await graphCode(res), mailbox);
}
