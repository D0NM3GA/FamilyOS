import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchModel, parseModelsPage, parseRecalls } from "./nhtsa";

// Trimmed from real, live api.nhtsa.gov responses captured during Phase 12's scope review
// and build (2026-09-22): recalls for a 2019 Toyota, and (below) 2019 Chevrolet's
// model list.
const RECALLS_FIXTURE = {
  Count: 2,
  Message: "Results returned successfully",
  results: [
    {
      Manufacturer: "Toyota Motor Engineering & Manufacturing",
      NHTSACampaignNumber: "20V682000",
      parkIt: false,
      parkOutSide: false,
      overTheAirUpdate: false,
      ReportReceivedDate: "04/11/2020", // 4 Nov 2020 — NHTSA dates are day-first
      Component: "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP",
      Summary: "The low-pressure fuel pump inside the fuel tank may fail.",
      Consequence: "If the fuel pump fails, the engine can stall while driving, increasing the risk of a crash.",
      Remedy: "Dealers will replace the fuel pump assembly, free of charge.",
    },
    {
      NHTSACampaignNumber: "23V123000",
      parkIt: true,
      parkOutSide: true,
      overTheAirUpdate: false,
      ReportReceivedDate: "28/02/2023",
      Component: "ELECTRICAL SYSTEM",
      Summary: "A short circuit may occur.",
      Consequence: "Increased risk of fire.",
      Remedy: "Dealers will inspect and repair.",
    },
  ],
};

// 2019 Chevrolet from /vehicles/models (the full list — see nhtsa.ts for why not the
// issueType=r list): real shape, with a duplicate and the "DUPLICATE SILVERADO 5500" junk
// row kept on purpose.
const MODELS_FIXTURE = {
  meta: { status: 200, pagination: { count: 6, max: 100, offset: 0, total: 6, nextUrl: null } },
  results: [
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "SILVERADO 1500" },
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "SILVERADO 1500" },
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "SILVERADO 2500" },
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "SILVERADO LD 1500" },
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "DUPLICATE SILVERADO 5500" },
    { modelYear: 2019, make: "CHEVROLET", vehicleModel: "CAMARO" },
  ],
};

const EMPTY_MODELS = { meta: { pagination: { total: 0, nextUrl: null } }, results: [] };
const NO_RECALLS = { Count: 0, Message: "Results returned successfully", results: [] };

describe("parseRecalls", () => {
  it("maps the live shape, converts day-first DD/MM/YYYY, and sorts newest first", () => {
    const recalls = parseRecalls(RECALLS_FIXTURE)!;
    expect(recalls.map((r) => r.campaignNumber)).toEqual(["23V123000", "20V682000"]);
    expect(recalls[0]).toMatchObject({ reportReceivedDate: "2023-02-28", parkIt: true, parkOutSide: true });
    expect(recalls[1].component).toBe("FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP");
  });

  it("reads ReportReceivedDate day-first (regression: MM/DD was assumed and produced '2020-13-01')", () => {
    const [recall] = parseRecalls({
      results: [{ NHTSACampaignNumber: "20V012000", ReportReceivedDate: "13/01/2020" }],
    })!;
    expect(recall.reportReceivedDate).toBe("2020-01-13");
    expect(parseRecalls(RECALLS_FIXTURE)![1].reportReceivedDate).toBe("2020-11-04");
    // An impossible month means the format changed — null, never a garbage date.
    expect(parseRecalls({ results: [{ NHTSACampaignNumber: "X1", ReportReceivedDate: "01/13/2020" }] })![0]
      .reportReceivedDate).toBeNull();
  });

  it("returns null (not an empty list) when the body has no results array", () => {
    expect(parseRecalls({})).toBeNull();
    expect(parseRecalls(null)).toBeNull();
  });

  it("drops rows with no campaign number and de-dupes repeats", () => {
    const recalls = parseRecalls({
      results: [{ NHTSACampaignNumber: "" }, RECALLS_FIXTURE.results[0], RECALLS_FIXTURE.results[0]],
    })!;
    expect(recalls).toHaveLength(1);
  });
});

describe("parseModelsPage / matchModel", () => {
  const known = new Set(parseModelsPage(MODELS_FIXTURE)!.models);

  it("reads vehicleModel, uppercases, and drops the junk DUPLICATE row", () => {
    expect([...known].sort()).toEqual(["CAMARO", "SILVERADO 1500", "SILVERADO 2500", "SILVERADO LD 1500"]);
    expect(parseModelsPage(MODELS_FIXTURE)!.nextUrl).toBeNull();
  });

  it("returns null for a body that isn't the /vehicles/models shape", () => {
    expect(parseModelsPage({})).toBeNull();
  });

  it("matches exactly, case- and whitespace-insensitively", () => {
    expect(matchModel("  silverado   1500 ", known)).toEqual({ match: "SILVERADO 1500" });
  });

  it("does NOT match the everyday name NHTSA doesn't use — suggests instead", () => {
    // Live: "silverado" returns Count 0 recalls; "SILVERADO 1500" returns 10.
    expect(matchModel("Silverado", known)).toEqual({
      suggestions: ["SILVERADO 1500", "SILVERADO 2500", "SILVERADO LD 1500"],
    });
  });

  it("suggests the base model when a trim level was typed", () => {
    expect(matchModel("Camaro SS", known)).toEqual({ suggestions: ["CAMARO"] });
  });
});

describe("checkRecalls", () => {
  // Module-level negative cache — fresh module per test, same as lib/weather.test.ts.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  /** Both lookups run in parallel, so route by URL rather than by call order. */
  function routeFetch(routes: { models: unknown | unknown[]; recalls: unknown }) {
    const modelPages = Array.isArray(routes.models) ? [...routes.models] : [routes.models];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/vehicles/models")) return ok(modelPages.shift() ?? EMPTY_MODELS);
      if (url.includes("/recalls/recallsByVehicle")) return ok(routes.recalls);
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("doesn't call NHTSA when year/make/model aren't all set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Toyota", model: null })).toEqual({ status: "not-configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unknown-model (never 'no recalls') for zero recalls on a name NHTSA doesn't list", async () => {
    routeFetch({ models: MODELS_FIXTURE, recalls: NO_RECALLS });
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Chevrolet", model: "Silverado" })).toEqual({
      status: "unknown-model",
      suggestions: ["SILVERADO 1500", "SILVERADO 2500", "SILVERADO LD 1500"],
    });
  });

  it("shows recalls even when the model list misses the name (regression: 2019 LAND CRUISER)", async () => {
    // Live: LAND CRUISER was absent from the issueType=r list this phase first gated on,
    // yet recallsByVehicle returns 3 for it. Real recalls must never be hidden by the gate.
    routeFetch({ models: MODELS_FIXTURE, recalls: RECALLS_FIXTURE });
    const { checkRecalls } = await import("./nhtsa");
    const result = await checkRecalls({ year: 2019, make: "Toyota", model: "Land Cruiser" });
    expect(result.status).toBe("ok");
  });

  it("treats an exact model match with zero recalls as a trustworthy 'no recalls'", async () => {
    routeFetch({ models: MODELS_FIXTURE, recalls: NO_RECALLS });
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Chevrolet", model: "camaro" })).toEqual({
      status: "ok",
      recalls: [],
    });
  });

  it("reports unknown-make when NHTSA has no models for that year+make", async () => {
    routeFetch({ models: EMPTY_MODELS, recalls: NO_RECALLS });
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Chevy", model: "Tahoe" })).toEqual({ status: "unknown-make" });
  });

  it("queries recalls with the normalized model name", async () => {
    const fetchMock = routeFetch({ models: MODELS_FIXTURE, recalls: RECALLS_FIXTURE });
    const { checkRecalls } = await import("./nhtsa");
    await checkRecalls({ year: 2019, make: "Chevrolet", model: " silverado   1500 " });
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      "https://api.nhtsa.gov/recalls/recallsByVehicle?make=Chevrolet&model=SILVERADO%201500&modelYear=2019",
    );
  });

  it("follows model-list pagination, but only on NHTSA's own host", async () => {
    const page1 = {
      meta: {
        pagination: { nextUrl: "https://api.nhtsa.gov/vehicles/models?offset=100&max=100&make=Ford&modelYear=2019" },
      },
      results: [{ vehicleModel: "F-150" }],
    };
    const page2 = { meta: { pagination: { nextUrl: "https://evil.example/next" } }, results: [{ vehicleModel: "RANGER" }] };
    const fetchMock = routeFetch({ models: [page1, page2], recalls: NO_RECALLS });
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Ford", model: "Ranger" })).toEqual({ status: "ok", recalls: [] });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes("/vehicles/models"))).toHaveLength(2);
    expect(urls.some((u) => u.includes("evil.example"))).toBe(false);
  });

  it("reads recallsByVehicle's 400 as zero recalls, not an outage (live: a listed model with none)", async () => {
    // Live 2026-09-22: 2023 Honda CB500X is in NHTSA's model list and has no recalls;
    // recallsByVehicle answers 400 {"Count":0,"Message":"Results returned successfully"}.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/vehicles/models")
          ? ok({ meta: { pagination: { nextUrl: null } }, results: [{ vehicleModel: "CB500X" }] })
          : { ok: false, status: 400, json: async () => NO_RECALLS },
      ),
    );
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2023, make: "Honda", model: "CB500X" })).toEqual({ status: "ok", recalls: [] });
  });

  it("treats a 5xx as unavailable, whatever its body says", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ Count: 0, results: [] }) }),
    );
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Toyota", model: "Camry" })).toEqual({ status: "unavailable" });
  });

  it("a 400 from the models list is still an outage (only recallsByVehicle uses 400 for 'none')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/vehicles/models") ? { ok: false, status: 400, json: async () => ({}) } : ok(NO_RECALLS),
      ),
    );
    const { checkRecalls } = await import("./nhtsa");
    expect(await checkRecalls({ year: 2019, make: "Toyota", model: "Camry" })).toEqual({ status: "unavailable" });
  });

  it("returns unavailable rather than throwing on a network failure, then backs off", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    const { checkRecalls } = await import("./nhtsa");
    const v = { year: 2019, make: "Toyota", model: "Camry" };
    expect(await checkRecalls(v)).toEqual({ status: "unavailable" });
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(await checkRecalls(v)).toEqual({ status: "unavailable" });
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // negative cache: no new calls
  });
});
