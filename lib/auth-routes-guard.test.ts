import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 67a: Better Auth routes the app does itself, with its own checks, stay switched off. Read
 * from lib/auth.ts (importing it needs the server's settings). On a Better Auth upgrade, check its
 * route list again (the comment above disabledPaths says how).
 */
const source = fs.readFileSync(path.join(__dirname, "auth.ts"), "utf8");
const disabled = source.slice(source.indexOf("disabledPaths: ["), source.indexOf("],", source.indexOf("disabledPaths: [")));

describe("Better Auth routes left off", () => {
  test.each([
    // Raw Microsoft tokens to any cookie holder (the security remediation phase).
    "/get-access-token",
    "/refresh-token",
    // Phase 67a: sessions are listed and signed out in Settings → Where I'm signed in.
    "/list-sessions",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    // Phase 40.2a: passkeys are managed in Settings → My passkeys.
    "/passkey/list-user-passkeys",
    "/passkey/delete-passkey",
  ])("%s", (route) => {
    expect(disabled).toContain(`"${route}"`);
  });
});
