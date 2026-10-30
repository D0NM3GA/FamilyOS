import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 57.1: every dropdown gets the app's own look from one unlayered rule in
 * app/globals.css, `select:not([multiple], [size])`, which no class can undo. The one way out of
 * it is a list box (`multiple` or `size`), which keeps the native look on purpose. So a select
 * that becomes a list box has to be listed here, with why, after checking it looks right.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : filesUnder(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

/** `file:line` for every `<select …>` opening tag that makes a list box. */
export function listBoxes(file: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<select\b[^>]*>/g)) {
    if (/\s(multiple|size)(\s|=|>|\/)/.test(m[0])) found.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
  }
  return found;
}

// List boxes that keep the native look on purpose, and why. None today.
const LIST_BOXES_OK: Record<string, string> = {};

describe("dropdowns keep the app's look", () => {
  test("the reading catches a list box, in each spelling, and not a plain select", () => {
    expect(listBoxes("f", `<select name="a" multiple>`)).toEqual(["f:1"]);
    expect(listBoxes("f", `\n<select\n  size={4}\n  name="a">`)).toEqual(["f:2"]);
    expect(listBoxes("f", `<select name="sizeUnit" className={field}>`)).toEqual([]);
    expect(listBoxes("f", `<select aria-label="Size">`)).toEqual([]);
  });

  test("no select in the app is a list box unless it's listed", () => {
    const files = [...filesUnder(path.join(ROOT, "app")), ...filesUnder(path.join(ROOT, "components"))];
    const found = files.flatMap((f) => listBoxes(path.relative(ROOT, f).split(path.sep).join("/"), fs.readFileSync(f, "utf8")));
    expect(found.filter((at) => !Object.keys(LIST_BOXES_OK).some((ok) => at.startsWith(ok)))).toEqual([]);
  });
});
