import { expect, test } from "@playwright/test";

/**
 * Phase 41: what holds whether or not anyone has set the app up, so it's reported even when the
 * household story (e2e/smoke.spec.ts, serial) stops early.
 */

test("routes that are off answer 404", async ({ request }) => {
  // Better Auth routes the app turned off (lib/auth.ts disabledPaths); the dev sign-in, which a
  // production build never has (lib/dev-auth.ts); a dev-only preview page.
  const posts = ["/api/auth/get-access-token", "/api/auth/refresh-token", "/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/dev/sign-in"];
  for (const path of posts) expect((await request.post(path, { data: {} })).status(), path).toBe(404);
  for (const path of ["/api/auth/passkey/list-user-passkeys", "/dev-preview/shell"]) expect((await request.get(path)).status(), path).toBe(404);
});

test("every response carries the security headers", async ({ request }) => {
  // A page, an API route and a static file (next.config.ts sets them on every path).
  for (const path of ["/sign-in", "/api/auth/ok", "/sw.js"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("object-src 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("same-origin");
    expect(headers["permissions-policy"], path).toContain("camera=(self)");
    // Contains, not equals: behind a reverse proxy that sets its own, the two are joined.
    expect(headers["strict-transport-security"], path).toContain("max-age=31536000");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

// Phase 43: the home screen icon reads public/icons at run time (lib/app-icon.tsx), which the
// production image's standalone server only has because all of public/ is copied in.
test("the icon is drawn from the app's own files", async ({ request }) => {
  const res = await request.get("/icon");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});

// Phase 42: pages carry the script policy with a fresh nonce (proxy.ts, lib/security/csp.ts).
test("pages carry a script policy with a fresh nonce", async ({ request }) => {
  const policyOf = async () => (await request.get("/sign-in")).headers()["content-security-policy"] ?? "";
  const first = await policyOf();
  expect(first).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(first).toContain("object-src 'none'");
  const nonce = (p: string) => /'nonce-([^']+)'/.exec(p)?.[1];
  expect(nonce(await policyOf())).not.toBe(nonce(first));
});
