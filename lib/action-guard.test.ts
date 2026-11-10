import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { APPS, SWITCHABLE_APPS } from "./apps";

/**
 * Phase 61d: what every server action had by convention, checked. Read from the files, like
 * lib/app-guard.test.ts does for pages, so an action added later can't forget.
 *
 * 1. Every exported action of a "use server" file first checks who's asking: its first await is a
 *    core check, a helper in the same file whose own first await is a core check, or another
 *    exported action of the same file (a delegation). The few that run before anyone is signed
 *    in are listed, each with its reason.
 * 2. Every action of a switchable app checks the app is on (assertAppOn), in its body or in the
 *    helper it starts with, so a tab left open on an app the family turned off changes nothing.
 */
const ROOT = path.resolve(__dirname, "..");

/** Checks from lib/ that load the signed-in profile and refuse anyone else. */
const CORE = new Set(["requireActiveProfile", "requireAdult", "requireAdmin", "requireJar", "moneyViewer"]);

/** "file:action" → why it starts differently. */
const ALLOWED: Record<string, string> = {
  "app/setup/actions.ts:startSetup": "the first visitor, before anyone exists: refuses once set up",
  "app/setup/actions.ts:completeSetup": "the first visitor's own new sign-in: checks the session itself",
  "app/invite/[token]/actions.ts:startProviderInvite": "an invitee before they have a profile: the token is the check",
  "app/profiles/actions.ts:selectOwnProfile": "the profile picker: checks the sign-in itself (getAuthPerson)",
  "app/profiles/actions.ts:continueAsYourself": "the profile picker: checks the sign-in itself (getAuthPerson)",
  "app/profiles/actions.ts:verifyPinAndSelect": "the profile picker: checks the sign-in, then the PIN",
  "app/profiles/actions.ts:devSelectProfile": "development sign-in only; production refuses DEV_AUTH",
  "app/dev-preview/shell/actions.ts:previewNoop": "a design preview that does nothing (dev only)",
  "app/(app)/work-item-actions.ts:setWorkItemStatus": "routes to Chores' and School's own actions, which check",
};

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "generated") walk(p);
      } else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.") && fs.readFileSync(p, "utf8").startsWith('"use server"')) out.push(p);
    }
  };
  walk(path.join(ROOT, "app"));
  walk(path.join(ROOT, "lib"));
  return out;
}

/** A function's body: from its first "{" after the parameters to the matching "}". */
function bodyAfter(text: string, at: number): string {
  let i = text.indexOf("{", text.indexOf(")", at));
  // Skip a return type like Promise<{ ok: boolean }>: the body's "{" follows "=>" or ")" plus a type, so walk to the
  // first "{" that starts a line's statement block: the one followed by a newline.
  while (i !== -1 && text[i + 1] !== "\n") i = text.indexOf("{", i + 1);
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return text.slice(i, j + 1);
  }
  return text.slice(i);
}

const firstAwait = (body: string) => body.match(/await\s+([\w.$]+)\s*\(/)?.[1] ?? null;

function functions(text: string, exported: boolean): Map<string, string> {
  const re = exported ? /export async function (\w+)\s*\(/g : /^(?:async )?function (\w+)\s*\(/gm;
  const out = new Map<string, string>();
  for (const m of text.matchAll(re)) out.set(m[1], bodyAfter(text, m.index!));
  return out;
}

/**
 * Settings pages that work on a switchable app's data, outside its own folder: they check it's on
 * too. (Settings that only choose how an app looks, like Calendar on Home, don't.)
 */
const SETTINGS_FOR_APP: Record<string, string> = {
  "app/(app)/settings/outlook-calendars/actions.ts": "calendar",
};

/** The switchable app whose folder this file is in, if any (Garage's folder is under Cars). */
function appOf(file: string): string | null {
  const mapped = SETTINGS_FOR_APP[path.relative(ROOT, file).split(path.sep).join("/")];
  if (mapped) return mapped;
  const rel = path.relative(path.join(ROOT, "app", "(app)"), file);
  if (rel.startsWith("..")) return null;
  const folder = rel.split(path.sep)[0];
  const app = APPS.find((a) => a.href.split("/")[1] === folder && (SWITCHABLE_APPS as readonly string[]).includes(a.id));
  return app?.id ?? null;
}

const files = serverFiles();
const cases = files.flatMap((file) => {
  const text = fs.readFileSync(file, "utf8");
  const actions = functions(text, true);
  const helpers = functions(text, false);
  return [...actions].map(([name, body]) => ({ file: path.relative(ROOT, file), name, body, actions, helpers, text, app: appOf(file) }));
});

describe("server actions check who's asking, and that their app is on", () => {
  test("finds the actions (the walk itself works)", () => {
    expect(files.length).toBeGreaterThan(25);
    expect(cases.length).toBeGreaterThan(200);
  });

  test.each(cases.map((c) => [`${c.file}:${c.name}`, c] as const))("%s starts with a check", (key, c) => {
    if (ALLOWED[key]) return;
    const first = firstAwait(c.body);
    // A helper may lean on another helper (managingAdmin → signedInAdmin → requireActiveProfile).
    const checks = (name: string | null, depth = 0): boolean =>
      name !== null && (CORE.has(name) || (depth < 3 && c.helpers.has(name) && checks(firstAwait(c.helpers.get(name)!), depth + 1)));
    const ok = checks(first) || (first !== null && c.actions.has(first) && first !== c.name);
    expect(ok, `${key}: first await is ${first ?? "nothing"}`).toBe(true);
  });

  test.each(cases.filter((c) => c.app).map((c) => [`${c.file}:${c.name}`, c] as const))("%s checks its app is on", (key, c) => {
    const first = firstAwait(c.body);
    const viaHelper = first !== null && c.helpers.has(first) && c.helpers.get(first)!.includes(`assertAppOn(`);
    const viaCore = first === "requireJar" || first === "moneyViewer"; // lib/finance/access.ts asserts Money is on
    const delegates = first !== null && c.actions.has(first) && first !== c.name;
    expect(c.body.includes(`assertAppOn(`) || viaHelper || viaCore || delegates, key).toBe(true);
    if (c.body.includes("assertAppOn(")) expect(c.body).toContain(`"${c.app}")`);
  });

  test("actions are written as `export async function`, which this test reads", () => {
    for (const file of files) expect(fs.readFileSync(file, "utf8"), path.relative(ROOT, file)).not.toMatch(/export const \w+\s*=\s*async/);
  });

  test("the settings map names real files", () => {
    for (const file of Object.keys(SETTINGS_FOR_APP)) expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
  });

  test("the allowlist names real actions", () => {
    const keys = new Set(cases.map((c) => `${c.file}:${c.name}`));
    for (const key of Object.keys(ALLOWED)) expect(keys.has(key), key).toBe(true);
  });

  test("Money's check asserts the app is on", () => {
    expect(fs.readFileSync(path.join(ROOT, "lib/finance/access.ts"), "utf8")).toMatch(/assertAppOn\(profile\.householdId, "money"\)/);
  });
});
