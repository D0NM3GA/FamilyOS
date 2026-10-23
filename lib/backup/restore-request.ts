import { NextResponse } from "next/server";
import { getActiveProfile, isSessionOwner } from "@/lib/active-profile";
import { isAdmin } from "@/lib/authz";
import { signedInRecently } from "@/lib/session";

/**
 * The guards in front of POST /api/backup/restore (Phase 16.5), kept out of the route file
 * so they're unit-tested. Route handlers get none of Server Actions' built-in origin
 * checks, and this one deletes a household's data, so every guard is explicit (Fable's
 * scope review):
 * - Sec-Fetch-Site must be exactly same-origin (only our own page's fetch calls this).
 * - Content-Type must be application/json: an HTML form can't send it, and a cross-origin
 *   fetch with it needs a CORS preflight, which fails.
 * - Origin must match the Host.
 * - The caller must be an ADMIN who is the Microsoft-signed-in person themselves, not a
 *   PIN-switched profile, so the restore can never delete its own runner's row.
 * - Phase 28: and signed in within the last 15 minutes (lib/session.ts signedInRecently).
 */

export const MAX_RESTORE_BYTES = 20 * 1024 * 1024;

export const restoreJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** The Origin header's host, or null if it's missing or malformed (never a thrown 500). */
function originHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

type Viewer = NonNullable<Awaited<ReturnType<typeof getActiveProfile>>>;

export async function authorizeRestore(request: Request): Promise<{ viewer: Viewer } | { response: NextResponse }> {
  const deny = (errors: string[], status: number) => ({ response: restoreJson({ errors }, status) });
  const h = request.headers;
  if (h.get("sec-fetch-site") !== "same-origin") return deny(["Not allowed."], 403);
  if (!(h.get("content-type") ?? "").startsWith("application/json")) return deny(["Upload the backup as JSON."], 415);
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || originHost(h.get("origin")) !== host) return deny(["Not allowed."], 403);

  const viewer = await getActiveProfile();
  if (!viewer) return deny(["Sign in first."], 401);
  if (!isAdmin(viewer) || !viewer.authUserId || !(await isSessionOwner(viewer))) {
    return deny(["Only an admin on their own sign-in (not a switched profile) can restore a backup."], 403);
  }
  if (!(await signedInRecently())) return deny(["Sign in again first: a restore needs a sign-in from the last 15 minutes."], 403);
  if (Number(h.get("content-length") ?? "0") > MAX_RESTORE_BYTES) {
    return deny(["That file is too large to be a household backup."], 413);
  }
  return { viewer };
}
