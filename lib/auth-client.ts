import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { clearSavedCopies } from "@/lib/offline/worker";

// No baseURL: `BETTER_AUTH_URL` isn't NEXT_PUBLIC_-prefixed, so it's undefined in the
// browser bundle — the old `?? "http://localhost:3000"` fallback meant sign-in/out always
// targeted localhost in any real deployment. Omitting it entirely lets better-auth's client
// fall through to same-origin (`window.location.origin + "/api/auth"`), which is what's
// actually wanted. BETTER_AUTH_URL is still required server-side (lib/auth.ts) for the
// OAuth redirect URI — this change doesn't touch that.
// Phase 40.1c: passkeys (signIn.passkey, passkey.addPasskey).
export const authClient = createAuthClient({ plugins: [passkeyClient()] });

export const { useSession } = authClient;

/**
 * Every sign-out goes through here (lib/sign-out-guard.test.ts checks): the Shop list saved on
 * this device for offline use (Phase 44.2) goes first, even if the sign-out call then fails
 * for want of signal.
 */
export async function signOut() {
  await clearSavedCopies();
  return authClient.signOut();
}
