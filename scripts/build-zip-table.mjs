// Builds lib/zip/zcta.json, the US ZIP code centers home location uses (Phase 45.1), from the
// Census Bureau's Gazetteer ZCTA file (public domain). No download here: fetch the national
// ZCTA file yourself from https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html,
// unzip it, and pass the .txt and the address it came from:
//
//   node scripts/build-zip-table.mjs 2025_Gaz_zcta_national.txt https://www2.census.gov/…/2025_Gaz_zcta_national.zip
//
// Rows are rounded to 2 decimal places (about a kilometre), the same precision the app saves a
// home at. A rebuilt table changes its SHA-256, so scripts/check-privacy.mjs's pin must be
// updated in the same commit (it says so). Node built-ins only.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [input, source] = process.argv.slice(2);
if (!input || !source) {
  console.error("Usage: node scripts/build-zip-table.mjs <Gazetteer ZCTA .txt> <the URL it was downloaded from>");
  process.exit(1);
}

const lines = readFileSync(input, "utf8").split(/\r?\n/).filter(Boolean);
// Older vintages are tab-delimited, newer ones pipe-delimited.
const sep = lines[0].includes("|") ? "|" : "\t";
const header = lines[0].split(sep).map((h) => h.trim());
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`No ${name} column in ${input}`);
  return i;
};
const [zipAt, latAt, lonAt] = [col("GEOID"), col("INTPTLAT"), col("INTPTLONG")];

const round2 = (n) => Math.round(n * 100) / 100;
const rows = lines
  .slice(1)
  .map((line) => line.split(sep).map((v) => v.trim()))
  .map((v) => [v[zipAt], Number(v[latAt]), Number(v[lonAt])])
  .filter(([zip, lat, lon]) => /^\d{5}$/.test(zip) && Number.isFinite(lat) && Number.isFinite(lon))
  .map(([zip, lat, lon]) => [zip, round2(lat), round2(lon)])
  .sort((a, b) => a[0].localeCompare(b[0]));
if (rows.length < 30000) throw new Error(`Only ${rows.length} ZIP codes in ${input}: is it the national ZCTA file?`);

const vintage = /(\d{4})_Gaz_/.exec(basename(input))?.[1] ?? "unknown";
// One row per line, so a rebuild's diff reads as the ZIP codes that changed.
const json = `{
  "source": ${JSON.stringify(source)},
  "vintage": ${JSON.stringify(vintage)},
  "note": "US ZIP code (ZCTA) centers, rounded to 2 decimal places. Public domain, from the Census Bureau's Gazetteer files. Built by scripts/build-zip-table.mjs.",
  "rows": [
${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}
  ]
}
`;
const out = join(import.meta.dirname, "..", "lib", "zip", "zcta.json");
writeFileSync(out, json);
console.log(`Wrote ${rows.length} ZIP codes (${vintage}) to lib/zip/zcta.json`);
console.log(`SHA-256 ${createHash("sha256").update(json).digest("hex")}: update ZIP_TABLE_SHA256 in scripts/check-privacy.mjs`);
