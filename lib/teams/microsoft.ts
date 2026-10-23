import { getAppToken, GRAPH_SCOPE, invalidateAppToken } from "@/lib/graph/app-token";

/**
 * Phase 50: the Microsoft calls behind the family's Teams app. App-only (the app's own token):
 * installing itself for a person or in a chat, reading the chat it has with a person, and
 * sending through Bot Connector. Delegated (the signed-in grown-up's token, passed in): publishing
 * the package to the tenant's app catalog and listing that person's own group chats.
 *
 * Every error is fixed text with a `kind` the caller acts on; Microsoft's own messages (which can
 * name people and ids) never leave here. A 401 gets one fresh token, a 429 one wait.
 */

export const BOT_SCOPE = "https://api.botframework.com/.default";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** Bot Connector's global address for proactive messages in Microsoft's public cloud. */
const BOT_SERVICE = "https://smba.trafficmanager.net/teams/";
const MAX_WAIT_MS = 10_000;

export type TeamsErrorKind = "notAllowed" | "gone" | "notPublished" | "needsAdmin" | "failed";

export class TeamsError extends Error {
  constructor(
    readonly kind: TeamsErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type Deps = { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Microsoft's error code from a JSON error body (Graph and Bot Connector both nest it). */
async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: string; innerError?: { code?: string } } };
    return body.error?.code ?? body.error?.innerError?.code ?? "";
  } catch {
    return "";
  }
}

type Call = { method?: string; body?: BodyInit; contentType?: string };

/** One call with an app token: a fresh token after a 401, one wait after a 429. */
async function appCall(scope: string, url: string, call: Call, deps: Deps): Promise<Response> {
  const fetchFn = deps.fetchFn ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const token = await getAppToken(scope, { fetchFn });
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: call.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, ...(call.body ? { "Content-Type": call.contentType ?? "application/json" } : {}) },
        body: call.body,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TeamsError("failed", "Couldn't reach Teams.");
    }
    if (attempt > 0) return res;
    if (res.status === 401) {
      invalidateAppToken(scope);
      continue;
    }
    if (res.status === 429) {
      const wait = Math.min(MAX_WAIT_MS, Math.max(1, Number(res.headers.get("Retry-After")) || 2) * 1000);
      await (deps.sleep ?? sleepFor)(wait);
      continue;
    }
    return res;
  }
}

async function appGraph<T>(path: string, call: Call, deps: Deps): Promise<{ status: number; body: T | null; code: string }> {
  const res = await appCall(GRAPH_SCOPE, `${GRAPH}${path}`, call, deps);
  if (res.ok) return { status: res.status, body: res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null), code: "" };
  return { status: res.status, body: null, code: await errorCode(res) };
}

const appFilter = (teamsAppId: string) => `$expand=teamsApp&$filter=${encodeURIComponent(`teamsApp/id eq '${teamsAppId.replace(/'/g, "''")}'`)}`;

/** Graph refuses an install the tenant's app policies don't allow, or a person Teams can't reach. */
function installRefused(status: number): TeamsError | null {
  if (status === 403) return new TeamsError("notAllowed", "Teams doesn't allow the family's Teams app for this person (an app policy in Teams admin center).");
  if (status === 404) return new TeamsError("notPublished", "Teams can't find the family's Teams app yet. Publish it again from Settings → Alerts, or wait a minute.");
  return null;
}

/**
 * The family's Teams app installed for one person (their Entra object id), and the chat it has
 * with them: installed if it wasn't. Returns both ids, to keep.
 */
export async function ensurePersonalChat(aadObjectId: string, teamsAppId: string, deps: Deps = {}): Promise<{ installId: string; chatId: string }> {
  const base = `/users/${encodeURIComponent(aadObjectId)}/teamwork/installedApps`;
  const find = async () => {
    const r = await appGraph<{ value?: { id: string }[] }>(`${base}?${appFilter(teamsAppId)}`, {}, deps);
    if (r.status >= 400) throw installRefused(r.status) ?? new TeamsError("failed", `Teams said no (${r.status}).`);
    return r.body?.value?.[0]?.id ?? null;
  };
  let installId = await find();
  if (!installId) {
    const r = await appGraph(base, { method: "POST", body: JSON.stringify({ "teamsApp@odata.bind": `${GRAPH}/appCatalogs/teamsApps/${teamsAppId}` }) }, deps);
    // 409: installed meanwhile (another alert, or the person themselves).
    if (r.status >= 400 && r.status !== 409) throw installRefused(r.status) ?? new TeamsError("failed", `Teams said no (${r.status}).`);
    installId = await find();
    if (!installId) throw new TeamsError("notPublished", "Teams hasn't finished adding the family's Teams app yet. It'll try again with the next alert.");
  }
  const chat = await appGraph<{ id?: string }>(`${base}/${encodeURIComponent(installId)}/chat`, {}, deps);
  if (!chat.body?.id) throw new TeamsError("failed", `Teams didn't say which chat to use (${chat.status}).`);
  return { installId, chatId: chat.body.id };
}

/** The family's Teams app installed in a group chat: installed if it wasn't. */
export async function ensureInChat(chatId: string, teamsAppId: string, deps: Deps = {}): Promise<void> {
  const base = `/chats/${encodeURIComponent(chatId)}/installedApps`;
  const found = await appGraph<{ value?: { id: string }[] }>(`${base}?${appFilter(teamsAppId)}`, {}, deps);
  if (found.status >= 400) throw installRefused(found.status) ?? new TeamsError("failed", `Teams said no (${found.status}).`);
  if (found.body?.value?.length) return;
  const r = await appGraph(base, { method: "POST", body: JSON.stringify({ "teamsApp@odata.bind": `${GRAPH}/appCatalogs/teamsApps/${teamsAppId}` }) }, deps);
  if (r.status >= 400 && r.status !== 409) throw installRefused(r.status) ?? new TeamsError("failed", `Teams said no (${r.status}).`);
}

/**
 * Sends one message (an activity with an Adaptive Card) into a chat the family's Teams app is in.
 * `gone` means Teams no longer has the app in that chat (removed, or a quiet chat it let lapse):
 * the caller installs again and retries once.
 */
export async function sendToChat(chatId: string, activity: object, deps: Deps = {}): Promise<void> {
  const res = await appCall(BOT_SCOPE, `${BOT_SERVICE}v3/conversations/${encodeURIComponent(chatId)}/activities`, { method: "POST", body: JSON.stringify(activity) }, deps);
  if (res.ok) return;
  const code = await errorCode(res);
  if (res.status === 403 && code === "BotDisabledByAdmin") {
    throw new TeamsError("notAllowed", "Teams has the family's Teams app turned off (Teams admin center).");
  }
  // Blocked by the person: Microsoft says stop posting until they unblock it, so no reinstall.
  if (res.status === 403 && /ConversationBlocked/i.test(code)) {
    throw new TeamsError("notAllowed", "This person blocked the family's Teams app in Teams. They can unblock it there.");
  }
  // Not in the chat, or not installed for that person anymore: install again and retry once.
  if (res.status === 404 || (res.status === 403 && /NotInConversationRoster|ForbiddenOperation/i.test(code))) {
    throw new TeamsError("gone", "The family's Teams app isn't in that chat anymore.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new TeamsError("failed", "Teams didn't accept the app's sign-in. Check the Azure Bot uses this app registration and has the Teams channel on.");
  }
  throw new TeamsError("failed", `Teams said no (${res.status}).`);
}

// ---------- Delegated: the signed-in grown-up's own token ----------

async function delegated(token: string, url: string, call: Call, fetchFn: typeof fetch): Promise<Response> {
  try {
    return await fetchFn(url, {
      method: call.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(call.body ? { "Content-Type": call.contentType ?? "application/json" } : {}) },
      body: call.body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new TeamsError("failed", "Couldn't reach Teams.");
  }
}

/**
 * Publishes the package to the tenant's app catalog (new) or as a new version of the app already
 * there. Needs AppCatalog.ReadWrite.All, granted to someone who is a Teams or Global administrator.
 * Returns the catalog's id for the app.
 */
export async function publishPackage(
  token: string,
  zip: Buffer,
  existing: { teamsAppId: string | null; manifestId: string },
  fetchFn: typeof fetch = fetch,
  retried = false,
): Promise<string> {
  const upload = (url: string) => delegated(token, url, { method: "POST", body: new Uint8Array(zip), contentType: "application/zip" }, fetchFn);
  const refused = (status: number) =>
    status === 401 || status === 403
      ? new TeamsError("needsAdmin", "Publishing the family's Teams app needs a Teams administrator or Global administrator.")
      : new TeamsError("failed", `Teams said no to the app (${status}).`);
  let teamsAppId = existing.teamsAppId;
  if (!teamsAppId) {
    const res = await upload(`${GRAPH}/appCatalogs/teamsApps`);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      if (body?.id) return body.id;
    } else if (res.status !== 409) {
      throw refused(res.status);
    }
    // Already in the catalog (published before this install kept its id): find it by its fixed id.
    const filter = encodeURIComponent(`externalId eq '${existing.manifestId}'`);
    const found = await delegated(token, `${GRAPH}/appCatalogs/teamsApps?$filter=${filter}`, {}, fetchFn);
    const list = found.ok ? ((await found.json().catch(() => null)) as { value?: { id: string }[] } | null) : null;
    teamsAppId = list?.value?.[0]?.id ?? null;
    if (!teamsAppId) throw refused(found.status);
    if (res.ok) return teamsAppId;
  }
  const res = await upload(`${GRAPH}/appCatalogs/teamsApps/${encodeURIComponent(teamsAppId)}/appDefinitions`);
  // The app was removed from the catalog since: publish it as new, once.
  if (res.status === 404 && !retried) return publishPackage(token, zip, { teamsAppId: null, manifestId: existing.manifestId }, fetchFn, true);
  if (!res.ok) throw refused(res.status);
  return teamsAppId;
}

export type GroupChat = { id: string; topic: string | null; members: { name: string; outside: boolean }[] };

/** The signed-in person's own group chats (Chat.ReadBasic), with members, newest first; at most 200. */
export async function listGroupChats(token: string, tenantId: string, fetchFn: typeof fetch = fetch): Promise<GroupChat[]> {
  const chats: GroupChat[] = [];
  let url: string | null = `${GRAPH}/me/chats?$filter=${encodeURIComponent("chatType eq 'group'")}&$expand=members&$top=50`;
  for (let page = 0; url && page < 4; page++) {
    const res = await delegated(token, url, {}, fetchFn);
    if (res.status === 401 || res.status === 403) throw new TeamsError("needsAdmin", "Listing your Teams chats needs one more permission. Allow it and try again.");
    if (!res.ok) throw new TeamsError("failed", `Teams said no (${res.status}).`);
    const body = (await res.json()) as {
      value?: { id: string; topic: string | null; chatType?: string; members?: { displayName?: string | null; tenantId?: string | null }[] }[];
      "@odata.nextLink"?: string;
    };
    for (const c of body.value ?? []) {
      if (c.chatType && c.chatType !== "group") continue;
      chats.push({
        id: c.id,
        topic: c.topic ?? null,
        members: (c.members ?? []).map((m) => ({ name: m.displayName?.trim() || "Someone", outside: Boolean(m.tenantId && m.tenantId !== tenantId) })),
      });
    }
    const next: string | undefined = body["@odata.nextLink"];
    url = next?.startsWith(`${GRAPH}/`) ? next : null;
  }
  return chats;
}
