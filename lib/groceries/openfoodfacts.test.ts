import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupBarcode } from "./openfoodfacts";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("lookupBarcode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns Open Food Facts' own canonical code, not the caller's input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "success",
          code: "049000006346",
          product: { code: "0049000006346", product_name: "Coca-Cola", brands: "Coca-Cola", image_url: null, quantity: "12 fl oz" },
        }),
      ),
    );

    const result = await lookupBarcode("049000006346");
    expect(result?.barcode).toBe("0049000006346");
    expect(result?.name).toBe("Coca-Cola");
    expect(result?.quantity).toBe("12 fl oz");
  });

  it("asks every Open Facts database, so pet food can match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "failure" }));
    vi.stubGlobal("fetch", fetchMock);
    await lookupBarcode("0038100175625");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v3/product/0038100175625?product_type=all");
  });

  it("falls back to the caller's input if OFF's response is missing `code`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ status: "success", product: { product_name: "Mystery Item" } }),
      ),
    );

    const result = await lookupBarcode("12345678");
    expect(result?.barcode).toBe("12345678");
  });

  it("returns null when OFF reports no match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "failure", result: { id: "product_not_found" } })));
    expect(await lookupBarcode("00000000000000")).toBeNull();
  });

  it("returns null on a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    expect(await lookupBarcode("123")).toBeNull();
  });

  it("returns null rather than throwing on a network failure or timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network hiccup")));
    expect(await lookupBarcode("123")).toBeNull();
  });

  it("returns null for an empty barcode without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await lookupBarcode("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
