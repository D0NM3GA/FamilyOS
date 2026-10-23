import { z } from "zod";
import { decimalToCents } from "@/lib/money";

/**
 * Phase 25: SimpleFIN Bridge, the family's read-only bank feed (https://www.simplefin.org/protocol.html).
 * A setup token (base64 of a claim URL) is traded once for an access URL that carries its
 * own Basic-auth credentials; that URL IS the credential, stored encrypted per jar.
 *
 * Both URLs must be on SimpleFIN's own hosts (exact allowlist, https, no port), so no other
 * server ever gets a request, and no DNS/SSRF guard is needed. fetch() refuses URLs with
 * credentials in them, so the userinfo becomes an Authorization header. Errors are fixed
 * text: never the URL, the bank's data or the response body.
 */

const HOSTS = new Set(["bridge.simplefin.org", "beta-bridge.simplefin.org"]);
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TXNS = 5000;

export class SimpleFinError extends Error {
  constructor(
    message: string,
    readonly kind: "badToken" | "used" | "refused" | "busy" | "failed",
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function allowed(url: URL, needsCredentials: boolean): boolean {
  return (
    url.protocol === "https:" &&
    HOSTS.has(url.hostname.toLowerCase()) &&
    !url.port &&
    !url.search &&
    !url.hash &&
    (needsCredentials ? Boolean(url.username && url.password) : !url.username && !url.password)
  );
}

/** The claim URL inside a setup token, or null when it isn't a SimpleFIN one. */
export function claimUrlFromToken(token: string): URL | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 2048 || !/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) return null;
  try {
    const url = new URL(Buffer.from(trimmed, "base64").toString("utf8").trim());
    return allowed(url, false) ? url : null;
  } catch {
    return null;
  }
}

/** A stored access URL, validated again on every use. */
export function checkAccessUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return allowed(url, true) ? url : null;
  } catch {
    return null;
  }
}

/** Trades a setup token for the access URL. The token works once. */
export async function claimSetupToken(token: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const claim = claimUrlFromToken(token);
  if (!claim) throw new SimpleFinError("That doesn't look like a SimpleFIN setup token.", "badToken");
  let res: Response;
  try {
    res = await fetchFn(claim, { method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SimpleFinError("Couldn't reach SimpleFIN. Try again in a moment.", "failed");
  }
  if (res.status === 403) {
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError("That setup token has already been used. Make a new one at SimpleFIN.", "used");
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError(`SimpleFIN didn't accept that token (${res.status}).`, "failed");
  }
  const access = (await res.text()).slice(0, 4096).trim();
  if (!checkAccessUrl(access)) throw new SimpleFinError("SimpleFIN gave an unexpected answer.", "failed");
  return access;
}

// Long strings are cut, not rejected: one bank's long description mustn't fail the whole sync.
const str = (max: number) => z.string().transform((s) => s.slice(0, max));
const money = z.union([z.string(), z.number()]).transform((v) => decimalToCents(v));
const epoch = z.union([z.number(), z.string()]).transform((v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
});

const txnSchema = z.object({
  id: str(200),
  posted: epoch.optional(),
  transacted_at: epoch.optional(),
  amount: money,
  description: str(500).optional().default(""),
  payee: str(200).optional(),
  memo: str(500).optional(),
  pending: z.boolean().optional(),
});

const accountSchema = z.object({
  id: str(200),
  name: str(200),
  currency: str(64).optional().default("USD"),
  balance: money.optional(),
  "available-balance": money.optional(),
  "balance-date": epoch.optional(),
  org: z.object({ name: str(200).optional(), domain: str(200).optional() }).partial().optional(),
  transactions: z.array(txnSchema).optional().default([]),
});

const responseSchema = z.object({
  errors: z.array(z.string().transform((s) => s.slice(0, 200))).optional().default([]),
  accounts: z.array(accountSchema).max(200).optional().default([]),
});

export type SfTransaction = {
  id: string;
  /** Civil day YYYY-MM-DD in UTC. */
  postedOn: string;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
};

export type SfAccount = {
  id: string;
  name: string;
  org: string | null;
  currency: string;
  balanceCents: number | null;
  availableCents: number | null;
  balanceAt: Date | null;
  transactions: SfTransaction[];
};

/** UTC civil day of an epoch-seconds timestamp. Bank dates are midnight UTC. */
export function utcDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** Validates and normalizes a /accounts response. Rows with an unusable amount are dropped. */
export function parseAccounts(json: unknown, now: Date = new Date()): { accounts: SfAccount[]; messages: string[] } {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new SimpleFinError("SimpleFIN gave an unexpected answer.", "failed");
  let total = 0;
  const accounts = parsed.data.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    org: a.org?.name ?? a.org?.domain ?? null,
    currency: a.currency,
    balanceCents: a.balance ?? null,
    availableCents: a["available-balance"] ?? null,
    balanceAt: a["balance-date"] ? new Date(a["balance-date"] * 1000) : null,
    transactions: a.transactions.flatMap((t) => {
      if (t.amount == null || total >= MAX_TXNS) return [];
      total++;
      // A pending row's `posted` is 0: fall back to when it happened, else today.
      const when = t.posted ?? t.transacted_at ?? Math.floor(now.getTime() / 1000);
      return [
        {
          id: t.id,
          postedOn: utcDay(when),
          amountCents: t.amount,
          description: t.description || t.payee || "",
          payee: t.payee ?? null,
          memo: t.memo ?? null,
          pending: t.pending ?? !t.posted,
        },
      ];
    }),
  }));
  return { accounts, messages: parsed.data.errors.map((e) => e.slice(0, 200)) };
}

/** GET /accounts for a window (≤ 90 days, SimpleFIN's limit), pending included. */
export async function fetchAccounts(
  accessUrl: string,
  window: { start: Date; end: Date },
  fetchFn: typeof fetch = fetch,
): Promise<{ accounts: SfAccount[]; messages: string[] }> {
  const access = checkAccessUrl(accessUrl);
  if (!access) throw new SimpleFinError("The saved bank connection isn't valid. Reconnect it.", "refused");
  let auth: string;
  try {
    auth = Buffer.from(`${decodeURIComponent(access.username)}:${decodeURIComponent(access.password)}`).toString("base64");
  } catch {
    throw new SimpleFinError("The saved bank connection isn't valid. Reconnect it.", "refused");
  }
  const url = new URL(access.pathname.replace(/\/$/, "") + "/accounts", `${access.protocol}//${access.host}`);
  url.searchParams.set("start-date", String(Math.floor(window.start.getTime() / 1000)));
  url.searchParams.set("end-date", String(Math.floor(window.end.getTime() / 1000)));
  url.searchParams.set("pending", "1");

  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Authorization: `Basic ${auth}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SimpleFinError("Couldn't reach the bank feed. Try again later.", "failed");
  }
  if (res.status === 402 || res.status === 403) {
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError("SimpleFIN refused the connection. Check your SimpleFIN account, or reconnect.", "refused");
  }
  if (res.status === 429 || res.status === 503) {
    const s = Number(res.headers.get("retry-after"));
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError("The bank feed asked us to slow down. It'll try again later.", "busy", Number.isFinite(s) && s > 0 ? s * 1000 : 60 * 60 * 1000);
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError(`The bank feed said no (${res.status}).`, "failed");
  }
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) {
    void res.body?.cancel().catch(() => {});
    throw new SimpleFinError("The bank feed sent too much at once.", "failed");
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new SimpleFinError("The bank feed sent too much at once.", "failed");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SimpleFinError("SimpleFIN gave an unexpected answer.", "failed");
  }
  return parseAccounts(json);
}
