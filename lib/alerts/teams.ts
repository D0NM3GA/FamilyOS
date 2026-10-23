/**
 * Phase 21: Teams alerts through a Teams **Workflows** webhook ("Post to a chat when a
 * webhook request is received"). Office 365 connectors were retired on 2026-04-30;
 * Workflows is Microsoft's supported replacement and posts as the Flow bot.
 *
 * Phase 21.5: one family link. Each request also names a `recipient` (their Microsoft
 * sign-in address); the family's flow posts the card as the Flow bot to that person's own
 * Teams chat (README "Alerts"). A 202 means Teams accepted it, not that the chat got it —
 * failures after that show in the flow's run history.
 *
 * The trigger URL is a bearer secret (its `sig` query parameter), so:
 * - it's validated against the known Workflows hosts before it's saved or used (no
 *   arbitrary POST target, so no SSRF);
 * - it's stored encrypted (householdTeamsAad) and only ever read back on the server;
 * - errors here are fixed text and never include the URL.
 */

export const householdTeamsAad = (householdId: string) => `alerts:teams:household:${householdId}`;

const HOST_SUFFIXES = [".logic.azure.com", ".environment.api.powerplatform.com"];

export type TeamsUrlCheck = { ok: true; url: string; host: string } | { ok: false; reason: string };

export function checkTeamsWebhookUrl(raw: string): TeamsUrlCheck {
  const bad = { ok: false as const, reason: "That doesn't look like a Teams Workflows link. Copy it again from the workflow's first step." };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return bad;
  }
  // `new URL` drops an explicit :443, so a non-empty port here is a real other port.
  if (url.protocol !== "https:" || url.username || url.password || url.port) return bad;
  const host = url.hostname.toLowerCase();
  if (!HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return bad;
  if (!url.pathname.includes("/triggers/manual/paths/invoke") || !url.searchParams.get("sig")) return bad;
  return { ok: true, url: url.toString(), host };
}

/** The card's small heading and link text: the store's by default, Phase 27 money alerts their own. */
export type TeamsCard = { heading: string; linkText: string };
export const STORE_CARD: TeamsCard = { heading: "⭐ Store", linkText: "Open the store" };

/**
 * A title is built from names people typed (categories, jars, card memos), and the card
 * renders Markdown, so "[Open](https://...)" in a name would post a disguised link in the
 * family chat. A zero-width space between "]" and "(" keeps the text and drops the link.
 */
export function plainCardText(text: string): string {
  return text.replace(/\]\s*\(/g, "]\u200B(");
}

/** The Adaptive Card message the Workflows "post card" step expects. Buttons don't render there, so the link is text. */
export function teamsPayload(recipient: string, title: string, link: string, card: TeamsCard = STORE_CARD, chatId?: string) {
  return {
    // Read by the family flow's Recipient field: triggerBody()?['recipient'].
    recipient,
    // Phase 30: when set, the flow posts in this Teams group chat instead (README, Teams).
    ...(chatId ? { chatId } : {}),
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: card.heading, weight: "Bolder", size: "Small", isSubtle: true },
            { type: "TextBlock", text: plainCardText(title), wrap: true, size: "Medium", weight: "Bolder" },
            { type: "TextBlock", text: `[${card.linkText}](${link})`, wrap: true },
          ],
        },
      },
    ],
  };
}

export async function sendTeams(
  webhookUrl: string,
  recipient: string,
  title: string,
  link: string,
  fetchFn: typeof fetch = fetch,
  card: TeamsCard = STORE_CARD,
  chatId?: string,
): Promise<void> {
  const check = checkTeamsWebhookUrl(webhookUrl);
  if (!check.ok) throw new Error("The saved Teams link is no longer valid.");
  let res: Response;
  try {
    res = await fetchFn(check.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teamsPayload(recipient, title, link, card, chatId)),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Couldn't reach Teams.");
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new Error("Teams rejected the family link. The workflow may have been turned off or deleted.");
  }
  if (!res.ok) throw new Error(`Teams said no (${res.status}).`);
}
