import { prisma } from "@/lib/prisma";
import { getFamilyLook } from "@/lib/household-settings";
import { renderAppIcon, renderOutlineIcon } from "@/lib/app-icon";
import { buildManifest, newManifestId, nextVersion, packageHash, packageZip } from "./manifest";
import { ensurePersonalChat, sendToChat, TeamsError, type Deps } from "./microsoft";

/**
 * Phase 50: the family's Teams app as this household has it: its package (built from today's
 * settings), whether what's in Teams is current, and sending to one person through it.
 */

/** The app registration that is also the bot; null without Microsoft sign-in configured. */
export function teamsBotAppId(): string | null {
  return process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_CLIENT_SECRET ? process.env.MICROSOFT_CLIENT_ID : null;
}

function baseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export type TeamsApp = {
  /** The catalog's id once published; null before. */
  teamsAppId: string | null;
  /** Published, but built from an older name, color, icon or address. */
  outOfDate: boolean;
  publishedAt: Date | null;
};

/** Builds the package from the family's settings now, making the fixed manifest id the first time. */
export async function buildFamilyPackage(householdId: string) {
  const appId = teamsBotAppId();
  if (!appId) throw new TeamsError("failed", "Microsoft sign-in isn't set up on this install, so Teams can't be either.");
  const row = await prisma.householdAlerts.upsert({ where: { householdId }, create: { householdId, teamsManifestId: newManifestId() }, update: {} });
  const manifestId = row.teamsManifestId ?? (await prisma.householdAlerts.update({ where: { householdId }, data: { teamsManifestId: newManifestId() } })).teamsManifestId!;
  const look = await getFamilyLook(householdId);
  const [color, outline] = await Promise.all([
    renderAppIcon(look, 192).then(async (r) => Buffer.from(await r.arrayBuffer())),
    renderOutlineIcon(look, 32).then(async (r) => Buffer.from(await r.arrayBuffer())),
  ]);
  const probe = buildManifest({ look, appId, baseUrl: baseUrl(), manifestId, version: "1.0.0" });
  const hash = packageHash(probe, color, outline);
  const version = row.teamsAppHash === hash && row.teamsAppVersion ? row.teamsAppVersion : nextVersion(row.teamsAppVersion);
  const manifest = { ...probe, version };
  return { manifestId, version, hash, zip: packageZip(manifest, color, outline), teamsAppId: row.teamsAppId };
}

/** What's in Teams for this family, and whether it's current. */
export async function familyTeamsApp(householdId: string): Promise<TeamsApp> {
  const row = await prisma.householdAlerts.findUnique({ where: { householdId }, select: { teamsAppId: true, teamsAppHash: true, teamsPublishedAt: true } });
  if (!row?.teamsAppId) return { teamsAppId: null, outOfDate: false, publishedAt: null };
  const built = await buildFamilyPackage(householdId).catch(() => null);
  return { teamsAppId: row.teamsAppId, outOfDate: Boolean(built && built.hash !== row.teamsAppHash), publishedAt: row.teamsPublishedAt };
}

/** The catalog id to send through, or null when the family hasn't published its Teams app. */
export async function familyTeamsAppId(householdId: string): Promise<string | null> {
  if (!teamsBotAppId()) return null;
  const row = await prisma.householdAlerts.findUnique({ where: { householdId }, select: { teamsAppId: true } });
  return row?.teamsAppId ?? null;
}

/** Records a successful publish (the caller made the Graph call with the admin's token). */
export async function recordPublished(householdId: string, built: { version: string; hash: string }, teamsAppId: string, personId: string) {
  await prisma.$transaction([
    prisma.householdAlerts.update({
      where: { householdId },
      data: { teamsAppId, teamsAppVersion: built.version, teamsAppHash: built.hash, teamsPublishedAt: new Date(), updatedByPersonId: personId },
    }),
    // A fresh start for everyone's Teams status (old errors were about the old app).
    prisma.alertPrefs.updateMany({ where: { person: { householdId } }, data: { lastErrorTeams: null } }),
  ]);
}

/**
 * Sends one activity to one person's chat with the family's Teams app: installs the app for
 * them and reads the chat the first time (kept on their AlertPrefs), and when Teams says the
 * chat is gone, installs again and retries once.
 */
export async function sendToPerson(personId: string, aadObjectId: string, teamsAppId: string, activity: object, deps: Deps = {}): Promise<void> {
  const prefs = await prisma.alertPrefs.findUnique({ where: { personId }, select: { teamsChatId: true } });
  const fresh = async () => {
    const chat = await ensurePersonalChat(aadObjectId, teamsAppId, deps);
    await prisma.alertPrefs.upsert({
      where: { personId },
      create: { personId, teamsInstallId: chat.installId, teamsChatId: chat.chatId },
      update: { teamsInstallId: chat.installId, teamsChatId: chat.chatId },
    });
    return chat.chatId;
  };
  const chatId = prefs?.teamsChatId ?? (await fresh());
  try {
    await sendToChat(chatId, activity, deps);
  } catch (err) {
    if (!(err instanceof TeamsError) || err.kind !== "gone") throw err;
    await prisma.alertPrefs.update({ where: { personId }, data: { teamsInstallId: null, teamsChatId: null } });
    await sendToChat(await fresh(), activity, deps);
  }
}
