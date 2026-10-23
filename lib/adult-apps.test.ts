import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { APPS, activeAppId, isAdultOnlyApp } from "./apps";

/**
 * The grown-up apps (`adultOnly` in lib/apps.ts) refuse a kid on the server, not just in the
 * nav: every page starts with requireAppOn for a grown-up app (lib/app-guard.ts sends a kid
 * home), every server action's first wait is an adult check, and every download checks for an
 * adult. Read from the files themselves, like lib/app-guard.test.ts, so a page or action added
 * later can't forget it. The folders come from each app's href, so a new grown-up app is
 * covered too.
 *
 * Settings is left out on purpose: a kid opens it for their own card (theme, PIN, passkeys),
 * and its grown-up pieces check isAdult / isAdmin themselves.
 */
const ROOT = path.resolve(__dirname, "..");
const NOT_CHECKED = new Set(["settings"]);

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p, keep) : keep(e.name) ? [p] : [];
  });
}

/** Each grown-up app's own folder, and the print folders that belong to one. */
function adultFolders(): string[] {
  const own = APPS.filter((a) => a.adultOnly && !NOT_CHECKED.has(a.id)).map((a) => path.join(ROOT, "app", "(app)", a.href.split("/")[1]));
  const printRoot = path.join(ROOT, "app", "print");
  const prints = fs
    .readdirSync(printRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isAdultOnlyApp(activeAppId(`/${e.name}`) ?? ""))
    .map((e) => path.join(printRoot, e.name));
  return [...new Set([...own, ...prints])];
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const folders = adultFolders();
const pages = folders.flatMap((d) => filesUnder(d, (n) => n === "page.tsx")).map(rel);
const actionFiles = folders
  .flatMap((d) => filesUnder(d, (n) => n.endsWith(".ts")))
  .filter((f) => /^["']use server["'];/m.test(fs.readFileSync(f, "utf8")))
  .map(rel);
const routes = folders.flatMap((d) => filesUnder(d, (n) => n === "route.ts")).map(rel);

/** Each exported async function in a "use server" file: its name and body (to the next export). */
function exportedActions(text: string): { name: string; body: string }[] {
  const starts = [...text.matchAll(/^export (?:async function (\w+)|const (\w+) = async\b)/gm)];
  return starts.map((m, i) => ({ name: m[1] ?? m[2], body: text.slice(m.index, starts[i + 1]?.index ?? text.length) }));
}

/** The adult checks an action may start with: requireAdult, or Money's own (adults on their own sign-in). */
const ADULT_CHECK = /^await (requireAdult|requireAdmin|requireJar|moneyViewer)\(/;

describe("the grown-up apps refuse a kid on the server", () => {
  test("finds the apps' folders, pages, actions and downloads (the walk itself works)", () => {
    for (const app of ["money", "cars", "garage", "data"]) expect(isAdultOnlyApp(app)).toBe(true);
    expect(folders.map(rel)).toEqual(expect.arrayContaining(["app/(app)/finances", "app/(app)/vehicles", "app/(app)/data", "app/print/vehicles"]));
    expect(pages.length).toBeGreaterThan(20);
    expect(actionFiles.length).toBeGreaterThanOrEqual(4);
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  test.each(pages)("%s starts with requireAppOn for a grown-up app", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const body = text.slice(text.indexOf("export default async function"));
    const guard = body.match(/await requireAppOn\("(\w+)"\)/);
    // The first thing the page waits for is the guard, and the app it names is grown-ups only.
    expect(body.match(/await [^\n;]*/)?.[0]).toBe(guard?.[0]);
    expect(isAdultOnlyApp(guard![1])).toBe(true);
  });

  test.each(actionFiles)("every action in %s checks for an adult first", (file) => {
    const actions = exportedActions(fs.readFileSync(path.join(ROOT, file), "utf8"));
    expect(actions.length).toBeGreaterThan(0);
    const unchecked = actions.filter(({ body }) => !ADULT_CHECK.test(body.match(/await [^\n;]*/)?.[0] ?? "")).map((a) => a.name);
    expect(unchecked).toEqual([]);
  });

  test.each(routes)("%s checks for an adult", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    // Every CSV download goes through serveCsvExport, which authorizes an adult itself.
    expect(/authorizeExport\(request, "(adult|admin)"\)|serveCsvExport\(/.test(text)).toBe(true);
  });
});
