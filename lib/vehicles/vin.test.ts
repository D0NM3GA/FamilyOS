import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkVin, cleanVin, tidyVin } from "./vin";
import { decodeVin, readDecode, resetVpic } from "./vpic";

/** Phase 53: a car from its VIN. Made-up VINs only (a valid check digit, no real car). */

const NA = "1EXAMPLE0PARKER17";

describe("checking a VIN", () => {
  it("takes a North American VIN with the right check digit, tidied", () => {
    expect(checkVin(NA)).toEqual({ ok: true, vin: NA });
    expect(checkVin(" 1example0-parker17 ")).toEqual({ ok: true, vin: NA });
    // A door-jamb barcode's leading import marker.
    expect(tidyVin(`I${NA}`)).toBe(NA);
  });

  it("refuses the wrong length, I/O/Q, and a North American VIN that doesn't add up", () => {
    expect(checkVin("1EXAMPLE0PARKER1")).toMatchObject({ ok: false, error: "A VIN is 17 characters." });
    expect(checkVin("1EXAMPLEOPARKER17")).toMatchObject({ ok: false });
    expect(checkVin("1EXAMPLE5PARKER17")).toMatchObject({ ok: false, error: expect.stringContaining("check digit") });
  });

  it("accepts a VIN from elsewhere without a check digit", () => {
    // Position 9 isn't a check digit outside North America (first character 6 and up, or a letter).
    expect(checkVin("WEXAMPLE5PARKER17")).toMatchObject({ ok: true });
    expect(checkVin("JEXAMPLE5PARKER17")).toMatchObject({ ok: true });
  });

  it("keeps only a VIN that still reads as one (a backup, an older row)", () => {
    expect(cleanVin(NA)).toBe(NA);
    expect(cleanVin("not a vin")).toBeNull();
    expect(cleanVin(null)).toBeNull();
  });
});

describe("decoding with NHTSA's vPIC", () => {
  beforeEach(() => resetVpic());
  const row = (r: Record<string, string>) => ({ Results: [r] });

  it("reads a clean decode into the form's fields", () => {
    expect(readDecode(row({ Make: "HONDA", Model: "Odyssey", ModelYear: "2019", Trim: "EX-L", DisplacementL: "3.4999", EngineCylinders: "6", FuelTypePrimary: "Gasoline", ErrorCode: "0" }))).toEqual({
      status: "ok",
      partial: false,
      make: "Honda",
      model: "Odyssey",
      year: 2019,
      trim: "EX-L",
      engine: "3.5 L, 6 cylinders, Gasoline",
    });
  });

  it("says when part of it didn't read, and when none of it did", () => {
    expect(readDecode(row({ Make: "Ford", Model: "Example", ModelYear: "", ErrorCode: "1,7" }))).toMatchObject({ status: "ok", partial: true, year: null });
    expect(readDecode(row({ Make: "", ErrorCode: "1,7,11,400" }))).toEqual({ status: "unreadable" });
  });

  it("asks NHTSA without caching, refuses a bad VIN before asking, and rests after a failure", async () => {
    const fetchFn = vi.fn(async () => Response.json(row({ Make: "Ford", Model: "Example", ModelYear: "2020", ErrorCode: "0" })));
    expect(await decodeVin(NA, fetchFn as unknown as typeof fetch)).toMatchObject({ status: "ok", make: "Ford" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${NA}?format=json`);
    expect(init.cache).toBe("no-store");

    expect(await decodeVin("short", fetchFn as unknown as typeof fetch)).toMatchObject({ status: "invalid" });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await decodeVin(NA, down as unknown as typeof fetch, 1_000)).toEqual({ status: "unavailable" });
    expect(await decodeVin(NA, fetchFn as unknown as typeof fetch, 2_000)).toEqual({ status: "unavailable" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
