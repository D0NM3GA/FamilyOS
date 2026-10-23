/**
 * Phase 21: an app-only Microsoft Graph token (OAuth client credentials), for sending alert
 * email from the app's dedicated mailbox without anyone signed in.
 *
 * Deliberately separate from lib/graph/client.ts, which is for the signed-in user's
 * delegated token and imports next/headers and better-auth. This one reads env lazily and
 * takes an injectable fetch, so it's unit-testable.
 *
 * The app needs NO Graph API permission in Entra for this: Exchange "RBAC for
 * Applications" grants "Application Mail.Send" scoped to the one mailbox, and an Entra
 * Mail.Send grant would be unscoped (the two are a union). So the token's `roles` claim is
 * empty by design; Exchange authorizes it server-side. Setup: README "Alerts".
 *
 * Phase 24 reuses the same app registration for Azure AI Document Intelligence (scope
 * `https://cognitiveservices.azure.com/.default`; authorized by an Azure "Cognitive Services
 * User" role on that one resource, again no Graph permission). Tokens are cached per scope.
 */

type TokenCache = { token: string; expiresAt: number };
const cache = new Map<string, TokenCache>();

export class AppTokenError extends Error {}

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

export function getAppGraphToken(opts: { fetchFn?: typeof fetch; now?: () => number } = {}): Promise<string> {
  return getAppToken(GRAPH_SCOPE, opts);
}

export async function getAppToken(scope: string, opts: { fetchFn?: typeof fetch; now?: () => number } = {}): Promise<string> {
  const now = opts.now ?? Date.now;
  const hit = cache.get(scope);
  if (hit && hit.expiresAt > now()) return hit.token;

  const tenant = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const secret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) throw new AppTokenError("Microsoft sign-in isn't configured on the server.");

  const res = await (opts.fetchFn ?? fetch)(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: secret,
      scope,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // Fixed text only: the token endpoint's error body can echo the client id.
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new AppTokenError(`Microsoft refused the app sign-in (${res.status}).`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new AppTokenError("Microsoft returned no token.");
  // Refresh 5 minutes early.
  const fresh = { token: body.access_token, expiresAt: now() + Math.max(0, (body.expires_in ?? 3600) - 300) * 1000 };
  cache.set(scope, fresh);
  return fresh.token;
}

/** Drops a cached token the service just refused (a role applied or removed since it was minted). */
export function invalidateAppToken(scope: string) {
  cache.delete(scope);
}

/** Tests only. */
export function resetAppTokenCache() {
  cache.clear();
}
