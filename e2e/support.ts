import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * A passkey device for one page: Chromium's virtual authenticator (over CDP), a built-in one
 * that keeps its passkeys (resident keys) and says the person unlocked it (user verification),
 * as a phone's fingerprint or face would. The app checks that flag itself
 * (lib/passkey-hooks.ts), so a device that didn't set it would be refused.
 */
export async function addPasskeyDevice(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    passkeyCount: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials.length,
  };
}

/**
 * What a page did wrong while a test watched it: an uncaught error in the browser, a console
 * error, or a server error (5xx). `expectNone` fails with the list and starts a fresh one. It
 * checks what has happened so far: an error from work a page does after it has loaded can show
 * up at the next check instead, under the next page's step (each problem names its address).
 */
export function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`page error on ${page.url()}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console error on ${page.url()}: ${msg.text()}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) problems.push(`HTTP ${res.status()} from ${res.url()}`);
  });
  return {
    expectNone() {
      expect(problems, problems.join("\n")).toEqual([]);
      problems.length = 0;
    },
    /** Drops what's been seen without checking it: for a stretch that fails on purpose (offline). */
    forget() {
      problems.length = 0;
    },
  };
}

/** The app's error screen (app/(app)/error.tsx, app/global-error.tsx) or the not-found page. */
export async function expectNoErrorScreen(page: Page) {
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
}

/**
 * Phase 44.1: axe's WCAG 2.0, 2.1 and 2.2 A and AA rules plus its best practices, on the page as
 * it is now. Fails with every rule broken, the elements (up to five each) and the help link. axe
 * goes in over the browser's debugging protocol, so the page's script policy stays on (nothing
 * here or in playwright.config.ts turns off the policy; lib/e2e-guard.test.ts checks).
 */
export async function expectAccessible(page: Page, label: string) {
  // The page streams in behind app/(app)/loading.tsx's skeleton (aria-busy): check the page, not
  // the skeleton, which a slow server (the production image in CI) can still be showing.
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"])
    .analyze();
  const report = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} ${v.helpUrl}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(" ")}`).join("\n")}`,
  );
  // Soft: one run lists every page that fails, not just the first.
  expect.soft(report, `${label}\n${report.join("\n")}`).toEqual([]);
}
