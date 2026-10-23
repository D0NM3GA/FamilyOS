import { describe, expect, it } from "vitest";
import { compressUpcA, expandUpcE, normalizeBarcode } from "./barcode";

// Every length case below was verified live against world.openfoodfacts.org for the same
// real product (a Coca-Cola can) before being encoded here — see normalizeBarcode's own
// doc comment for the exact lookups and canonical `code` values that came back.
describe("normalizeBarcode", () => {
  it("pads a 9-15 digit code to Open Food Facts' 13-digit canonical form", () => {
    expect(normalizeBarcode("9000006346")).toBe("0009000006346"); // 10
    expect(normalizeBarcode("49000006346")).toBe("0049000006346"); // 11
    expect(normalizeBarcode("049000006346")).toBe("0049000006346"); // 12
    expect(normalizeBarcode("0049000006346")).toBe("0049000006346"); // 13 — unchanged
    expect(normalizeBarcode("00049000006346")).toBe("0049000006346"); // 14
    expect(normalizeBarcode("000049000006346")).toBe("0049000006346"); // 15
  });

  it("leaves a genuine 8-digit EAN-8 unchanged — Open Food Facts does NOT zero-pad it to 13", () => {
    expect(normalizeBarcode("40170725")).toBe("40170725");
  });

  it("strips spaces and hyphens before checking length", () => {
    expect(normalizeBarcode("049-000-006346")).toBe("0049000006346");
    expect(normalizeBarcode("0490 0000 6346")).toBe("0049000006346");
  });

  it("rejects anything shorter than the smallest real barcode format (EAN-8)", () => {
    expect(normalizeBarcode("1234567")).toBeNull(); // 7 digits
    expect(normalizeBarcode("1")).toBeNull();
  });

  it("returns null for empty or non-digit input", () => {
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode("   ")).toBeNull();
    expect(normalizeBarcode("abc")).toBeNull();
  });
});

// Phase 10.5. Expected expansions from the GS1 UPC-E rules; the Diet Coke pair was checked
// live against Open Food Facts (both forms exist there as separate products).
describe("expandUpcE", () => {
  it.each([
    ["04965802", "049000006582"], // last digit 0-2: Diet Coke
    ["04252614", "042100005264"], // last digit 0-2
    ["01234565", "012345000065"], // last digit 5-9
    ["01234531", "012300000451"], // last digit 3
    ["01234543", "012340000053"], // last digit 4
  ])("%s -> %s", (upcE, upcA) => {
    expect(expandUpcE(upcE)).toBe(upcA);
  });

  it("returns null when the check digit is wrong (so it isn't a UPC-E)", () => {
    expect(expandUpcE("04965803")).toBeNull();
  });

  it("only handles number system 0; a typed 1xxxxxxx stays an EAN-8", () => {
    expect(expandUpcE("14965802")).toBeNull();
    expect(normalizeBarcode("14965802")).toBe("14965802");
  });

  it("rejects digit patterns GS1 forbids, even with a matching check digit", () => {
    // Last digit 3 needs the third digit to be 3-9 (0-2 would use the shorter pattern).
    // 0 121 00000 45 has check digit 3, so only the pattern rule rejects it.
    expect(expandUpcE("01214533")).toBeNull();
    expect(normalizeBarcode("01214533")).toBe("01214533");
  });
});

describe("normalizeBarcode with compressed UPC-E", () => {
  it("expands a typed UPC-E to the same 13 digits the camera reports", () => {
    expect(normalizeBarcode("04965802")).toBe("0049000006582");
    expect(normalizeBarcode("049000006582")).toBe("0049000006582");
  });

  it("keeps an 8-digit code that isn't a valid UPC-E as EAN-8", () => {
    expect(normalizeBarcode("04965803")).toBe("04965803");
    expect(normalizeBarcode("40170725")).toBe("40170725");
  });
});

describe("compressUpcA", () => {
  it.each(["049000006582", "042100005264", "012345000065", "012300000451", "012340000053"])("round-trips %s", (upcA) => {
    const upcE = compressUpcA(upcA);
    expect(upcE).not.toBeNull();
    expect(expandUpcE(upcE!)).toBe(upcA);
    expect(compressUpcA(`0${upcA}`)).toBe(upcE); // the 13-digit canonical form too
  });

  it("returns null for a code with no compressed form", () => {
    expect(compressUpcA("0012345678905")).toBeNull();
    expect(compressUpcA("4006381333931")).toBeNull(); // an EAN-13 outside number system 0
  });
});
