/**
 * NHTSA recalls client — free, no key. Two endpoints, both verified live during Phase 12's
 * scope AND build (2026-09-22), not assumed from docs:
 * - `GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=` -> 200
 *   `{ Count, Message, results: [{ NHTSACampaignNumber, ReportReceivedDate "DD/MM/YYYY" (day first!),
 *   Component, Summary, Consequence, Remedy, parkIt, parkOutSide, overTheAirUpdate, ... }] }`.
 *   Make/model are case-insensitive.
 * - `GET https://api.nhtsa.gov/vehicles/models?make=&modelYear=&max=100` -> 200
 *   `{ meta: { pagination: { total, nextUrl } }, results: [{ modelYear, make, vehicleModel }] }`
 *   — NHTSA's full model list for a year+make, paginated (`max` is capped at 100 server-side;
 *   follow `nextUrl` until null). An unknown make is `total: 0`.
 *
 * NOT `/products/vehicle/models?issueType=r`, which the first cut of this phase used: that
 * list only has models with *issues* and is missing some that have recalls (2019 Toyota
 * LAND CRUISER isn't in it, yet has 3 recalls) — Fable's implementation review caught it,
 * confirmed live. Gating on it hid real recalls and made recall-free models un-checkable.
 *
 * Facts that shaped this client:
 * - **A model NHTSA doesn't know returns `Count: 0`, not an error** — and the common case
 *   is just the everyday name: "Silverado" gets 0 recalls, "SILVERADO 1500" gets 10. So
 *   "No open recalls" is only shown after the model is confirmed as an exact entry in
 *   NHTSA's model list for that year+make; otherwise the UI says the check couldn't run
 *   and suggests NHTSA's names. The reverse never applies: if the name-as-typed returns
 *   recalls, they're shown whether or not the list matched (see checkRecalls) — a naming
 *   heuristic must never hide a real recall.
 * - **recallsByVehicle answers every zero-result lookup with HTTP 400** (body: "Results
 *   returned successfully", Count 0) — an unknown model, but ALSO a real, listed model with
 *   no recalls (2023 Honda CB500X), and a missing parameter. We always send all three
 *   parameters, so a 400 with that body means "zero recalls"; only a 5xx/network failure is
 *   "unavailable". Found live during the fix pass, after the first cut treated every 400 as
 *   an outage — which then armed the negative cache and blanked every vehicle for 10 min.
 * - recallsByVehicle matches more loosely than the model list: "CIVIC" returns 2023 Honda
 *   recalls even though the list only has "CIVIC SEDAN"/"CIVIC HATCHBACK" — one more reason
 *   real recalls always win over the list check below.
 * - The model list carries duplicates and at least one junk row ("DUPLICATE SILVERADO
 *   5500") — deduped and filtered below.
 * - No Cache-Control on any response — revalidated daily via Next's fetch cache.
 */

const TIMEOUT_MS = 4000;
const REVALIDATE_S = 86400;
const BASE = "https://api.nhtsa.gov";

export type Recall = {
  campaignNumber: string;
  /** "YYYY-MM-DD" (converted from NHTSA's day-first DD/MM/YYYY), or null if missing/malformed. */
  reportReceivedDate: string | null;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  parkIt: boolean;
  parkOutSide: boolean;
  overTheAirUpdate: boolean;
};

export type RecallCheck =
  | { status: "not-configured" }
  | { status: "unavailable" }
  | { status: "unknown-make" }
  | { status: "unknown-model"; suggestions: string[] }
  | { status: "ok"; recalls: Recall[] };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * NHTSA's ReportReceivedDate is DAY-first ("25/02/2021"), despite being a US agency — the
 * scope review assumed MM/DD/YYYY from a single ambiguous sample ("04/11/2020") and only a
 * live end-to-end run during the build ("2020-13-01" out of the parser) caught it. Checked
 * against campaign numbers, whose middle digits run sequentially through each year
 * (20V055000 -> "30/01/2020", 20V792000 -> "17/12/2020"). Out-of-range parts -> null
 * rather than an impossible date, in case NHTSA ever flips it.
 */
function dayFirstDateToISO(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [day, month] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Pure parsing, no fetch — tested against a fixture built from the live shape above. */
export function parseRecalls(json: unknown): Recall[] | null {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;

  const recalls: Recall[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const campaignNumber = str(row.NHTSACampaignNumber).trim();
    if (!campaignNumber || seen.has(campaignNumber)) continue;
    seen.add(campaignNumber);
    recalls.push({
      campaignNumber,
      reportReceivedDate: dayFirstDateToISO(str(row.ReportReceivedDate)),
      component: str(row.Component),
      summary: str(row.Summary),
      consequence: str(row.Consequence),
      remedy: str(row.Remedy),
      parkIt: row.parkIt === true,
      parkOutSide: row.parkOutSide === true,
      overTheAirUpdate: row.overTheAirUpdate === true,
    });
  }
  // Newest first; undated ones last.
  return recalls.sort((a, b) => (b.reportReceivedDate ?? "").localeCompare(a.reportReceivedDate ?? ""));
}

/**
 * One page of `/vehicles/models`: model names (uppercased, junk rows dropped) plus the next
 * page's URL, or null if the body isn't that shape.
 */
export function parseModelsPage(json: unknown): { models: string[]; nextUrl: string | null } | null {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;

  const models: string[] = [];
  for (const r of results) {
    const model = str((r as { vehicleModel?: unknown } | null)?.vehicleModel).trim().toUpperCase();
    if (model && !model.startsWith("DUPLICATE ")) models.push(model);
  }
  const next = (json as { meta?: { pagination?: { nextUrl?: unknown } } }).meta?.pagination?.nextUrl;
  return { models, nextUrl: typeof next === "string" && next ? next : null };
}

function normalizeModel(model: string): string {
  return model.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Pure: does NHTSA know this model exactly, and if not, what might the family have meant?
 * Suggestions are NHTSA names that contain what was typed ("Silverado" -> "SILVERADO 1500")
 * or that what was typed contains ("Camry XLE" -> "CAMRY").
 */
export function matchModel(
  typed: string,
  known: Set<string>,
): { match: string } | { suggestions: string[] } {
  const wanted = normalizeModel(typed);
  if (known.has(wanted)) return { match: wanted };
  const suggestions = [...known]
    .filter((m) => m.includes(wanted) || wanted.includes(m))
    .sort()
    .slice(0, 6);
  return { suggestions };
}

// Skip retrying NHTSA for a while after a failure — Next's fetch cache only caches
// successful responses, so without this an NHTSA outage would add up to TIMEOUT_MS to
// every board render for its whole duration (same reasoning as lib/weather.ts).
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;
let lastFailureAt: number | null = null;

/**
 * `accept400`: recallsByVehicle's "zero results" is a 400 (see header) — its body is still
 * parsed, and parseRecalls decides whether it's a real `{ results: [] }`. Anything else
 * non-ok (5xx, 429, ...) is an outage.
 */
async function fetchJson(url: string, opts: { accept400?: boolean } = {}): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok && !(opts.accept400 && res.status === 400)) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// No real make has more than a couple of pages (2019 Chevrolet: 48 models, one page);
// this only bounds a pathological nextUrl loop.
const MAX_MODEL_PAGES = 5;

async function fetchModels(year: string, make: string): Promise<Set<string> | null> {
  let url: string | null =
    `${BASE}/vehicles/models?make=${encodeURIComponent(make)}&modelYear=${year}&max=100`;
  const models = new Set<string>();
  for (let page = 0; url != null && page < MAX_MODEL_PAGES; page++) {
    const parsed = parseModelsPage(await fetchJson(url));
    if (parsed == null) return null;
    parsed.models.forEach((m) => models.add(m));
    // Only ever follow NHTSA's own host, whatever the body says.
    url = parsed.nextUrl?.startsWith(`${BASE}/`) ? parsed.nextUrl : null;
  }
  return models;
}

/**
 * Open NHTSA recalls for a vehicle's year+make+model. Never throws. Never reports "no
 * recalls" unless the model is an exact entry in NHTSA's model list; never hides recalls
 * that the name-as-typed does return. Both lookups run in parallel — one round trip.
 */
export async function checkRecalls(vehicle: {
  year: number | null;
  make: string | null;
  model: string | null;
}): Promise<RecallCheck> {
  const make = vehicle.make?.trim();
  const model = vehicle.model ? normalizeModel(vehicle.model) : "";
  if (vehicle.year == null || !make || !model) return { status: "not-configured" };

  if (lastFailureAt != null && Date.now() - lastFailureAt < NEGATIVE_CACHE_MS) {
    return { status: "unavailable" };
  }

  const year = String(vehicle.year);
  const [known, recalls] = await Promise.all([
    fetchModels(year, make),
    fetchJson(
      `${BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`,
      { accept400: true },
    ).then(parseRecalls),
  ]);

  // Real recalls always win, whatever the model list says.
  if (recalls != null && recalls.length > 0) {
    lastFailureAt = null;
    return { status: "ok", recalls };
  }
  if (known == null || recalls == null) {
    lastFailureAt = Date.now();
    return { status: "unavailable" };
  }
  lastFailureAt = null;

  // Zero recalls: only trustworthy if NHTSA actually knows this exact model.
  if (known.size === 0) return { status: "unknown-make" };
  const matched = matchModel(model, known);
  if ("suggestions" in matched) return { status: "unknown-model", suggestions: matched.suggestions };
  return { status: "ok", recalls };
}
