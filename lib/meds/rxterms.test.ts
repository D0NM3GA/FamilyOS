import { describe, expect, it } from "vitest";
import { parseRxTermsResponse, stripDosageForm } from "./rxterms";

describe("parseRxTermsResponse", () => {
  // This exact shape is what `curl "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=tyl&maxList=5"`
  // returned live during this phase's build — index 3 is an array of ONE-ELEMENT arrays,
  // not a flat array of strings (a prior draft assumed the latter and would have silently
  // returned zero suggestions for every real query).
  const liveFixture = [
    8,
    [
      "TYLENOL WITH CODEINE (Oral Pill)",
      "TYLENOL (Oral Pill)",
      "TYLENOL (Oral Liquid)",
      "TYLENOL PM (Oral Liquid)",
      "TYLENOL PM (Oral Pill)",
    ],
    null,
    [
      ["TYLENOL WITH CODEINE (Oral Pill)"],
      ["TYLENOL (Oral Pill)"],
      ["TYLENOL (Oral Liquid)"],
      ["TYLENOL PM (Oral Liquid)"],
      ["TYLENOL PM (Oral Pill)"],
    ],
  ];

  it("extracts display names from the real nested-array response shape", () => {
    expect(parseRxTermsResponse(liveFixture)).toEqual([
      "TYLENOL WITH CODEINE (Oral Pill)",
      "TYLENOL (Oral Pill)",
      "TYLENOL (Oral Liquid)",
      "TYLENOL PM (Oral Liquid)",
      "TYLENOL PM (Oral Pill)",
    ]);
  });

  it("also tolerates a flat array of strings, in case the shape ever changes", () => {
    expect(parseRxTermsResponse([1, [], null, ["TYLENOL (Oral Pill)"]])).toEqual(["TYLENOL (Oral Pill)"]);
  });

  it("returns an empty array for a no-match response", () => {
    expect(parseRxTermsResponse([0, [], null, []])).toEqual([]);
  });

  it("returns an empty array for anything malformed rather than throwing", () => {
    expect(parseRxTermsResponse(null)).toEqual([]);
    expect(parseRxTermsResponse(undefined)).toEqual([]);
    expect(parseRxTermsResponse({})).toEqual([]);
    expect(parseRxTermsResponse([1, 2])).toEqual([]);
    expect(parseRxTermsResponse([1, [], null, "not an array"])).toEqual([]);
  });

  it("filters out malformed rows defensively", () => {
    expect(parseRxTermsResponse([1, [], null, [["ok"], [null], [5], ["also ok"], []]])).toEqual([
      "ok",
      "also ok",
    ]);
  });
});

describe("stripDosageForm", () => {
  it("removes a trailing dosage-form parenthetical", () => {
    expect(stripDosageForm("TYLENOL (Oral Pill)")).toBe("TYLENOL");
    expect(stripDosageForm("TYLENOL WITH CODEINE (Oral Pill)")).toBe("TYLENOL WITH CODEINE");
  });

  it("only strips a TRAILING parenthetical, leaving one followed by more text alone", () => {
    expect(stripDosageForm("Amoxicillin/Clavulanate (Oral Pill)")).toBe("Amoxicillin/Clavulanate");
    expect(stripDosageForm("Vitamin D (1000 IU) Extra Strength")).toBe("Vitamin D (1000 IU) Extra Strength");
  });

  it("is a no-op for a name with no parenthetical", () => {
    expect(stripDosageForm("Amoxicillin")).toBe("Amoxicillin");
  });
});
