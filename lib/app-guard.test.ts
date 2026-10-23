import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { APPS, SWITCHABLE_APPS, activeAppId, isSwitchableApp } from "./apps";

/**
 * Phase 36: every page of a switchable app, and its print pages, starts with
 * `await requireAppOn("<its app>")` (lib/app-guard.ts), so a page added later can't forget
 * it. Read from the files themselves: the folders come from each app's href, so a new
 * switchable app is covered too.
 */
const ROOT = path.resolve(__dirname, "..");

function pagesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? pagesUnder(p) : e.name === "page.tsx" ? [p] : [];
  });
}

/** [folder, app id] for each switchable app's own pages and its print pages. */
function guardedFolders(): [string, string][] {
  const own = SWITCHABLE_APPS.map((id): [string, string] => {
    const href = APPS.find((a) => a.id === id)!.href;
    return [path.join(ROOT, "app", "(app)", href.split("/")[1]), id];
  });
  const printRoot = path.join(ROOT, "app", "print");
  const prints = fs
    .readdirSync(printRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e): [string, string | null] => [path.join(printRoot, e.name), activeAppId(`/${e.name}`)])
    .filter((x): x is [string, string] => x[1] !== null && isSwitchableApp(x[1]));
  return [...own, ...prints];
}

describe("every page of a switchable app checks it's on first", () => {
  const folders = guardedFolders();

  test("finds the apps' folders and pages (the walk itself works)", () => {
    expect(folders.length).toBeGreaterThanOrEqual(SWITCHABLE_APPS.length);
    expect(folders.flatMap(([dir]) => pagesUnder(dir)).length).toBeGreaterThan(40);
  });

  test.each(folders.flatMap(([dir, app]) => pagesUnder(dir).map((file) => [path.relative(ROOT, file), app] as const)))(
    "%s calls requireAppOn(%s) before anything else",
    (file, app) => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      const body = text.slice(text.indexOf("export default async function"));
      expect(text).toContain("export default async function");
      // The first thing the page waits for is the guard, for this page's own app.
      expect(body.match(/await [^\n;]*/)?.[0]).toBe(`await requireAppOn("${app}")`);
    },
  );
});
