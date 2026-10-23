import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Phase 44.2: signing out must also drop the Shop list saved on the device, so every sign-out
 * goes through lib/auth-client.ts's signOut. Read from the source, like lib/forms-guard.test.ts,
 * so a sign-out button added later can't call Better Auth's own.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" || e.name === "node_modules" ? [] : filesUnder(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test("no code signs out around lib/auth-client.ts's signOut", () => {
  const files = ["app", "components", "lib"].flatMap((d) => filesUnder(path.join(ROOT, d)));
  const offenders = files
    .map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }))
    .filter(({ file }) => file !== "lib/auth-client.ts")
    .filter(({ text }) =>
      /authClient\s*\.\s*signOut\b|\{[^}]*\bsignOut\b[^}]*\}\s*=\s*authClient|\/api\/auth\/sign-out/.test(text),
    )
    .map(({ file }) => file);
  expect(offenders).toEqual([]);
});

test("the client's signOut clears the saved copies before signing out", () => {
  const text = fs.readFileSync(path.join(ROOT, "lib", "auth-client.ts"), "utf8");
  const body = text.slice(text.indexOf("export async function signOut"));
  expect(body.indexOf("clearSavedCopies()")).toBeGreaterThan(-1);
  expect(body.indexOf("clearSavedCopies()")).toBeLessThan(body.indexOf("authClient.signOut()"));
});
