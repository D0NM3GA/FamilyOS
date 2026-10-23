/**
 * Phase 24: the prebuilt receipt model's answer, reduced to what the app uses. Pure and
 * defensive: any field can be missing, and nothing here throws. Money is whole cents.
 * Domain-free (no Pantry knowledge), so it lives in the documents kernel.
 */

export type ReceiptLine = {
  text: string;
  quantity: number | null;
  /** The line's own per-unit price when the receipt prints one ("2 @ 3.99"). */
  unitCents: number | null;
  totalCents: number | null;
};

export type Receipt = {
  merchant: string | null;
  /** The printed date as YYYY-MM-DD (no time zone; callers decide what midnight means). */
  date: string | null;
  totalCents: number | null;
  lines: ReceiptLine[];
};

type Field = {
  valueString?: unknown;
  valueDate?: unknown;
  valueNumber?: unknown;
  valueCurrency?: { amount?: unknown };
  valueArray?: unknown;
  valueObject?: Record<string, Field | undefined>;
  content?: unknown;
};

const MAX_LINES = 100;

export function toCents(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) > 1e7) return null;
  return Math.round(amount * 100);
}

function text(f: Field | undefined): string | null {
  const v = typeof f?.valueString === "string" ? f.valueString : typeof f?.content === "string" ? f.content : null;
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 200) : null;
}

function num(f: Field | undefined): number | null {
  return typeof f?.valueNumber === "number" && Number.isFinite(f.valueNumber) ? f.valueNumber : null;
}

export function parseReceipt(analyzeResult: unknown): Receipt {
  const doc = (analyzeResult as { documents?: { fields?: Record<string, Field | undefined> }[] } | null)?.documents?.[0];
  const fields = doc?.fields ?? {};

  const date = typeof fields.TransactionDate?.valueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.TransactionDate.valueDate)
    ? fields.TransactionDate.valueDate
    : null;

  const items = Array.isArray(fields.Items?.valueArray) ? (fields.Items.valueArray as Field[]) : [];
  const lines: ReceiptLine[] = [];
  for (const item of items.slice(0, MAX_LINES)) {
    const o = item?.valueObject ?? {};
    const t = text(o.Description) ?? text(item);
    if (!t) continue;
    lines.push({
      text: t,
      quantity: num(o.Quantity),
      unitCents: toCents(o.Price?.valueCurrency?.amount),
      totalCents: toCents(o.TotalPrice?.valueCurrency?.amount),
    });
  }

  return {
    merchant: text(fields.MerchantName),
    date,
    totalCents: toCents(fields.Total?.valueCurrency?.amount),
    lines,
  };
}
