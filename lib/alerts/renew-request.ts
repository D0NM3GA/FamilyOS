import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveProfile } from "@/lib/active-profile";
import { subscriptionSchema } from "@/lib/alerts/subscription";
import { renewDevice } from "@/lib/alerts/devices";

/**
 * Phase 68c: POST /api/push/renew, the service worker telling the server the browser renewed its
 * push subscription. Route handlers get none of Server Actions' origin checks, so they're explicit,
 * as for the restore route (lib/backup/restore-request.ts): a same-origin fetch, JSON, Origin =
 * Host. Then someone signed in to this household, and the old endpoint must be one of its devices;
 * the row keeps its person (a family device is the household's, as "Turn on alerts" treats it).
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const bodySchema = z.object({ oldEndpoint: z.string().max(2048), subscription: subscriptionSchema });

function originHost(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** The request's own checks, before anyone is looked up (unit-tested). */
export function sameOriginJson(h: Headers): boolean {
  if (h.get("sec-fetch-site") !== "same-origin") return false;
  if (!(h.get("content-type") ?? "").startsWith("application/json")) return false;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return Boolean(host) && originHost(h.get("origin")) === host;
}

export async function handleRenew(request: Request): Promise<NextResponse> {
  if (!sameOriginJson(request.headers)) return json({ ok: false }, 403);
  if (Number(request.headers.get("content-length") ?? "0") > 8192) return json({ ok: false }, 413);
  const viewer = await getActiveProfile();
  if (!viewer) return json({ ok: false }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return json({ ok: false }, 400);
  const { endpoint, keys } = parsed.data.subscription;
  const ok = await renewDevice(viewer.householdId, parsed.data.oldEndpoint, {
    endpoint,
    p256dh: keys.p256dh.toString("base64url"),
    auth: keys.auth.toString("base64url"),
  });
  return json({ ok }, ok ? 200 : 404);
}
