const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * What's wrong with BETTER_AUTH_URL for a production server, or null. It has to be set (the
 * fallback is localhost, so passkeys and invite links would point there) and https, except on
 * this machine itself, where browsers allow passkeys over http (the browser tests' servers).
 * `next build` runs as production too, and is left alone.
 */
export function productionAppUrlProblem(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return null;
  const raw = env.BETTER_AUTH_URL?.trim();
  if (!raw) return "BETTER_AUTH_URL isn't set. Set it to the https:// address the app is served at.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "BETTER_AUTH_URL isn't a web address. Set it to the https:// address the app is served at.";
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
  return "BETTER_AUTH_URL must start with https:// in production, or sign-in cookies would travel unprotected.";
}
