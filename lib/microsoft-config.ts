/**
 * Phase 40.1b: Microsoft sign-in is optional. A family without Microsoft 365 leaves all three
 * MICROSOFT_* settings out; one with it sets all three. Some but not all is a mistake worth
 * stopping on at start, not a quiet "Microsoft is off". Pure (reads only what it's given), so
 * lib/auth.ts and the tests share it.
 */
export type MicrosoftConfig = { clientId: string; clientSecret: string; tenantId: string };

const KEYS = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"] as const;

export function microsoftConfigFrom(env: Record<string, string | undefined>): MicrosoftConfig | null {
  const values = KEYS.map((k) => env[k]?.trim() || "");
  const set = values.filter(Boolean).length;
  if (set === 0) return null;
  if (set < KEYS.length) {
    const missing = KEYS.filter((_, i) => !values[i]).join(", ");
    throw new Error(`Microsoft sign-in is half set up: ${missing} missing. Set all three MICROSOFT_* values, or none to sign in without Microsoft.`);
  }
  const [clientId, clientSecret, tenantId] = values;
  // Pinned to one tenant on purpose (docs/BUILD.md Phase -1): never "common" or "organizations".
  if (["common", "organizations", "consumers"].includes(tenantId.toLowerCase())) {
    throw new Error("MICROSOFT_TENANT_ID must be your own tenant's id, not a shared authority like \"common\".");
  }
  // The tenant's id (a GUID) or its domain, not a URL: it goes into the sign-in address as is.
  if (/[/:\s]/.test(tenantId)) {
    throw new Error("MICROSOFT_TENANT_ID should be just the tenant's id (a GUID), not a URL.");
  }
  return { clientId, clientSecret, tenantId };
}
