/**
 * Phase 21: Teams alerts. Phase 50: through the family's own Teams app, a notification-only bot
 * (lib/teams), which messages each grown-up in their chat with it and a jar's group chat; the
 * Workflows link is gone. The card is the same Adaptive Card as before.
 */

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

/** The message activity Bot Connector posts: one Adaptive Card, its link as text (no buttons to answer). */
export function teamsActivity(title: string, link: string, card: TeamsCard = STORE_CARD) {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
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
