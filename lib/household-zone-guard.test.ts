import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 49: the server's clock follows the household's zone at run time (lib/household-zone.ts),
 * so nothing may fix a zone or a date when a module loads: an `Intl.DateTimeFormat` made once
 * keeps the zone it was made in, and a date worked out at load keeps the day the server started.
 * Read from the files themselves, like lib/forms-guard.test.ts. Functions (`= (…) =>`) are fine.
 */
const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.") ? [p] : [];
  });
}

/** A top-level binding whose value (not a function) is made from the clock or a formatter. */
const FIXED_AT_LOAD = /^(?:export )?(?:const|let|var) \w+(?:: [^=]+)? = (?!\(|async |function|\w+ =>)[^\n]*(?:Intl\.DateTimeFormat\(|new Date\(|Date\.now\(\))/;

describe("nothing keeps a zone or a date from when the server started", () => {
  test("no module-level formatter or date", () => {
    const files = ["lib", "app", "components"].flatMap(sourceFiles).concat(["proxy.ts", "instrumentation.ts"]);
    const offenders = files.flatMap((f) =>
      fs
        .readFileSync(path.join(ROOT, f), "utf8")
        .split("\n")
        .flatMap((line, i) => (FIXED_AT_LOAD.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  test("the check catches what it's for", () => {
    expect(FIXED_AT_LOAD.test("const CURRENT_YEAR = new Date().getFullYear();")).toBe(true);
    expect(FIXED_AT_LOAD.test('export const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });')).toBe(true);
    expect(FIXED_AT_LOAD.test("const toDay = (ms: number) => new Date(ms).toISOString();")).toBe(false);
  });
});
