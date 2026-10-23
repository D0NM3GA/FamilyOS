import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Phase 44.1: the browser tests check pages under their real script policy. Turning it off
 * (Playwright's bypassCSP) would let a page pass that the policy breaks for people; axe doesn't
 * need it, since it goes in over the browser's debugging protocol.
 */
test("no browser test turns off the script policy", () => {
  const root = path.resolve(__dirname, "..");
  const files = ["playwright.config.ts", ...fs.readdirSync(path.join(root, "e2e")).map((f) => path.join("e2e", f))];
  const offenders = files.filter((f) => /bypassCSP/.test(fs.readFileSync(path.join(root, f), "utf8")));
  expect(offenders).toEqual([]);
});
