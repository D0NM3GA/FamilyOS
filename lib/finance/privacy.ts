import { z } from "zod";

/**
 * Phase 25: Privacy.com's official API (https://api.privacy.com/v1, `Authorization:
 * api-key <key>`). Only GET /transactions is used: each transaction embeds its card's
 * nickname and last four, so /cards (whose responses can carry full card numbers) is never
 * called. Every body goes through an allowlist schema first (zod drops everything else),
 * and nothing here logs or rethrows a body. The key is stored encrypted per jar.
 */

const BASE = "https://api.privacy.com/v1";
const TIMEOUT_MS = 15_000;
const MAX_PAGES = 20;

export class PrivacyError extends Error {
  constructor(
    message: string,
    readonly kind: "refused" | "busy" | "failed",
  ) {
    super(message);
  }
}

const str = (max: number) => z.string().transform((s) => s.slice(0, max));

const txnSchema = z.object({
  token: str(100),
  amount: z.number().int().optional(),
  settled_amount: z.number().int().optional(),
  status: str(20),
  result: str(40).optional(),
  created: z.string().max(40),
  merchant: z.object({ descriptor: str(200).optional() }).partial().optional(),
  card: z.object({ token: str(100).optional(), memo: str(200).optional(), last_four: str(4).optional() }).partial().optional(),
  card_token: str(100).optional(),
});

const pageSchema = z.object({
  data: z.array(txnSchema).max(100),
  page: z.number().int().optional(),
  total_pages: z.number().int().optional(),
});

export type PrivacyTxn = {
  token: string;
  cardToken: string | null;
  cardMemo: string | null;
  cardLast4: string | null;
  merchant: string;
  /** Positive cents, as Privacy reports a charge. */
  amountCents: number;
  status: string;
  occurredAt: Date;
};

/** Money that actually moved: approved and settled (or settling). */
const COUNTED = new Set(["SETTLED", "SETTLING"]);

async function get(path: string, key: string, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(`${BASE}${path}`, {
      headers: { Authorization: `api-key ${key}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PrivacyError("Couldn't reach Privacy.com. Try again later.", "failed");
  }
  if (res.status === 401 || res.status === 403) {
    void res.body?.cancel().catch(() => {});
    throw new PrivacyError("Privacy.com didn't accept that API key.", "refused");
  }
  if (res.status === 429) {
    void res.body?.cancel().catch(() => {});
    throw new PrivacyError("Privacy.com asked us to slow down. It'll try again later.", "busy");
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    throw new PrivacyError(`Privacy.com said no (${res.status}).`, "failed");
  }
  return res.json().catch(() => {
    throw new PrivacyError("Privacy.com gave an unexpected answer.", "failed");
  });
}

export function parsePage(json: unknown): { txns: PrivacyTxn[]; totalPages: number } {
  const parsed = pageSchema.safeParse(json);
  if (!parsed.success) throw new PrivacyError("Privacy.com gave an unexpected answer.", "failed");
  const txns = parsed.data.data.flatMap((t): PrivacyTxn[] => {
    const cents = t.settled_amount || t.amount;
    const occurredAt = new Date(t.created);
    if (!COUNTED.has(t.status) || !cents || cents <= 0 || Number.isNaN(occurredAt.getTime())) return [];
    return [
      {
        token: t.token,
        cardToken: t.card?.token ?? t.card_token ?? null,
        cardMemo: t.card?.memo || null,
        cardLast4: t.card?.last_four ?? null,
        merchant: t.merchant?.descriptor?.trim() || "Privacy.com card",
        amountCents: cents,
        status: t.status,
        occurredAt,
      },
    ];
  });
  return { txns, totalPages: parsed.data.total_pages ?? 1 };
}

/** Checks a key with the smallest possible read. */
export async function verifyKey(key: string, fetchFn: typeof fetch = fetch): Promise<void> {
  parsePage(await get("/transactions?page_size=1", key, fetchFn));
}

/** Settled charges since `begin`, newest pages first, at most 2,000. */
export async function fetchCharges(key: string, begin: Date, fetchFn: typeof fetch = fetch): Promise<PrivacyTxn[]> {
  const out: PrivacyTxn[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({ begin: begin.toISOString().slice(0, 10), page: String(page), page_size: "100", result: "APPROVED" });
    const { txns, totalPages } = parsePage(await get(`/transactions?${params}`, key, fetchFn));
    out.push(...txns);
    if (page >= totalPages) break;
  }
  return out;
}
