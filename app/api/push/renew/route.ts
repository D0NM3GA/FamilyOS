import { handleRenew } from "@/lib/alerts/renew-request";

/** Phase 68c: the service worker's renewed push subscription (lib/alerts/renew-request.ts). */
export async function POST(request: Request) {
  return handleRenew(request);
}
