/**
 * NLM's Clinical Table Search Service (RxTerms table) — free, no key, prefix-matching
 * autocomplete over RxNorm's clinical drug names. Deliberately NOT RxNav's
 * `approximateTerm` endpoint: that's a whole-string approximate matcher (returns nothing
 * for a partial prefix like "tyl"), omits the `name` field entirely for source
 * vocabularies needing a UMLS license, and repeats the same `rxcui` across atoms —
 * confirmed by hitting it directly during this phase's scope review, not assumed from docs.
 * https://clinicaltables.nlm.nih.gov/apidoc/rxterms/v3/doc.html
 *
 * NLM's terms ask for attribution, shown as a line of muted text under whichever field uses
 * this (see app/(app)/meds/task-definition-form.tsx) — not a data-use restriction, just credit.
 */

const BASE = "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

/**
 * Pure parsing, no fetch — testable against a fixture, and verified against the LIVE
 * endpoint during this phase's build (not assumed from docs — a prior draft of this
 * function, based on a secondhand description, had this wrong). CTSS's response is a
 * 4-tuple: `[totalCount, codes[], extraFieldsMap, displayRows[]]`. `displayRows` is an
 * array of ONE-ELEMENT arrays (one element per requested display field — we request none,
 * so it's always just `[name]`), not a flat array of strings, e.g.:
 * `[8, ["TYLENOL (Oral Pill)", ...], null, [["TYLENOL (Oral Pill)"], ...]]`
 * The `Array.isArray(row) ? row[0] : row` fallback tolerates a flatter shape too, in case
 * that ever changes or a different `df` param is added later.
 */
export function parseRxTermsResponse(data: unknown): string[] {
  if (!Array.isArray(data) || data.length < 4) return [];
  const displayRows = data[3];
  if (!Array.isArray(displayRows)) return [];
  return displayRows
    .map((row) => (Array.isArray(row) ? row[0] : row))
    .filter((s): s is string => typeof s === "string");
}

/** RxTerms display strings look like "TYLENOL (Oral Pill)" — a picked suggestion should
 * fill the title with just "TYLENOL"; the parenthetical is dosage-form metadata, not part
 * of the medication's own name. */
export function stripDosageForm(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Suggested medication names for an autocomplete dropdown. A prefix matcher, so callers
 * should debounce and wait for at least 2 characters — fewer returns nothing useful and
 * risks a request per keystroke for no benefit.
 */
export async function searchRxTerms(query: string, limit = 8): Promise<string[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  try {
    const params = new URLSearchParams({ terms: term, maxList: String(limit) });
    const res = await fetch(`${BASE}?${params}`);
    if (!res.ok) return [];
    return parseRxTermsResponse(await res.json());
  } catch {
    return []; // network hiccup, whatever — never break the form over it
  }
}
