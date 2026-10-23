import { createHash, randomUUID } from "node:crypto";
import type { FamilyLook } from "@/lib/family-look";
import { themeColorOf } from "@/lib/theme-colors";
import { zipFiles } from "./zip";

/**
 * Phase 50: the family's own Teams app, a notification-only bot that brings the app's alerts to
 * each grown-up's Teams and to a jar's group chat (docs/PLAN.md, Phase 50). Its package is built
 * here from the family's settings: it's published only into the family's own Microsoft 365
 * tenant, where the family sees it by the name they gave the app (like an alert email's subject),
 * never a fixed product name. Its addresses are this install's own (BETTER_AUTH_URL).
 *
 * The bot is the family's existing app registration (MICROSOFT_CLIENT_ID), so `webApplicationInfo`
 * names it too: without it Graph won't let the app install or list itself for people and chats.
 */

export type TeamsAppInputs = {
  look: FamilyLook;
  /** The app registration's client id: the bot's id and the Graph app's. */
  appId: string;
  /** This install's https address (BETTER_AUTH_URL). */
  baseUrl: string;
  /** The package's fixed id, made once per family (HouseholdAlerts.teamsManifestId). */
  manifestId: string;
  version: string;
};

export const newManifestId = () => randomUUID();

/** Teams' limits: short name 30, full name 100, developer name 32, short description 80. */
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function buildManifest(i: TeamsAppInputs) {
  const name = i.look.appName;
  const host = new URL(i.baseUrl).host;
  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: i.version,
    id: i.manifestId,
    developer: { name: cut(name, 32), websiteUrl: i.baseUrl, privacyUrl: i.baseUrl, termsOfUseUrl: i.baseUrl },
    name: { short: cut(name, 30), full: cut(name, 100) },
    description: {
      short: cut(`Alerts from ${name}`, 80),
      full: `Alerts from ${name}, the family's own app: store orders, money alerts and sign-in notices, each with a link back to the app. It only sends; it doesn't read your chats.`,
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: themeColorOf(i.look.themeColor).light.chrome,
    bots: [{ botId: i.appId, scopes: ["personal", "groupChat"], isNotificationOnly: true, supportsFiles: false, supportsCalling: false, supportsVideo: false }],
    validDomains: [host],
    webApplicationInfo: { id: i.appId, resource: `api://botid-${i.appId}` },
  };
}

/**
 * What a published version was built from, so a changed name, color or icon (or a new address)
 * is noticed: the manifest without its version, and the icons' bytes.
 */
export function packageHash(manifest: ReturnType<typeof buildManifest>, color: Buffer, outline: Buffer): string {
  return createHash("sha256").update(JSON.stringify({ ...manifest, version: "" })).update(color).update(outline).digest("hex");
}

/** The next version after `previous` (Teams wants #.#.#, rising with each published package). */
export function nextVersion(previous: string | null): string {
  const m = previous?.match(/^1\.0\.(\d+)$/);
  return `1.0.${m ? Number(m[1]) + 1 : 0}`;
}

export function packageZip(manifest: ReturnType<typeof buildManifest>, color: Buffer, outline: Buffer): Buffer {
  return zipFiles([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "color.png", data: color },
    { name: "outline.png", data: outline },
  ]);
}
