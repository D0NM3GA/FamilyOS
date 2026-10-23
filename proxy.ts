import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, isPageRequest, makeNonce } from "@/lib/security/csp";
import { accessConfigFrom, checkAccessToken, type AccessConfig } from "@/lib/security/cf-access";
import { BREAK_GLASS_HEADER, breakGlassAllows } from "@/lib/security/break-glass";
import { SENTRY_DSN } from "@/lib/observability/options";

/**
 * Phase 42: every request passes here first (Next 16's proxy, the Node runtime).
 *
 * 1. Only through Cloudflare Access (lib/security/cf-access.ts), when it's configured: anything
 *    without a valid Access token gets a plain 403, unless the break-glass entrance is on and the
 *    request came through it (lib/security/break-glass.ts). `/api/auth/ok`, the container's
 *    health check, is the one exemption: the proxy can't see where a request comes from, so a
 *    path is the only honest one, and that route returns a constant and touches nothing.
 * 2. Pages get the script policy with a fresh nonce (lib/security/csp.ts), set on the request
 *    too, which is where Next reads it for its own scripts and the root layout for its own.
 */
// A malformed CF_ACCESS_TEAM_DOMAIN must not crash every request into a restart loop: it closes the
// door with a plain 503 and says why in the log (instrumentation.ts says so at start too).
let access: AccessConfig | null = null;
let misconfigured: string | null = null;
try {
  access = accessConfigFrom(process.env);
} catch (err) {
  misconfigured = err instanceof Error ? err.message : "Cloudflare Access is misconfigured.";
}

// One log line per reason a minute, so a typo in CF_ACCESS_AUD (every request refused) is visible.
const lastLogged = new Map<string, number>();
function logRefusal(reason: string) {
  const now = Date.now();
  if (now - (lastLogged.get(reason) ?? 0) < 60_000) return;
  lastLogged.set(reason, now);
  console.warn(`[access] Refused a request without a valid Cloudflare Access token (${reason}).`);
}
const HEALTH_PATH = "/api/auth/ok";
const dev = process.env.NODE_ENV === "development";
const https = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (misconfigured && pathname !== HEALTH_PATH) {
    logRefusal(misconfigured);
    return new NextResponse("This server's Cloudflare Access settings are wrong; see its log.", { status: 503, headers: { "content-type": "text/plain" } });
  }
  if (access && pathname !== HEALTH_PATH) {
    const checked = await checkAccessToken(request.headers.get("cf-access-jwt-assertion"), access);
    if (!checked.ok && !(await breakGlassAllows(request.headers.get(BREAK_GLASS_HEADER)))) {
      logRefusal(checked.reason);
      return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    }
  }

  if (!isPageRequest(pathname, request.headers)) return NextResponse.next();

  const nonce = makeNonce();
  const policy = contentSecurityPolicy({ nonce, dev, https, sentryDsn: SENTRY_DSN });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}
