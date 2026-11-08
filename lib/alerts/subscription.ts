import { z } from "zod";
import { isAllowedPushEndpoint, isValidUaPublicKey } from "@/lib/alerts/webpush";

/**
 * A browser's push subscription as it sends it (PushSubscription.toJSON()), checked: a push
 * service the app allows, and keys of the right lengths. Shared by "Turn on alerts on this phone"
 * and (Phase 68c) the service worker's renewal (app/api/push/renew).
 */
const b64u = (len: number) =>
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+=*$/)
    .transform((s) => Buffer.from(s, "base64url"))
    .refine((b) => b.length === len);

export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint),
  keys: z.object({ p256dh: b64u(65).refine(isValidUaPublicKey), auth: b64u(16) }),
});
