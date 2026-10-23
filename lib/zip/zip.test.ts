import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkHomePoint, checkHomeZip, lookupZip, nearestZip, roundToKilometre } from "./index";
import table from "./zcta.json";

const ROOT = path.resolve(__dirname, "../..");

describe("the ZIP table", () => {
  test("has every ZIP code once, sorted, at 2 decimal places", () => {
    const rows = table.rows as [string, number, number][];
    expect(rows.length).toBeGreaterThan(30000);
    const zips = rows.map((r) => r[0]);
    expect(new Set(zips).size).toBe(zips.length);
    expect([...zips].sort()).toEqual(zips);
    for (const [zip, lat, lon] of rows) {
      expect(zip).toMatch(/^\d{5}$/);
      expect(Math.round(lat * 100) / 100).toBe(lat);
      expect(Math.round(lon * 100) / 100).toBe(lon);
    }
  });

  test("is only ever imported by lib/zip/index.ts, which is server-only", () => {
    const files = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return ["node_modules", "generated", ".next"].includes(e.name) ? [] : files(p);
        return /\.(ts|tsx|mjs)$/.test(e.name) ? [p] : [];
      });
    const importers = ["app", "components", "lib"]
      .flatMap((d) => files(path.join(ROOT, d)))
      .filter((f) => /zcta\.json/.test(fs.readFileSync(f, "utf8")) && !f.endsWith(".test.ts"))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
    expect(importers).toEqual(["lib/zip/index.ts"]);
    expect(fs.readFileSync(path.join(ROOT, "lib/zip/index.ts"), "utf8")).toMatch(/^import "server-only";/);
    // And nothing a browser loads imports lib/zip.
    const clientFiles = ["app", "components"]
      .flatMap((d) => files(path.join(ROOT, d)))
      .filter((f) => /^["']use client["']/m.test(fs.readFileSync(f, "utf8")));
    for (const f of clientFiles) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/from ["']@\/lib\/zip["']/);
  });
});

describe("home location", () => {
  test("rounds to about a kilometre", () => {
    expect(roundToKilometre(40.712776)).toBe(40.71);
    expect(roundToKilometre(-74.005974)).toBe(-74.01);
  });

  test("a typed ZIP code gives its center", () => {
    const first = (table.rows as [string, number, number][])[0];
    expect(lookupZip(first[0])).toEqual({ zip: first[0], latitude: first[1], longitude: first[2] });
    expect(lookupZip(` ${first[0]} `)?.zip).toBe(first[0]);
    expect(lookupZip("1234")).toBeNull();
    expect(lookupZip("abcde")).toBeNull();
  });

  test("a ZIP code with no center is told apart from a typo", () => {
    expect(checkHomeZip("00000")).toEqual({ ok: false, reason: "unknownZip" });
    expect(checkHomeZip("12")).toEqual({ ok: false, reason: "invalid" });
    expect(checkHomeZip(12345)).toEqual({ ok: false, reason: "invalid" });
  });

  test("a phone's point is rounded and named by its nearest ZIP code", () => {
    const [zip, lat, lon] = (table.rows as [string, number, number][])[1000];
    const check = checkHomePoint(lat + 0.001234, lon - 0.004321);
    expect(check).toEqual({ ok: true, nearZip: zip, latitude: roundToKilometre(lat + 0.001234), longitude: roundToKilometre(lon - 0.004321) });
    expect(nearestZip(lat, lon)).toEqual({ zip, km: 0 });
  });

  test("a point outside the US is refused, not saved", () => {
    expect(checkHomePoint(51.5, -0.12)).toEqual({ ok: false, reason: "outside" }); // London
    expect(checkHomePoint(0, 0)).toEqual({ ok: false, reason: "outside" }); // Gulf of Guinea
  });

  test("bad input is refused", () => {
    expect(checkHomePoint(91, 0)).toEqual({ ok: false, reason: "invalid" });
    expect(checkHomePoint(Number.NaN, 0)).toEqual({ ok: false, reason: "invalid" });
    expect(checkHomePoint("40", "-74")).toEqual({ ok: false, reason: "invalid" });
  });
});
