import { readdirSync } from "node:fs";
import { join } from "node:path";
import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { APPS } from "../lib/apps";
import { lookOf } from "../lib/looks";
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

  // Phase 58: the walkthrough's own step: tried on here, put back by moving on without keeping it.
  await expect(page.getByRole("heading", { name: "Your look" })).toBeVisible();
  const root = page.locator("[data-app-root]");
  await page.locator('input[name="look"][value="brut"]').check({ force: true });
  await expect(root).toHaveAttribute("data-look", "brut");
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(root).toHaveAttribute("data-look", "sticker");

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
    "/calendar?view=month",
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
    // Phase 54: the collection book (before any pet hatches, so its empty state).
    "/pet/book",
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
          // Nothing widens the page: something hidden escaping its box shows on the document,
          // anything else too wide on main, which does the scrolling.
          const extra = await page.evaluate(() => {
            const main = document.getElementById("main")!;
            return [document.documentElement.scrollWidth - innerWidth, main.scrollWidth - main.clientWidth];
          });
          expect(extra, `${path} width`).toEqual([0, 0]);
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
// an egg puts the room, the care buttons and its panels on screen; axe checks each. Phase 56:
// a few taps hatch the egg, so the hatched pet and its first decoration get checked too.
test("an egg is tapped open in the pet room, and the room and its panels are accessible", async () => {
  const desktop = page.viewportSize()!;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pet");
    await page.getByLabel("Name it").fill("Pip");
    await page.getByRole("button", { name: "This one!" }).click();
    await expectAccessible(page, "the pet room with an egg");
    for (let left = 5; left > 0; left--) {
      await page.getByRole("button", { name: `Tap the egg to help it hatch, ${left} more` }).click();
    }
    await page.getByRole("button", { name: "Yay!" }).click();
    await expect(page.getByRole("img", { name: /^Pip the / })).toBeVisible();
    // The same two passes as every page above: light at desktop width, dark at phone width.
    for (const [scheme, size] of [
      ["light", desktop],
      ["dark", { width: 390, height: 844 }],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize(size);
      await page.goto("/pet");
      const where = `${scheme} at ${size.width}px`;
      await expectAccessible(page, `the pet room, ${where}`);
      await page.getByRole("button", { name: "Room" }).click();
      const plant = page.getByRole("combobox", { name: /Potted plant/ });
      await expect(plant).toBeVisible();
      if (scheme === "light") {
        // Phase 56.1: a real drag, by the pointer, from the toy box onto the shelf, then by the
        // plant itself in the room down onto the floor. Tall enough to see the room and the box.
        await page.setViewportSize({ width: size.width, height: 1300 });
        const main = page.locator("main");
        await expect.poll(() => main.evaluate((el) => el.clientHeight)).toBeGreaterThan(1000);
        await main.evaluate((el) => el.scrollTo(0, 0));
        // Measured afresh for each move, so the test can't pass on a room that has shifted.
        const room = page.locator('svg[viewBox="0 0 400 260"]');
        const at = async (x: number, y: number) => {
          const box = (await room.boundingBox())!;
          return [box.x + (x / 400) * box.width, box.y + (y / 260) * box.height] as const;
        };
        const roomTop = (await room.boundingBox())!.y;
        const tray = (await page.getByTitle("Drag the potted plant into the room").boundingBox())!;
        await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2);
        await page.mouse.down();
        await page.mouse.move(...(await at(330, 60)), { steps: 8 });
        await page.mouse.up();
        await expect(plant).toHaveValue("shelf");
        // Picking it up didn't scroll the page (focus stays put while dragging).
        expect((await room.boundingBox())!.y).toBe(roomTop);
        // The pot's middle, on the shelf (it stands at y 93; the pot is its bottom 16).
        await page.mouse.move(...(await at(335, 85)));
        await page.mouse.down();
        await page.mouse.move(...(await at(120, 220)), { steps: 8 });
        await page.mouse.up();
        await expect(plant).toHaveValue("floor");
        await page.setViewportSize(size);
      }
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
test("a look is tried on over the real page, and only Keep it saves it", async () => {
  await page.goto("/settings");
  const root = page.locator("[data-app-root]");
  const startColor = await root.getAttribute("data-color");
  const sheet = page.getByRole("dialog", { name: "My look" });

  await page.getByRole("button", { name: "My look" }).click();
  await expect(sheet.getByRole("heading", { name: "My look" })).toBeFocused();
  await expectAccessible(page, "the look sheet");

  // Trying it on changes the page, and Put it back undoes it.
  await sheet.getByText("Ocean").click();
  await expect(root).toHaveAttribute("data-color", "ocean");
  await sheet.getByRole("button", { name: "Put it back" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "My look" })).toBeFocused();
  await expect(root).toHaveAttribute("data-color", startColor!);

  // Escape puts it back too, and nothing was saved.
  await page.getByRole("button", { name: "My look" }).click();
  await sheet.getByText("Ocean").click();
  await page.keyboard.press("Escape");
  await expect(root).toHaveAttribute("data-color", startColor!);
  await page.reload();
  await expect(root).toHaveAttribute("data-color", startColor!);

  // Keep it saves for this person, and the bar's color and the browser's follow.
  await page.getByRole("button", { name: "My look" }).click();
  await sheet.getByText("Ocean").click();
  await sheet.getByRole("button", { name: "Keep it" }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(root).toHaveAttribute("data-color", "ocean");
  await expect(page.locator("header").first()).toHaveCSS("background-color", /^rgb\(29, 79, 122\)|^rgb\(12, 29, 46\)/);
  await expect(page.locator("#theme-color-override")).toHaveAttribute("content", /^#(1d4f7a|0c1d2e)$/);

  // Back to the family's color for the tests after this one.
  await page.getByRole("button", { name: "My look" }).click();
  await sheet.locator(`input[name="color"][value="${startColor}"]`).check({ force: true });
  await sheet.getByRole("button", { name: "Keep it" }).click();
  await expect(sheet).toBeHidden();
  problems.expectNone();
});

/** WCAG contrast of two computed colors, either rgb() or srgb color(). */
function contrastOf(a: string, b: string): number {
  const luminance = (css: string) => {
    const parts = css.match(/[\d.]+/g)!.map(Number);
    const [r, g, b2] = css.startsWith("color(") ? parts : parts.slice(0, 3).map((n) => n / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b2);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [look, color, face] of [
  ["brut", "banana", "spaceGrotesk"],
  ["goth", "oxblood", "spectral"],
  ["synth", "outrun", "exo"],
  ["kawaii", "ramune", "mplus"],
  ["acanthus", "leicester", "garamond"],
  ["vapor", "cobalt", "plex"],
]) {
  test(`${look} holds up on real pages, day and night`, async () => {
    test.setTimeout(4 * 60_000); // Seven pages, twice over, each with an accessibility run.
    const shots = process.env.E2E_SHOTS; // a folder to save screenshots in, for a person to look at
    const root = page.locator("[data-app-root]");
    const start = { look: await root.getAttribute("data-look"), color: await root.getAttribute("data-color") };
    const sheet = page.getByRole("dialog", { name: "My look" });
    const wear = async (id: string, colorId: string) => {
      await page.goto("/settings");
      await page.getByRole("button", { name: "My look" }).click();
      await sheet.locator(`input[name="look"][value="${id}"]`).check({ force: true });
      await sheet.locator(`input[name="color"][value="${colorId}"]`).check({ force: true });
      const keep = sheet.getByRole("button", { name: "Keep it" });
      if (await keep.count()) await keep.click();
      else await sheet.getByRole("button", { name: "Done" }).click();
      await expect(sheet).toBeHidden();
      await expect(root).toHaveAttribute("data-look", id);
    };
    const desktop = page.viewportSize()!;
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await wear(look, color);
      // The look's own stylesheet really applied, not only its colors.
      expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--face-body"))).toContain(face);
      // Its voice sits beside the app's plain words, which stay as they are.
      await page.goto("/chores");
      await expect(page.locator(".ui-kicker").first()).toHaveText(lookOf(look).voice!.kickers.chores);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Chores");
      // Its font files really load: the Latin face, and the Latin Extended one for an accented name.
      const faces = await page.evaluate(async (family) => {
        const load = async (text: string) => (await document.fonts.load(`16px ${family}`, text)).map((f) => f.unicodeRange);
        return { latin: await load("Aa"), extended: await load("\u0141") };
      }, face);
      expect(faces.latin.length, `${face} Latin`).toBeGreaterThan(0);
      expect(faces.extended.some((range) => range.includes("U+100-2BA")), `${face} Latin Extended`).toBe(true);
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate((s) => localStorage.setItem("theme", s), scheme);
        // What axe can't reach without an error on the page: error text, and the bell's badge.
        await page.goto("/");
        const inks = await page.evaluate(() => {
          const host = document.querySelector("[data-app-root]")!;
          const probe = (cls: string) => {
            const el = document.createElement("span");
            el.className = cls;
            host.append(el);
            const { color, backgroundColor } = getComputedStyle(el);
            el.remove();
            return { color, backgroundColor };
          };
          const card = probe("bg-card").backgroundColor;
          return { errorText: [probe("text-tomato").color, card], badge: [probe("bg-tomato text-ink").color, probe("bg-tomato").backgroundColor] };
        });
        expect(contrastOf(inks.errorText[0], inks.errorText[1]), `${look} ${scheme} error text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastOf(inks.badge[0], inks.badge[1]), `${look} ${scheme} badge`).toBeGreaterThanOrEqual(4.5);
        for (const path of ["/", "/chores", "/chores/new", "/groceries", "/finances", "/calendar", "/settings", "/settings/make-it-yours"]) {
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          await expect(root).toHaveAttribute("data-look", look);
          await expectAccessible(page, `${look} ${scheme} ${path}`);
          if (shots) await page.screenshot({ path: `${shots}/${look}-${scheme}${path.replace(/\//g, "-")}.png` });
        }
      }
      // The look's other colors, which change its art and glow too, on a busy page and Home.
      const others = lookOf(look).colors.map((c) => c.id).filter((id) => id !== color);
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate((s) => localStorage.setItem("theme", s), scheme);
        for (const path of ["/", "/chores"]) {
          await page.goto(path);
          for (const other of others) {
            await root.evaluate((el, id) => el.setAttribute("data-color", id), other);
            await page.waitForLoadState("networkidle");
            await expectAccessible(page, `${look} ${other} ${scheme} ${path}`);
            if (shots) await page.screenshot({ path: `${shots}/${look}-${other}-${scheme}${path.replace(/\//g, "-")}.png` });
          }
        }
      }
      // The phone: the bottom bar, the scene and a long name's room.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, `${look} phone`);
      // The app's name fits beside the bar's buttons.
      const mark = page.locator(".ui-wordmark");
      expect(await mark.evaluate((el) => el.scrollWidth - el.clientWidth), `${look} phone name`).toBeLessThanOrEqual(0);
      if (shots) await page.screenshot({ path: `${shots}/${look}-phone.png` });
      // Big buttons' larger labels still sit apart on the bottom bar.
      await root.evaluate((el) => el.setAttribute("data-view", "BIG"));
      const labels = await page.locator(".ui-bottom-bar a").evaluateAll((links) =>
        links.map((link) => {
          const range = document.createRange();
          range.selectNodeContents(link);
          const { left, right } = range.getBoundingClientRect();
          return { left, right };
        }),
      );
      for (const [i, label] of labels.slice(1).entries()) {
        expect(label.left, `${look} Big buttons bar label ${i + 1}`).toBeGreaterThanOrEqual(labels[i].right);
      }
      await page.setViewportSize(desktop);
      // Forced colors: no art, and buttons and the selected filter keep a mark of their own.
      await page.emulateMedia({ forcedColors: "active" });
      await page.goto("/chores");
      await page.waitForLoadState("networkidle");
      const forced = await page.evaluate(() => {
        const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        return {
          art: css("[data-app-root]").backgroundImage,
          button: css(".ui-btn").borderTopStyle,
          selected: css(".ui-chip[aria-current]").outlineStyle,
          nav: css(".ui-rail a[aria-current]").outlineStyle,
        };
      });
      expect(forced, `${look} forced colors`).toEqual({ art: "none", button: "solid", selected: "solid", nav: "solid" });
    } finally {
      // Whatever happened, the tests after this one don't wear a look.
      await page.setViewportSize(desktop);
      await page.evaluate(() => localStorage.removeItem("theme"));
      await page.emulateMedia({ reducedMotion: null, forcedColors: null });
      await wear(start.look!, start.color!);
    }
    problems.expectNone();
  });
}

test("finishing a chore is marked by the look, and takes no taps", async () => {
  test.setTimeout(3 * 60_000);
  const shots = process.env.E2E_SHOTS;
  const root = page.locator("[data-app-root]");
  const start = { look: await root.getAttribute("data-look"), color: await root.getAttribute("data-color") };
  const sheet = page.getByRole("dialog", { name: "My look" });
  const wear = async (id: string, colorId: string) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "My look" }).click();
    await sheet.locator(`input[name="look"][value="${id}"]`).check({ force: true });
    await sheet.locator(`input[name="color"][value="${colorId}"]`).check({ force: true });
    const keep = sheet.getByRole("button", { name: "Keep it" });
    if (await keep.count()) await keep.click();
    else await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(root).toHaveAttribute("data-look", id);
  };

  await page.goto("/chores/new");
  await page.getByLabel("Title").fill("Water the plants");
  await page.getByRole("radio", { name: "Dad" }).check();
  await page.locator('form button[type="submit"]').last().click();
  await expect(page).toHaveURL(/\/chores$/);

  // Reduced motion holds each one still, so it's there to check and to photograph.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const looks = [["brut", "banana", "DONE."], ["goth", "oxblood", "So it is done"], ["synth", "outrun", "BONUS!"], ["kawaii", "ramune", "Yay!!"], ["acanthus", "leicester", "Duly attested"], ["vapor", "cobalt", "Task complete."]];
  try {
    for (const [id, color, word] of looks) {
      await wear(id, color);
      await page.goto("/chores");
      const card = page.getByText("Water the plants").first();
      await expect(card).toBeVisible();
      // Watched from inside the page: it only lasts two seconds, and a busy test machine can lose
      // that between one check and the next. A copy stays behind, held still, for the screenshot.
      await page.evaluate(() => {
        const seen: Record<string, unknown> = {};
        (window as unknown as { seenMoment: unknown }).seenMoment = seen;
        const start = performance.now();
        const watch = new MutationObserver((changes) => {
          for (const change of changes) {
            for (const node of change.addedNodes) {
              if (!(node instanceof HTMLElement) || node.className !== "ui-moment" || node.id) continue;
              const css = getComputedStyle(node);
              Object.assign(seen, { word: node.textContent, taps: css.pointerEvents, shown: css.visibility });
              // Still there a moment later, reduced motion included.
              setTimeout(() => Object.assign(seen, { after: css.visibility, opacity: css.opacity }), 300);
              const held = node.cloneNode(true) as HTMLElement;
              held.id = "held-moment";
              held.style.animation = "none";
              node.parentElement!.append(held);
            }
            for (const node of change.removedNodes) {
              if (node instanceof HTMLElement && node.className === "ui-moment" && !node.id) {
                seen.lasted = performance.now() - start;
                watch.disconnect();
              }
            }
          }
        });
        watch.observe(document.body, { childList: true, subtree: true });
      });
      await page.getByRole("button", { name: "Done", exact: true }).first().click();
      const held = page.locator("#held-moment");
      await expect(held).toHaveText(word);
      if (shots) await page.screenshot({ path: `${shots}/moment-${id}.png` });
      await held.evaluate((el) => el.remove());
      // It floats above the page without catching taps, and ends itself.
      const seen = () => page.evaluate(() => (window as unknown as { seenMoment: Record<string, unknown> }).seenMoment);
      await expect.poll(async () => (await seen()).lasted, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(await seen()).toMatchObject({ word, taps: "none", shown: "visible", after: "visible", opacity: "1" });
      await page.getByRole("button", { name: "Undo" }).first().click();
      await expect(page.getByRole("button", { name: "Done", exact: true }).first()).toBeVisible();
    }
    // Sticker Book keeps its own celebration.
    await wear("sticker", "ink");
    await page.goto("/chores");
    await page.getByRole("button", { name: "Done", exact: true }).first().click();
    await expect(page.locator(".ui-moment")).toHaveCount(0);
  } finally {
    await page.emulateMedia({ reducedMotion: null });
    await wear(start.look!, start.color!);
  }
  problems.expectNone();
});

test("a chore's less-used actions wait behind its menu, and what's ahead stays folded", async () => {
  // Rows revealed by the fold fade in, and a scan mid-fade reads their text as too faint.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/chores");
  const upcoming = page.locator("details", { has: page.locator("summary", { hasText: /^Next \d+ days/ }) });
  await expect(upcoming).not.toHaveAttribute("open");
  await upcoming.locator("summary").click();
  await expect(page.getByRole("combobox", { name: "Reassign to" })).toHaveCount(0);
  const more = page.getByRole("button", { name: /^More for / }).first();
  await more.click();
  const menu = page.getByRole("group", { name: /^More for / }).first();
  await expect(menu).toBeVisible();
  const first = menu.getByRole("button").first();
  await expect(first).toBeFocused();
  await expectAccessible(page, "chore menu open");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // The page's own: Print and Export together.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("link", { name: "Print" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: null });
});

test("Pantry has one box: it finds as you type, and offers to add what's new", async () => {
  await page.goto("/groceries/pantry");
  const box = page.getByLabel("Find or add something");
  await box.pressSequentially("Zucchini bread");
  await expect(page).toHaveURL(/q=Zucchini/);
  await page.getByRole("button", { name: "+ Add \u201cZucchini bread\u201d" }).click();
  await expect(page).toHaveURL(/item=/);
  await page.goto("/groceries/pantry?q=Zucchini%20bread");
  await expect(page.getByRole("button", { name: /^\+ Add/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(box).toHaveValue("");
  // A filter tapped just after typing stays, and the search joins it.
  await box.pressSequentially("Zucc");
  await page.getByRole("link", { name: /Needs details/ }).click();
  await expect(page).toHaveURL(/filter=needs/);
  await expect(page).toHaveURL(/q=Zucc/);
  await expect(page).toHaveURL(/filter=needs/);
  problems.expectNone();
});

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

test("a dose away from home shows both times, and a new zone keeps saved days on their day", async ({ browser }) => {
  // Phase 49: the household's zone is the one setup took from this browser.
  const home = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await page.goto("/meds/new");
  await page.getByLabel("Medication").fill("Vitamin D");
  await page.getByLabel("Time", { exact: true }).fill("08:00");
  await page.getByRole("radio", { name: "Dad" }).check();
  await page.getByRole("button", { name: "Add medication" }).click();
  await expect(page).toHaveURL(/\/meds$/);
  await expect(page.getByText(/8:00\sAM/).first()).toBeVisible();
  await expect(page.getByText(/at home ·/)).toHaveCount(0);
  problems.expectNone();

  // The same sign-in on a device in another zone (half a day from home, so it's surely different).
  const away = home === "Asia/Tokyo" ? "America/Los_Angeles" : "Asia/Tokyo";
  // No motion, like the accessibility pass above: axe would otherwise catch cards mid fade-in.
  const trip = await browser.newContext({ storageState: await dad.storageState(), timezoneId: away, reducedMotion: "reduce" });
  try {
    const travel = await trip.newPage();
    const tripProblems = watchForProblems(travel);
    await travel.goto("/meds");
    await expect(travel.getByText(/8:00\sAM at home,? · .* here/).first()).toBeVisible();
    await travel.goto("/");
    await expect(travel.getByRole("note")).toContainText("different time zone from home");
    await expectAccessible(travel, "/ (away from home)");
    // The server's render and the browser's agree: no hydration error from the other zone.
    tripProblems.expectNone();
  } finally {
    await trip.close();
  }

  // A new household zone: the dose's start date stays the same date. Honolulu is behind nearly
  // every zone, so without the move a midnight here would read as the day before there.
  await page.goto("/meds/manage");
  await page.getByRole("link", { name: "Edit Vitamin D" }).click();
  const started = await page.getByLabel("Starting").inputValue();
  await page.goto("/settings/household");
  // What's selected now (CI's browser is in UTC, which the picker lists only as the household's own).
  // Phase 57.3: the zone is a searchable picker; its value rides in the form's hidden field.
  const original = await page.locator('input[name="timezone"]').inputValue();
  const moved = home === "Pacific/Honolulu" ? "Asia/Tokyo" : "Pacific/Honolulu";
  const setZone = async (zone: string) => {
    await page.goto("/settings/household");
    await page.getByRole("combobox", { name: "Timezone" }).fill(zone.replace(/_/g, " "));
    await page.keyboard.press("Enter");
    await expect(page.locator('input[name="timezone"]')).toHaveValue(zone);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  };
  await setZone(moved);
  try {
    await page.goto("/meds/manage");
    await page.getByRole("link", { name: "Edit Vitamin D" }).click();
    await expect(page.getByLabel("Starting")).toHaveValue(started);
  } finally {
    // Back to the zone it had, so the rest of the story renders like the browser.
    await setZone(original);
  }
  await page.goto("/meds");
  await expect(page.getByText(/8:00\sAM/).first()).toBeVisible();
  problems.expectNone();
});

test("taking a med and finishing a shopping trip are marked by the look too", async () => {
  const root = page.locator("[data-app-root]");
  const start = { look: await root.getAttribute("data-look"), color: await root.getAttribute("data-color") };
  const sheet = page.getByRole("dialog", { name: "My look" });
  const wear = async (id: string, colorId: string) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "My look" }).click();
    await sheet.locator(`input[name="look"][value="${id}"]`).check({ force: true });
    await sheet.locator(`input[name="color"][value="${colorId}"]`).check({ force: true });
    const keep = sheet.getByRole("button", { name: "Keep it" });
    if (await keep.count()) await keep.click();
    else await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
    await expect(root).toHaveAttribute("data-look", id);
  };
  // Watched from inside the page, for how long it stays: a trip's page changes under the moment.
  const watchMoment = () =>
    page.evaluate(() => {
      const seen: { word?: string | null; lasted?: number } = {};
      (window as unknown as { seenMoment: typeof seen }).seenMoment = seen;
      let began = 0;
      const watch = new MutationObserver((changes) => {
        for (const change of changes) {
          for (const node of change.addedNodes) {
            if (node instanceof HTMLElement && node.className === "ui-moment") {
              seen.word = node.textContent;
              began = performance.now();
            }
          }
          for (const node of change.removedNodes) {
            if (node instanceof HTMLElement && node.className === "ui-moment") {
              seen.lasted = performance.now() - began;
              watch.disconnect();
            }
          }
        }
      });
      watch.observe(document.body, { childList: true, subtree: true });
    });
  const seenMoment = () => page.evaluate(() => (window as unknown as { seenMoment: { word?: string; lasted?: number } }).seenMoment);

  try {
    await wear("brut", "banana");
    await page.goto("/meds");
    await watchMoment();
    await page.getByRole("button", { name: "Taken", exact: true }).first().click();
    await expect.poll(async () => (await seenMoment()).word, { timeout: 10_000 }).toBe("DONE.");

    await page.goto("/groceries/shop");
    await watchMoment();
    await page.getByRole("button", { name: "Finish trip" }).click();
    await expect.poll(async () => (await seenMoment()).lasted, { timeout: 10_000 }).toBeGreaterThan(1_000);
    expect((await seenMoment()).word).toBe("DONE.");
  } finally {
    await wear(start.look!, start.color!);
  }
  problems.expectNone();
});

test("dropdowns look like the app, with the styled list only where a mouse is", async ({ browser }) => {
  // Phase 57.1 and 57.2. Settings → Household's date order is a plain dropdown.
  const shots = process.env.E2E_SHOTS; // a folder to save screenshots in, for a person to look at
  const look = (p: Page) =>
    p.locator("#household-date-order").evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, arrow: s.backgroundImage, supports: CSS.supports("appearance", "base-select") };
    });
  await page.goto("/settings/household");
  const desktop = await look(page);
  // Chromium has the styled list, and the desktop test browser has a mouse.
  expect(desktop.supports).toBe(true);
  expect(desktop.appearance).toBe("base-select");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    // The app follows the system theme here; make sure the dark pass really is dark.
    if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const box = page.locator("#household-date-order");
    if (shots) await box.screenshot({ path: `${shots}/select-${scheme}-closed.png` });
    await box.click();
    await expect.poll(() => box.evaluate((el) => el.matches(":open"))).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/select-${scheme}-open.png` });
    await expectAccessible(page, `/settings/household with a list open (${scheme})`);
    await page.keyboard.press("Escape");
  }
  await page.emulateMedia({ colorScheme: null, reducedMotion: null });

  // A phone keeps its own picker: no styled list, just the app's own closed box and arrow.
  const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: await dad.storageState() });
  try {
    const p = await phone.newPage();
    await p.goto("/settings/household");
    const mobile = await look(p);
    expect(mobile.appearance).toBe("none");
    expect(mobile.arrow).toContain("linear-gradient");
    if (shots) await p.locator("#household-date-order").screenshot({ path: `${shots}/select-phone-closed.png` });
  } finally {
    await phone.close();
  }
  problems.expectNone();
});

test("the searchable picker: a zone by its city, Escape closes only the list, required and posted", async () => {
  // Phase 57.3. The time zone: type a city, see the zone with its offset now.
  await page.goto("/settings/household");
  const zone = page.getByRole("combobox", { name: "Timezone" });
  await zone.click();
  await zone.fill("honolulu");
  await expect(page.getByRole("option", { name: /Pacific\/Honolulu/ })).toContainText("UTC−10");
  if (process.env.E2E_SHOTS) {
    await zone.fill("america");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.screenshot({ path: `${process.env.E2E_SHOTS}/picker-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: null });
    await zone.fill("honolulu");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectAccessible(page, "/settings/household with the zone picker open");
  await page.emulateMedia({ reducedMotion: null });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  // Merge into, inside a grocery item's sheet: required, posted through its form, and Escape
  // closes the list without closing the sheet.
  await page.goto("/groceries");
  for (const item of ["Oat drink", "Oat drink carton"]) {
    await page.getByLabel("Add to the list").fill(item);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("link", { name: new RegExp(`^${item}\\b`) }).first()).toBeVisible();
  }
  await page.getByRole("link", { name: /^Oat drink carton/ }).first().click();
  await expect(page).toHaveURL(/item=/);
  const same = page.getByRole("combobox", { name: "Same as…" });
  let asked = false;
  page.once("dialog", (d) => {
    asked = true;
    void d.accept();
  });
  await page.getByRole("button", { name: "Merge into this" }).click();
  await expect.poll(() => same.evaluate((el: HTMLInputElement) => el.validationMessage)).toContain("Pick the duplicate");
  expect(asked).toBe(false);
  await same.fill("oat");
  await expect(page.getByRole("option", { name: "Oat drink", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/item=/);
  await same.fill("oat drink");
  await page.getByRole("option", { name: "Oat drink", exact: true }).click();
  await expect(page.locator('input[name="mergeId"]')).not.toHaveValue("");
  await page.getByRole("button", { name: "Merge into this" }).click();
  await expect.poll(() => asked).toBe(true);
  // The picked duplicate folds into the open item: "Oat drink" goes, "Oat drink carton" stays.
  // Wait for that on this page (the merge reopens the kept item's sheet over a fresh list):
  // leaving any sooner would cut the merge off.
  await expect(page.getByRole("link", { name: /^Oat drink(?! carton)/ })).toHaveCount(0);
  await page.goto("/groceries");
  await expect(page.getByRole("link", { name: /^Oat drink carton/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Oat drink(?! carton)/ })).toHaveCount(0);
  problems.expectNone();
});

test("a card statement CSV is checked on a few rows, imported, and removed again", async () => {
  // Phase 52: a made-up card export (charges positive, a payment negative).
  await page.goto("/finances");
  await page.getByLabel("Jar name").fill("Family money");
  await page.getByRole("button", { name: "Add jar" }).click();
  await expect(page).toHaveURL(/\/finances\/[^/]+\/settings$/);
  const csv = [
    "Trans. Date,Post Date,Description,Amount,Category",
    "10/01/2026,10/02/2026,Corner Grocery,45.20,Groceries",
    "10/02/2026,10/03/2026,Bakery Example,6.50,Dining",
    "10/03/2026,10/04/2026,Bookstore Example,18.00,Shopping",
    "10/04/2026,10/05/2026,Gas Station Example,30.00,Transport",
    "10/05/2026,10/06/2026,Pizza Place Example,22.40,Dining",
    // A day past the 12th settles the date order for the whole file, whatever the household's zone.
    "10/15/2026,10/16/2026,Payment Thank You,-100.00,Payment",
  ].join("\n");
  await page.getByLabel("Statement file").setInputFiles({ name: "card.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel("New account name").fill("Card");
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByText("Here's what the app understood")).toBeVisible();
  await expect(page.getByText(/Nearly every amount here is positive/)).toBeVisible();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("1");
  await page.getByLabel(/Money out shows as a positive number/).check();
  await expect(page.getByRole("cell", { name: "$45.20 out" })).toBeVisible();
  // Once the rows are read again with the new choice (the buttons are dimmed meanwhile).
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
  // The re-check is a server action: until it answers the buttons are dimmed, and axe would
  // judge their contrast mid-change (a flake seen in Phase 53's run).
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectAccessible(page, "statement check");
  await page.emulateMedia({ reducedMotion: null });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Added 6 transactions.")).toBeVisible();

  // The rows are in the jar's Activity.
  const settings = page.url();
  // Asks for the statement's month: the page opens on the current one, which moves on.
  await page.goto(`${settings.replace(/\/settings$/, "")}?month=2026-10`);
  await expect(page.getByText("Corner Grocery").first()).toBeVisible();

  // Phase 57.3: a charge's category is a searchable picker inside the charge's sheet (a native
  // dialog). Escape closes the list, not the dialog; Enter picks the highlighted match.
  await page.getByRole("button", { name: /Bookstore Example/ }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const category = sheet.getByRole("combobox", { name: "Category" });
  await category.click();
  await category.fill("din");
  await expect(sheet.getByRole("option", { name: /Dining/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("listbox")).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await category.fill("din");
  await page.keyboard.press("Enter");
  await expect(category).toHaveValue("🍔 Dining");
  await sheet.getByRole("button", { name: "Just this one" }).click();
  await expect(sheet).toBeHidden();
  await page.goto(settings);
  await page.getByRole("button", { name: "Remove this import" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Removed 6 transactions.")).toBeVisible();
  problems.expectNone();
});

test("the school calendar finder refuses a private address and says why", async () => {
  // Phase 51: a real school site can't be reached from the tests, and a local one is refused by
  // design (the same guard as feeds), so this covers the screen and the refusal.
  await page.goto("/school/feeds");
  await expect(page.getByRole("heading", { name: "Find it from the school's website" })).toBeVisible();
  await page.getByLabel("The school's website").fill("127.0.0.1");
  await page.getByRole("button", { name: "Find calendars" }).click();
  await expect(page.getByText("That address points at a private or local network, so the app won't fetch it.")).toBeVisible();
  await page.getByLabel("The school's website").fill("not a site");
  await page.getByRole("button", { name: "Find calendars" }).click();
  await expect(page.getByText(/That doesn't look like a web address/)).toBeVisible();
  problems.expectNone();
});

test("a car's VIN is checked before anything is looked up, and kept on the car", async () => {
  // Phase 53: the made-up VIN has a valid North American check digit; the lookup itself calls
  // NHTSA, which the tests never reach, so only the check (in the server action, before any
  // fetch) and the saved VIN are covered here.
  await page.goto("/vehicles/new");
  await page.getByLabel("Name", { exact: true }).fill("Family van");
  await page.getByLabel("VIN (optional)").fill("1example0parker18");
  await expect(page.getByLabel("VIN (optional)")).toHaveValue("1EXAMPLE0PARKER18");
  await page.getByRole("button", { name: "Look it up" }).click();
  await expect(page.getByText("That VIN doesn't add up (its check digit is off). Look again at each character.")).toBeVisible();
  await page.getByLabel("VIN (optional)").fill("1EXAMPLE0PARKER17");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await expect(page).toHaveURL(/\/vehicles\/[^/]+\/items\/templates$/);
  await page.goto(page.url().replace(/\/items\/templates$/, ""));
  await expect(page.getByText("1EXAMPLE0PARKER17")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy the VIN" })).toBeVisible();
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
