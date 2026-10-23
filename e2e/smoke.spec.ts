import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APPS } from "../lib/apps";
import { addPasskeyDevice, expectAccessible, expectNoErrorScreen, watchForProblems } from "./support";

/**
 * Phase 41: one made-up household's first day, in order, on a brand-new install (e2e/serve.mjs
 * makes the database fresh). Dad sets the app up with a passkey and invites Mom, who joins from
 * her own browser; every app's page opens; Dad signs out and back in. Then, signed out, the
 * doors that must stay shut. (What doesn't need the household is in e2e/doors.spec.ts.)
 *
 * The invite comes right after setup: making one needs a sign-in from the last 5 minutes
 * (lib/fresh-sign-in.ts).
 */
test.describe.configure({ mode: "serial" });

let dad: BrowserContext;
let page: Page;
let dadsDevice: Awaited<ReturnType<typeof addPasskeyDevice>>;
let problems: ReturnType<typeof watchForProblems>;

test.beforeAll(async ({ browser }) => {
  dad = await browser.newContext();
  page = await dad.newPage();
  dadsDevice = await addPasskeyDevice(page);
  problems = watchForProblems(page);
});

test.afterAll(async () => {
  await dad.close();
});

test("a new install opens on setup, which makes a passkey and signs you in", async () => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expectAccessible(page, "/setup");

  await page.getByLabel("Your household's name").fill("The Parkers");
  await page.getByLabel("Your first name").fill("Dad");
  await page.getByLabel("Your email").fill("dad@example.com");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Make the passkey" }).click();

  // Phase 45.4: straight into the guided setup, as Dad (no stop at the profile picker).
  await expect(page).toHaveURL(/\/settings\/get-started$/);
  expect(await dadsDevice.passkeyCount()).toBe(1);
  await expect(page.getByRole("heading", { name: "Let's get your family settled in, Dad." })).toBeVisible();
  await expectNoErrorScreen(page);
  problems.expectNone();
});

test("the guided setup: every step can be skipped, and what's left waits in Settings", async () => {
  await page.getByRole("button", { name: "Let's go" }).click();
  await expect(page.getByRole("heading", { name: "Household basics" })).toBeVisible();
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await page.getByRole("link", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { name: "Who's in your family?" })).toBeVisible();
  await page.getByLabel("First name").fill("Ivy");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added Ivy.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Pick your apps" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Phone and safety" })).toBeVisible();
  // Phase 43: a PIN goes through argon2's native binary, which the production image must carry.
  await page.locator('input[name="pin"]').fill("246813");
  await page.locator('input[name="again"]').fill("246813");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText("Saved. Your tile asks for it from now on.")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByText("All set!")).toBeVisible();
  const later = page.locator("section", { has: page.getByRole("heading", { name: "Left for later" }) });
  await expect(later).toContainText("Set where home is");
  await expect(later).not.toContainText("Add the kids");
  await expect(later).not.toContainText("Pick your apps");

  await page.getByRole("link", { name: "Open Settings" }).click();
  const card = page.locator("section", { has: page.getByRole("heading", { name: /done\./ }) });
  await expect(card).toContainText("Finish setting up");
  await card.getByRole("button", { name: "Hide for now" }).click();
  await expect(page.getByRole("button", { name: /Show “Finish setting up”/ })).toBeVisible();
  await page.getByRole("button", { name: /Show “Finish setting up”/ }).click();
  await expect(page.getByRole("link", { name: "Pick up where you left off" })).toBeVisible();
  problems.expectNone();
});

test("an admin invites someone new, who joins from her own browser with her own passkey", async ({ browser, baseURL }) => {
  await page.goto("/settings/sign-in");
  await page.getByLabel("First name").fill("Mom");
  await page.getByLabel("Their email").fill("mom@example.com");
  await page.getByRole("button", { name: "Make the invite link" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  // On the server's own address (its BETTER_AUTH_URL), whichever server this is.
  expect(link.startsWith(new URL("/invite/", baseURL).href), link).toBe(true);
  expect(link).toMatch(/\/invite\/[\w-]+$/);
  problems.expectNone();

  const mom = await browser.newContext();
  try {
    const momsPage = await mom.newPage();
    const momsDevice = await addPasskeyDevice(momsPage);
    const momsProblems = watchForProblems(momsPage);
    await momsPage.goto(link);
    await expect(momsPage.getByRole("heading", { name: "Hi Mom!" })).toBeVisible();
    await expectAccessible(momsPage, "an invite");
    await momsPage.getByRole("button", { name: "Make my passkey" }).click();
    await expect(momsPage).toHaveURL(/\/$/);
    await expectNoErrorScreen(momsPage);
    expect(await momsDevice.passkeyCount()).toBe(1);

    // The link worked once; now it's gone.
    await momsPage.goto(link);
    await expect(momsPage.getByText("This invite has expired or was already used")).toBeVisible();
    momsProblems.expectNone();
  } finally {
    await mom.close();
  }

  await page.reload();
  await expect(page.getByText(/Mom used an invite to sign in/)).toBeVisible();
  problems.expectNone();
});

// Every app (lib/apps.ts, so a new one is covered without touching this), a few pages beyond
// their landing pages, and every page under Settings, as the admin.
const PAGES = [
  ...new Set([
    ...APPS.map((app) => app.href),
    "/people/new",
    "/vehicles/new",
    "/groceries/shop",
    "/notifications",
    "/search?q=eggs",
    "/settings/household",
    "/settings/make-it-yours",
    "/settings/alerts",
    "/settings/apps",
    "/settings/sign-in",
    "/settings/passkeys",
    "/settings/notifications",
    // Phase 45: the hub's own pages.
    "/settings/lock-my-tile",
    "/settings/starting-views",
    "/settings/calendar-on-home",
    "/settings/get-started",
    // Phase 47: the pet's memory book (the pet itself is an app, above).
    "/pet/memories",
  ]),
];

test("every app's page opens", async () => {
  // A first visit to each page on a slow runner can take a few seconds.
  test.setTimeout(PAGES.length * 15_000);
  for (const path of PAGES) {
    await test.step(path, async () => {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      // Where it was asked for, not bounced to sign-in or the profile picker.
      expect(new URL(page.url()).pathname, path).toBe(path.split("?")[0]);
      // Next streams a page, so an error during it still answers 200: look for the screen.
      await expectNoErrorScreen(page);
      problems.expectNone();
    });
  }
});

// Phase 44.1: every page above meets WCAG 2.2 AA (and axe's best practices) in two passes: light at
// desktop width, then dark at phone width (the system setting; the app's own theme is left on
// "System"). The other two combinations add minutes and little: each theme and each layout is
// already covered. Motion is reduced (globals.css finishes every animation at once), so axe never
// measures a colour halfway through a fade-in.
test("every page is accessible, light at desktop width and dark at phone width", async () => {
  test.setTimeout(PAGES.length * 30_000);
  const desktop = page.viewportSize()!;
  try {
    for (const [scheme, size] of [
      ["light", desktop],
      ["dark", { width: 390, height: 844 }],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize(size);
      for (const path of PAGES) {
        await test.step(`${path} (${scheme}, ${size.width}px)`, async () => {
          await page.goto(path);
          await expectAccessible(page, `${path} in ${scheme} at ${size.width}px`);
        });
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: null, reducedMotion: null });
    await page.setViewportSize(desktop);
  }
  problems.expectNone();
});

// Phase 47: the pet room, which the every-page pass above only sees as the egg picker. Picking
// an egg puts the room, the care buttons and its panels on screen; axe checks each. (Hatching
// takes five minutes of wall time, so the hatched pet itself stays a manual check.)
test("an egg goes into the pet room, and the room and its panels are accessible", async () => {
  const desktop = page.viewportSize()!;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pet");
    await page.getByLabel("Name it").fill("Pip");
    await page.getByRole("button", { name: "This one!" }).click();
    await expect(page.getByRole("img", { name: /^Pip the Egg$/ })).toBeVisible();
    // The same two passes as every page above: light at desktop width, dark at phone width.
    for (const [scheme, size] of [
      ["light", desktop],
      ["dark", { width: 390, height: 844 }],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize(size);
      await page.goto("/pet");
      const where = `${scheme} at ${size.width}px`;
      await expectAccessible(page, `the pet room with an egg, ${where}`);
      await page.getByRole("button", { name: "Room" }).click();
      await expect(page.getByLabel("On the wall")).toBeVisible();
      await expectAccessible(page, `the pet room's decorating panel, ${where}`);
      await page.getByRole("button", { name: "About Pip" }).click();
      await expect(page.getByLabel("Rename")).toBeVisible();
      await expectAccessible(page, `the pet's about panel, ${where}`);
    }
  } finally {
    await page.emulateMedia({ colorScheme: null, reducedMotion: null });
    await page.setViewportSize(desktop);
  }
  problems.expectNone();
});

// Phase 42: the barcode decoder is WebAssembly; the script policy must let it compile (no camera
// needed: compiling the same file the scanner loads is what the policy governs).
test("the barcode decoder still loads under the script policy", async () => {
  const wasm = readdirSync(join(process.cwd(), "public", "zxing")).find((f) => f.endsWith(".wasm"));
  expect(wasm).toBeTruthy();
  await page.goto("/groceries");
  const compiled = await page.evaluate(async (url) => {
    await WebAssembly.compileStreaming(fetch(url));
    return true;
  }, `/zxing/${wasm}`);
  expect(compiled).toBe(true);
  problems.expectNone();
});

// Phase 45.3: Settings is a hub of tiles in groups that say who they change things for.
test("Settings is a hub, and its search narrows the tiles", async () => {
  await page.goto("/settings");
  for (const name of ["Just for you", "Family and sign-in", "Make it yours", "Connections and data"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /Household and people/ })).toContainText("no home location");

  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("pin");
  await expect(page.getByRole("link", { name: /Lock my tile/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Store order alerts/ })).toHaveCount(0);
  await search.fill("zzzz");
  await expect(page.getByText("Nothing called “zzzz” here.")).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("link", { name: /Store order alerts/ })).toBeVisible();
  problems.expectNone();
});

// Phase 45.1: home from a ZIP code or this device, never typed coordinates.
test("home location from a ZIP code, then from this device", async () => {
  await page.goto("/settings/household");
  await expect(page.getByPlaceholder("Latitude")).toHaveCount(0);
  await page.getByRole("button", { name: "Type a ZIP code instead" }).click();
  await page.getByLabel("ZIP code").fill("10001");
  await page.getByRole("button", { name: "Find it" }).click();
  await expect(page.getByText("Home would be set near ZIP 10001.")).toBeVisible();
  await page.getByRole("button", { name: "Looks right, save it" }).click();
  await expect(page.getByText("Home is set near ZIP 10001.")).toBeVisible();

  await dad.grantPermissions(["geolocation"]);
  await dad.setGeolocation({ latitude: 34.052235, longitude: -118.243683 });
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: "Use this device's location" }).click();
  await expect(page.getByText(/Home would be set near ZIP 9\d{4}, from this device/)).toBeVisible();
  await page.getByRole("button", { name: "Looks right, save it" }).click();
  await expect(page.getByText(/Home is set near ZIP 9\d{4}\./)).toBeVisible();

  // Saved to about a kilometre, and the hub's tile no longer asks for it.
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /Household and people/ })).not.toContainText("no home location");
  problems.expectNone();
});

// Whole copies only (a copy's cache exists while it's being saved; its page is written last): how
// many there are, and when the newest was saved (its name ends in the time).
const savedCopies = () =>
  page.evaluate(async () => {
    const names = (await caches.keys()).filter((k) => k.startsWith("shop-copy-"));
    const whole = (
      await Promise.all(names.map(async (n) => ((await (await caches.open(n)).match("/groceries/shop")) ? n : null)))
    ).filter((n) => n !== null);
    return { count: whole.length, newest: Math.max(0, ...whole.map((n) => Number(n.slice("shop-copy-".length)))) };
  });

// Phase 44.2: the Shop list opens with no signal, from the copy the service worker saved, and a
// tick made there syncs when the signal comes back. Late in the story, so the worker it starts
// meets only the sign-out below (which must empty the saved copy).
test("the Shop list opens without signal, and its ticks sync later", async () => {
  await page.goto("/groceries");
  await page.getByLabel("Add to the list").fill("Eggs");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Eggs").first()).toBeVisible();
  // Earlier tests opened the Shop view too: wait for a copy saved after Eggs went on the list.
  const added = await page.evaluate(() => Date.now());

  // Into the Shop view by its link, as people do: no full page load, so the page asks the worker.
  await page.getByRole("link", { name: /Shop/ }).first().click();
  await expect(page).toHaveURL(/\/groceries\/shop$/);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Both at once: older copies go just after the new one is whole.
  await expect.poll(async () => {
    const { count, newest } = await savedCopies();
    return count === 1 && newest > added;
  }).toBe(true);
  problems.expectNone();

  await dad.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByText(/The list as of .*, saved on this device/)).toBeVisible();
    await page.getByRole("button", { name: /Eggs/ }).click();
    await expect(page.getByText(/No signal · 1 to sync/)).toBeVisible();

    // Any other page offers the saved list instead of the browser's error.
    await page.goto("/chores");
    await expect(page.getByRole("heading", { name: "No signal" })).toBeVisible();
    await page.getByRole("link", { name: "Open the saved shopping list" }).click();
    await expect(page.getByText(/The list as of/)).toBeVisible();
  } finally {
    await dad.setOffline(false);
    // Offline, failed fetches and the "No signal" page's 503 are the point.
    problems.forget();
  }
  // Back online: the queued tick goes out.
  await expect(page.getByText(/to sync/)).toHaveCount(0, { timeout: 30_000 });
  await page.goto("/groceries/shop");
  await expect(page.getByText(/In the cart \(1\)/)).toBeVisible();
  problems.expectNone();
});

test("signing out, and back in with the passkey", async () => {
  await page.goto("/profiles");
  await page.getByRole("button", { name: "Not Dad? Sign out" }).click();
  await expect(page).toHaveURL(/sign-in$/);
  // Phase 44.2: the Shop list saved on this device went with the sign-in.
  expect((await savedCopies()).count).toBe(0);

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/profiles$/);
  await expect(page.getByText("Signed in as Dad")).toBeVisible();
  await expectAccessible(page, "/profiles");
  problems.expectNone();
});

test("signed out, the doors that must stay shut", async ({ browser }) => {
  const stranger = await browser.newContext();
  try {
    const p = await stranger.newPage();
    const strangersProblems = watchForProblems(p);

    // Setup is over: it can't be claimed again.
    await p.goto("/setup");
    await expect(p).toHaveURL(/sign-in$/);
    // The sign-in page offers no dev sign-in. (This build can't have one at all, lib/dev-auth.ts;
    // the refusal to start with DEV_AUTH set in production, lib/auth.ts, has no test here.)
    await expect(p.getByRole("button", { name: /Dev sign-in/ })).toHaveCount(0);
    await expectAccessible(p, "/sign-in");

    // An app's page sends you to sign in.
    await p.goto("/chores");
    await expect(p).toHaveURL(/sign-in$/);

    // A made-up invite link says it's gone, nothing more.
    await p.goto("/invite/not-a-real-invite-token");
    await expect(p.getByText("This invite has expired or was already used")).toBeVisible();
    strangersProblems.expectNone();
  } finally {
    await stranger.close();
  }
});
