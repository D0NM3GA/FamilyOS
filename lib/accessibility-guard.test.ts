import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Phase 44.1 (WCAG 3.3.8, accessible authentication): a PIN or a sign-in can be pasted or filled
 * by a password manager, so no field anywhere blocks pasting. Read from the source like
 * lib/forms-guard.test.ts, so a field added later can't start. It flags any paste handler; one
 * that only reads a paste (a receipt image, say) would go in an allow list here with the reason.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : filesUnder(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

test("no field blocks pasting", () => {
  const offenders = ["app", "components"]
    .flatMap((d) => filesUnder(path.join(ROOT, d)))
    .filter((f) => /\bonPaste\b|addEventListener\(\s*["']paste["']/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  expect(offenders).toEqual([]);
});
