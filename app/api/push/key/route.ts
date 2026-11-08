import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/active-profile";
import { getVapid } from "@/lib/alerts/vapid";

/**
 * Phase 68c: the server's public push key, for the service worker to subscribe again when the
 * browser renews a subscription without saying which key it used. Public by nature (every
 * subscribed browser has it), but only for someone signed in, like the rest of the app.
 */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await getActiveProfile())) return NextResponse.json({ key: null }, { status: 401, headers });
  const vapid = await getVapid();
  return NextResponse.json({ key: vapid?.publicKey ?? null }, { status: vapid ? 200 : 404, headers });
}
