import { describe, expect, it, vi } from "vitest";
import { lookupWithUpcEFallback } from "./off-lookup";

const product = (barcode: string) => ({ barcode, name: "Diet Coke", brand: null, imageUrl: null, quantity: null });

describe("lookupWithUpcEFallback", () => {
  it("uses the canonical code's hit as-is", async () => {
    const lookup = vi.fn(async (code: string) => (code === "0049000006582" ? product("0049000006582") : null));
    expect(await lookupWithUpcEFallback("0049000006582", lookup)).toMatchObject({ barcode: "0049000006582" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("retries under the compressed UPC-E and stores the expanded code", async () => {
    const lookup = vi.fn(async (code: string) => (code === "04965802" ? product("04965802") : null));
    const hit = await lookupWithUpcEFallback("0049000006582", lookup);
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(["0049000006582", "04965802"]);
    expect(hit).toMatchObject({ barcode: "0049000006582", name: "Diet Coke" });
  });

  it("doesn't retry a code with no compressed form", async () => {
    const lookup = vi.fn(async () => null);
    expect(await lookupWithUpcEFallback("0012345678905", lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
