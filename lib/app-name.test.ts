import { describe, expect, it } from "vitest";
import {
  APP_NAME_MAX,
  DEFAULT_APP_NAME,
  appNameFromFamilyName,
  appNameLength,
  appNameOrDefault,
  cleanAppName,
  familyNameOf,
  wordmarkParts,
} from "./app-name";

describe("appNameFromFamilyName", () => {
  it("adds OS to the family's name", () => {
    expect(appNameFromFamilyName("Smith")).toBe("SmithOS");
    expect(appNameFromFamilyName("  The Smiths ")).toBe("The SmithsOS");
  });

  it("doesn't double an OS they typed", () => {
    expect(appNameFromFamilyName("SmithOS")).toBe("SmithOS");
    expect(appNameFromFamilyName("Smith OS")).toBe("SmithOS");
  });

  it("keeps a name that just ends in those letters", () => {
    expect(appNameFromFamilyName("Amos")).toBe("AmosOS");
  });

  it("is null (FamilyOS) for nothing, or only OS", () => {
    expect(appNameFromFamilyName("")).toBeNull();
    expect(appNameFromFamilyName("  ")).toBeNull();
    expect(appNameFromFamilyName("OS")).toBeNull();
    expect(appNameFromFamilyName(null)).toBeNull();
  });
});

describe("familyNameOf", () => {
  it("is what the family typed", () => {
    expect(familyNameOf("SmithOS")).toBe("Smith");
    expect(familyNameOf("AmosOS")).toBe("Amos");
    expect(familyNameOf(null)).toBe("");
  });

  it("round-trips through appNameFromFamilyName", () => {
    for (const typed of ["Smith", "Amos", "The Smiths", "👨‍👩‍👧 Lee"]) {
      expect(familyNameOf(appNameFromFamilyName(typed))).toBe(typed);
    }
  });
});

describe("cleanAppName", () => {
  it("trims and single-spaces", () => {
    expect(cleanAppName("  The   Smith\tHub \n")).toBe("The Smith Hub");
  });

  it("drops invisible and direction-changing characters", () => {
    expect(cleanAppName("Smith\u202EOS")).toBe("SmithOS");
    expect(cleanAppName("Sm\u200Bith\uFEFF")).toBe("Smith");
    expect(cleanAppName("Smith\u0007OS")).toBe("SmithOS");
    expect(cleanAppName("Sm\u00ADith\u061C\u180E\u034F")).toBe("Smith");
    expect(cleanAppName("Smith\u{E0041}\u{E0042}OS")).toBe("SmithOS");
  });

  it("keeps emoji joined", () => {
    expect(cleanAppName("👨‍👩‍👧 Smiths")).toBe("👨‍👩‍👧 Smiths");
  });

  it("is null when nothing is left", () => {
    expect(cleanAppName("")).toBeNull();
    expect(cleanAppName("   ")).toBeNull();
    expect(cleanAppName("\u200B")).toBeNull();
    expect(cleanAppName(null)).toBeNull();
    expect(cleanAppName(undefined)).toBeNull();
  });
});

describe("appNameOrDefault", () => {
  it("falls back to FamilyOS", () => {
    expect(appNameOrDefault(null)).toBe(DEFAULT_APP_NAME);
    expect(appNameOrDefault("  ")).toBe(DEFAULT_APP_NAME);
  });

  it("cuts a long stored name to the limit", () => {
    expect(appNameLength(appNameOrDefault("x".repeat(40)))).toBe(APP_NAME_MAX);
  });

  it("counts an emoji as one character", () => {
    expect(appNameLength("👨‍👩‍👧 Smiths")).toBe(8);
  });
});

describe("wordmarkParts", () => {
  it("accents a trailing OS", () => {
    expect(wordmarkParts("FamilyOS")).toEqual({ lead: "Family", accent: "OS" });
    expect(wordmarkParts("Smith OS")).toEqual({ lead: "Smith ", accent: "OS" });
  });

  it("shows other names whole", () => {
    expect(wordmarkParts("The Smith Hub")).toEqual({ lead: "The Smith Hub", accent: "" });
    expect(wordmarkParts("OS")).toEqual({ lead: "OS", accent: "" });
    expect(wordmarkParts("Chaos")).toEqual({ lead: "Chaos", accent: "" });
  });
});
