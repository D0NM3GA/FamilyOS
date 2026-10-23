import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentError, analyzeDocument, checkEndpoint } from "./client";
import { parseReceipt, toCents } from "./receipt";

const ENDPOINT = "https://familyos-docs.cognitiveservices.azure.com/";

/** The DocumentError a call rejects with (and a failed test if it resolves). */
const fail = (p: Promise<unknown>): Promise<DocumentError> =>
  p.then(
    () => {
      throw new Error("expected a DocumentError");
    },
    (e: DocumentError) => e,
  );

describe("checkEndpoint", () => {
  it("accepts only a custom-subdomain https endpoint", () => {
    expect(checkEndpoint(ENDPOINT)?.hostname).toBe("familyos-docs.cognitiveservices.azure.com");
    expect(checkEndpoint("https://familyos-docs.cognitiveservices.azure.com")).not.toBeNull();
    expect(checkEndpoint("https://FAMILYOS-DOCS.cognitiveservices.azure.com/")?.hostname).toBe("familyos-docs.cognitiveservices.azure.com");
    expect(checkEndpoint("https://familyos-docs.cognitiveservices.azure.com./")).toBeNull();
    for (const bad of [
      undefined,
      "",
      "http://familyos-docs.cognitiveservices.azure.com/",
      "https://evil.com/",
      "https://familyos-docs.cognitiveservices.azure.com.evil.com/",
      "https://a.b.cognitiveservices.azure.com/",
      "https://.cognitiveservices.azure.com/",
      "https://u:p@familyos-docs.cognitiveservices.azure.com/",
      "https://familyos-docs.cognitiveservices.azure.com:8443/",
      "https://familyos-docs.cognitiveservices.azure.com/path",
      "https://familyos-docs.cognitiveservices.azure.com/?x=1",
    ]) {
      expect(checkEndpoint(bad)).toBeNull();
    }
  });
});

describe("analyzeDocument", () => {
  const saved = process.env.DOCINTEL_ENDPOINT;
  beforeEach(() => {
    process.env.DOCINTEL_ENDPOINT = ENDPOINT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DOCINTEL_ENDPOINT;
    else process.env.DOCINTEL_ENDPOINT = saved;
  });

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const base = { token: async () => "T", sleep: async () => {} };
  const bytes = new Uint8Array([0xff, 0xd8, 0xff]);

  it("starts, polls a relative result URL on the same host, returns the result and deletes it", async () => {
    const calls: { url: string; method: string; redirect?: string; auth?: string }[] = [];
    const fetchFn = vi.fn(async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", redirect: init?.redirect, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ base64Source: "/9j/" });
        return new Response(null, { status: 202, headers: { "operation-location": "/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/abc?api-version=2024-11-30" } });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return calls.filter((c) => c.method === "GET").length === 1 ? json({ status: "running" }) : json({ status: "succeeded", analyzeResult: { ok: 1 } });
    }) as unknown as typeof fetch;

    expect(await analyzeDocument({ model: "prebuilt-receipt", bytes }, { ...base, fetchFn })).toEqual({ ok: 1 });
    expect(calls[0].url).toBe(`${ENDPOINT}documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30`);
    expect(calls.every((c) => c.redirect === "error" && c.auth === "Bearer T")).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "GET", "DELETE"]);
    expect(calls[1].url.startsWith(`${ENDPOINT}documentintelligence/`)).toBe(true);
  });

  it("refuses a result URL on another host, never sending the token there", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, { status: 202, headers: { "operation-location": "https://evil.example/documentintelligence/x" } }),
    ) as unknown as typeof fetch;
    await expect(analyzeDocument({ model: "prebuilt-receipt", bytes }, { ...base, fetchFn })).rejects.toThrow(DocumentError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("errors are fixed text: the service's body never reaches the message", async () => {
    const fetchFn = vi.fn(async () => json({ error: { message: "SECRET-MARKER line items" } }, 400)) as unknown as typeof fetch;
    const err = await fail(analyzeDocument({ model: "prebuilt-receipt", bytes }, { ...base, fetchFn }));
    expect(err).toBeInstanceOf(DocumentError);
    expect(String(err.message)).not.toContain("SECRET-MARKER");
    expect(err.message).toContain("400");
  });

  it("busy, refused, failed and not configured are told apart", async () => {
    const kind = async (res: Response) =>
      (await fail(analyzeDocument({ model: "prebuilt-receipt", bytes }, { ...base, fetchFn: (async () => res) as unknown as typeof fetch }))).kind;
    expect(await kind(new Response(null, { status: 429 }))).toBe("busy");
    expect(await kind(new Response(null, { status: 403 }))).toBe("refused");
    delete process.env.DOCINTEL_ENDPOINT;
    expect(await kind(new Response(null, { status: 202 }))).toBe("notConfigured");
  });

  it("a failed analysis and a run past the deadline both end", async () => {
    let t = 0;
    const started = () => new Response(null, { status: 202, headers: { "operation-location": `${ENDPOINT}documentintelligence/r/1` } });
    const failed = vi.fn(async (_u: unknown, init?: RequestInit) => (init?.method === "POST" ? started() : json({ status: "failed" }))) as unknown as typeof fetch;
    expect((await fail(analyzeDocument({ model: "prebuilt-receipt", bytes }, { ...base, fetchFn: failed }))).kind).toBe("failed");

    const forever = vi.fn(async (_u: unknown, init?: RequestInit) => (init?.method === "POST" ? started() : json({ status: "running" }))) as unknown as typeof fetch;
    const err = await fail(analyzeDocument(
      { model: "prebuilt-receipt", bytes },
      { ...base, fetchFn: forever, now: () => t, sleep: async (ms) => void (t += ms) },
    ));
    expect(err.kind).toBe("timeout");
  });
});

describe("parseReceipt", () => {
  const cur = (amount: number) => ({ valueCurrency: { amount } });
  const fixture = {
    documents: [
      {
        fields: {
          MerchantName: { valueString: "TARGET" },
          TransactionDate: { valueDate: "2026-10-04" },
          Total: cur(61.37),
          Items: {
            valueArray: [
              { valueObject: { Description: { valueString: "PURINA DOG FD 31.1LB" }, TotalPrice: cur(54.99) } },
              { valueObject: { Description: { valueString: "BANANAS" }, Quantity: { valueNumber: 2.34 }, Price: cur(0.59), TotalPrice: cur(1.38) } },
              { valueObject: { Description: { valueString: "GOLDFISH" }, Quantity: { valueNumber: 2 }, Price: cur(2.5), TotalPrice: cur(5.0) } },
              { valueObject: { TotalPrice: cur(1) } },
            ],
          },
        },
      },
    ],
  };

  it("reads merchant, date, total and line items in cents", () => {
    expect(parseReceipt(fixture)).toEqual({
      merchant: "TARGET",
      date: "2026-10-04",
      totalCents: 6137,
      lines: [
        { text: "PURINA DOG FD 31.1LB", quantity: null, unitCents: null, totalCents: 5499 },
        { text: "BANANAS", quantity: 2.34, unitCents: 59, totalCents: 138 },
        { text: "GOLDFISH", quantity: 2, unitCents: 250, totalCents: 500 },
      ],
    });
  });

  it("never throws on junk", () => {
    expect(parseReceipt(null)).toEqual({ merchant: null, date: null, totalCents: null, lines: [] });
    expect(parseReceipt({ documents: [{ fields: { TransactionDate: { valueDate: "Oct 4" }, Items: { valueArray: "x" } } }] }).date).toBeNull();
  });

  it("cents round the way money should", () => {
    expect(toCents(4.66)).toBe(466);
    expect(toCents(-1.5)).toBe(-150);
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(1e9)).toBeNull();
  });
});
