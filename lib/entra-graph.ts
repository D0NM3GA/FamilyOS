import { getAppGraphToken, GRAPH_SCOPE, invalidateAppToken } from "@/lib/graph/app-token";

/**
 * Phase 40.4: who Entra assigns to this app, read with the app's own Graph token (client
 * credentials; the owner grants `Application.Read.All` and `GroupMember.ReadBasic.All`, with admin
 * consent). The app's roles come from its service principal; its assignments are users and
 * groups; a group's **direct** members count, not members of groups inside it: Entra itself
 * doesn't pass an assignment down to nested groups, so neither does this (Fable's review).
 *
 * Anything short of a complete answer is an error, never a partial list: the check
 * (lib/entra-check.ts) then changes nothing. Errors carry a code, never Graph's own text (it
 * carries tenant and request ids).
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 200;

export type EntraRole = "ADMIN" | "ADULT";
export type EntraReadError = "permission" | "config" | "unavailable" | "unexpected";

export class EntraGraphError extends Error {
  constructor(readonly code: EntraReadError) {
    super(`Entra check: ${code}`);
  }
}

type Deps = { fetchFn?: typeof fetch; token?: () => Promise<string>; clientId?: string };

/** One GET, with the app token; a 401 gets one fresh token and one retry. */
async function get(url: string, deps: Required<Pick<Deps, "fetchFn" | "token">>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // No token is the app's Microsoft settings (client id or secret), not Entra being away.
    let token: string;
    try {
      token = await deps.token();
    } catch {
      throw new EntraGraphError("config");
    }
    let res: Response;
    try {
      res = await deps.fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new EntraGraphError("unavailable");
    }
    if (!res.ok) void res.body?.cancel().catch(() => {});
    if (res.status === 401 && attempt === 0) {
      invalidateAppToken(GRAPH_SCOPE);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new EntraGraphError("permission");
    if (res.status === 429 || res.status >= 500) throw new EntraGraphError("unavailable");
    if (!res.ok) throw new EntraGraphError("unexpected");
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      throw new EntraGraphError("unexpected");
    }
  }
  throw new EntraGraphError("permission");
}

/** Every page of a list, following `@odata.nextLink` (only ever to Graph itself). */
async function getAll(url: string, deps: Required<Pick<Deps, "fetchFn" | "token">>): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let next: string | null = url;
  for (let page = 0; next; page++) {
    if (page >= MAX_PAGES || !next.startsWith(`${GRAPH}/`)) throw new EntraGraphError("unexpected");
    const body = await get(next, deps);
    if (!Array.isArray(body.value)) throw new EntraGraphError("unexpected");
    items.push(...(body.value as Record<string, unknown>[]));
    const link = body["@odata.nextLink"];
    next = typeof link === "string" ? link : null;
  }
  return items;
}

const better = (a: EntraRole | undefined, b: EntraRole): EntraRole => (a === "ADMIN" || b === "ADMIN" ? "ADMIN" : "ADULT");

/**
 * Entra object id (lowercase) → the best app role it gets (Admin over Adult). Kid, disabled
 * roles, the default-access role and anything unknown give nothing. Throws EntraGraphError.
 */
export async function readEntraAssignments(deps: Deps = {}): Promise<Map<string, EntraRole>> {
  const d = { fetchFn: deps.fetchFn ?? fetch, token: deps.token ?? (() => getAppGraphToken()) };
  const clientId = deps.clientId ?? process.env.MICROSOFT_CLIENT_ID?.trim();
  if (!clientId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId)) throw new EntraGraphError("config");

  const sp = await get(`${GRAPH}/servicePrincipals(appId='${clientId}')?$select=id,appRoles`, d);
  if (typeof sp.id !== "string" || !Array.isArray(sp.appRoles)) throw new EntraGraphError("unexpected");
  const roleById = new Map<string, EntraRole>();
  for (const r of sp.appRoles as { id?: unknown; value?: unknown; isEnabled?: unknown }[]) {
    if (typeof r.id !== "string" || r.isEnabled === false) continue;
    if (r.value === "Admin") roleById.set(r.id, "ADMIN");
    else if (r.value === "Adult") roleById.set(r.id, "ADULT");
  }

  const assigned = new Map<string, EntraRole>();
  const give = (oid: unknown, role: EntraRole) => {
    if (typeof oid !== "string") return;
    const key = oid.toLowerCase();
    assigned.set(key, better(assigned.get(key), role));
  };
  const assignments = await getAll(`${GRAPH}/servicePrincipals/${encodeURIComponent(sp.id)}/appRoleAssignedTo?$select=principalId,principalType,appRoleId`, d);
  for (const a of assignments) {
    const role = typeof a.appRoleId === "string" ? roleById.get(a.appRoleId) : undefined;
    if (!role) continue;
    if (a.principalType === "User") give(a.principalId, role);
    else if (a.principalType === "Group" && typeof a.principalId === "string") {
      // No query string: $select and type casts on members need advanced queries, whose index
      // can lag (Fable's review). Users only; nested groups don't count (Entra's rule).
      const members = await getAll(`${GRAPH}/groups/${encodeURIComponent(a.principalId)}/members`, d);
      for (const m of members) if (m["@odata.type"] === "#microsoft.graph.user") give(m.id, role);
    }
  }
  return assigned;
}
