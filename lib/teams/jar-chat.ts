import { prisma } from "@/lib/prisma";
import { getGraphToken, GraphAuthError } from "@/lib/graph/client";
import { familyTeamsAppId } from "./family-app";
import { ensureInChat, listGroupChats, TeamsError, type GroupChat } from "./microsoft";

/**
 * Phase 50: a jar's Teams chat, picked from the signed-in member's own group chats.
 *
 * The app may add itself to any chat in the tenant (TeamsAppInstallation.ReadWriteSelfForChat.All),
 * so the pick is the guard: the server only takes a chat id from this member's own list, read
 * again at the moment of saving, and only a group chat. The member must be the one signed in with
 * Microsoft (a delegated token: someone switched in by PIN can't list another person's chats).
 */

export type ChatList = { ok: true; chats: GroupChat[] } | { ok: false; needsGrant: boolean; error: string };

/** What a chat is called in the list: its topic, or its members' names. */
export function chatLabel(chat: GroupChat): string {
  const names = chat.members.map((m) => m.name.split(" ")[0]).join(", ");
  return (chat.topic?.trim() || names || "A group chat").slice(0, 100);
}

/** The signed-in person's own group chats; says when listing needs its permission first. */
export async function myGroupChats(): Promise<ChatList> {
  let token: string;
  try {
    token = await getGraphToken();
  } catch (err) {
    return { ok: false, needsGrant: false, error: err instanceof GraphAuthError ? "Choosing a chat needs you signed in here with Microsoft, on your own sign-in." : "Couldn't reach Microsoft." };
  }
  try {
    return { ok: true, chats: await listGroupChats(token, process.env.MICROSOFT_TENANT_ID ?? "") };
  } catch (err) {
    if (err instanceof TeamsError && err.kind === "needsAdmin") return { ok: false, needsGrant: true, error: err.message };
    return { ok: false, needsGrant: false, error: err instanceof TeamsError ? err.message : "Couldn't list your Teams chats." };
  }
}

/**
 * Points the jar's alerts at one of the member's group chats: checked against their own list
 * again, the family's Teams app added to the chat, then saved with its name. Returns fixed text
 * on failure.
 */
export async function chooseJarChat(
  jar: { id: string; householdId: string },
  chatId: string,
  deps: { list?: () => Promise<ChatList>; install?: typeof ensureInChat } = {},
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const teamsAppId = await familyTeamsAppId(jar.householdId);
  if (!teamsAppId) return { ok: false, error: "Teams isn't set up for the family yet (Settings → Alerts)." };
  const list = await (deps.list ?? myGroupChats)();
  if (!list.ok) return { ok: false, error: list.error };
  const chat = list.chats.find((c) => c.id === chatId);
  if (!chat) return { ok: false, error: "That chat isn't one of your group chats anymore. Choose again." };
  try {
    await (deps.install ?? ensureInChat)(chat.id, teamsAppId);
  } catch (err) {
    return { ok: false, error: err instanceof TeamsError ? err.message : "Couldn't add the family's Teams app to that chat." };
  }
  const name = chatLabel(chat);
  await prisma.moneyJar.update({ where: { id: jar.id }, data: { teamsChatId: chat.id, teamsChatName: name, teamsChatError: null } });
  return { ok: true, name };
}
