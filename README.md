# FamilyOS

A "CRM for the family" — one private app for the household's people, chores, groceries,
and calendar, with more modules planned. Non-commercial; built for one family, and kept free
of anything about that family so it could be shared (see "Privacy" below). Each family names
its own copy: FamilyOS is just what it's called until you do (see "Make it yours"). The app
shell started as a HubSpot-style layout and has since had a warm/family-friendly design
pass (see docs/BUILD.md).

> **New here? Read [docs/PLAN.md](docs/PLAN.md) for the vision and roadmap, and
> [docs/BUILD.md](docs/BUILD.md) for the phase-by-phase build log (what exists, why, and
> how each piece was verified).** This README is the practical "how to run it" guide.

> **Running it for your family, or using it?** [docs/guides](docs/guides/README.md) has two
> guides that pull this together: [the admin guide](docs/guides/admin.md) (the server,
> Cloudflare, first run, sign-in, backups, break-glass, updates) and
> [the family guide](docs/guides/family.md) (getting in and each app, in everyday words).

## Status

Everything through **Phase 45** is built and merged to `main` (2026-10-22), except Phase 44, which is
built on its branch: the money jars
(Phases 25–34), the security, dependency and nav passes, the **full review of 2026-10-09**, the
**privacy pass (2026-10-12)** that renamed the app FamilyOS and took every real personal detail
out of the code and docs, the customization phases (35–37), and the polish roadmap:
sharp edges (38), performance (39), **sign-in and users (40)**: passkeys, a first-visitor setup,
invites, any OIDC provider, Microsoft optional and checked against Entra; **CI with browser
tests (41)**; **security before going live (42)**; a **production container (43)** behind a
Cloudflare Tunnel; **accessibility and the Shop list without signal (44)**; and a **Settings hub
with a guided setup (45)**. The phase-by-phase
log is docs/BUILD.md; what's next and what's waiting on the owner is docs/PLAN.md ("Current
state" and "Open items").

| Area | What's there |
|---|---|
| **Foundation** | Grown-ups sign in with a passkey, Microsoft (Entra) or the family's own OIDC provider; sticker-style profile picker + PIN for kids, light/dark/system theming |
| **Sign-in and users (Phase 40)** | First-visitor setup with a passkey; Settings → Sign-in for admins (invite a grown-up with a one-time link, change a role, reset lost passkeys with a one-hour link, take a sign-in away, always keeping an admin); Settings → My passkeys; a sign-in audit log and notices; Microsoft and OIDC optional, set in `.env`; Microsoft people checked against Entra's app assignments every half hour |
| **Tests and CI (Phase 41)** | Unit, database and Playwright browser tests, run by GitHub Actions on every pull request along with lint, types, the privacy check and a migrations-match-schema check; weekly supply-chain checks |
| **Sticker Book shell (Phase 19)** | The app's look (graph paper, ink, person colors, Baloo 2/Gaegu), Microsoft 365-style nine-dot app launcher, a rail in one fixed order (Home, People, Calendar, Chores, Meds, Groceries, School, Money, Store, Cars, Garage, Data, Settings) showing the first six with Show more for the rest (admin-center style; per-person pins removed 2026-10-09), phone bottom bar with the first four; the rail stays put and scrolls on its own, apart from the page; Settings/Data stay plain |
| **Apps on and off (Phase 36)** | Admins turn off apps the family doesn't use (Settings → Apps): gone for everyone from the rail, launcher, Home, search, the calendar week and Bunson, their background work paused, nothing deleted |
| **Views & Bunson (Phase 19.5)** | Per-person "Big buttons" or "Full app" view (big Home and Chores for "my stuff"), Bunson volume (Chatty / Just cheers / Off), Bunson moments on greetings, empty pages and oops pages |
| **Sticker Store (Phase 20)** | Kids spend stickers (points) on rewards grown-ups stock in shelves; per-reward weekly limits and "needs an OK"; order tracker, Delivered/Refund; family sticker sheet; admins get an in-app bell (both parents need the Admin app role in Entra); backup v4 |
| **Alerts (Phase 21, 21.5)** | Store-order alerts in Teams through one family Workflows link (the Flow bot messages each admin; set up once) and by email (shared mailbox, Exchange RBAC for Applications); any admin switches them on for each admin; phone push straight to each admin's phone (Phase 21.6) |
| **Roles & admin** | Admin/Adult role (from Entra app roles for Microsoft people, set in the app for everyone else), admin-only household member management |
| **People Hub** | Contact/member records, interaction logging (backdated, editable), important dates (editable), "haven't talked in a while" with one-tap 📞/💬 on Home, Around the house (a member's stickers, list items, school), delete for plain contacts |
| **Chores** | Generic recurring-task engine (recurrence + rotation + stickers), Today/Overdue/Upcoming board; grown-ups' Skip/Missed; overdue reaches back a week, older misses cleared in one tap; tick off on Home too |
| **Calendar** | The family's week: chores and doses, dates, homework and school calendars, car maintenance, the owner's Outlook events; open to kids (their own school things, no cars, no Outlook); Outlook sync settings at /calendar/outlook |
| **Meds** | Same task engine, extended with multi-dose ("3x/day") recurrence; points go to whoever the dose was for |
| **Groceries (Phase 22)** | One add box (type, pick, or scan; typed items become Pantry items), item sheet with "How it comes" sizes ("31.1 lb bag") and where we buy it, sections suggested from the name, usual amounts learned from trips, −/+ on each row, "who's it for" tags; the Pantry tidy-up page with "Needs details" and grown-up "Same as…" merge. **Shop view (Phase 23):** big rows by store and section, check-offs that work with no signal and sync later, and **the list itself opens with no signal (Phase 44)**, screen kept on, "In the cart", undo, Finish trip carries leftovers over. Kids get picture tiles that add straight to the list; grown-ups can say "Not this time" and the kid gets a kind note in their bell. Barcodes look up Open Food Facts (food, pet food, household goods) **Receipt prices (Phase 24):** snap the receipt after a trip; Azure AI Document Intelligence reads it, lines are matched to what you bought (and remembered), and grown-ups see "Last paid" on items. **Store sections (Phase 37):** grown-ups rename, reorder (the way you walk the store), add and remove sections from the Pantry page; a removed section's items move where you say, and new items are still guessed into a renamed section. |
| **Make it yours (Phase 35)** | Each family's own app name (they type the name, the app adds OS), top bar color, reward word (stickers, stars, points, coins, gems or their own), mascot on/off and name, and Home Screen icon, in Settings → Make it yours |
| **Money jars (Phases 25–34)** | Finances in private jars (only a jar's members see it, admins included, on their own Microsoft sign-in); bank feed via SimpleFIN, Privacy.com charges named with the real store, OFX/QFX/CSV statement import, and a reconciler that folds duplicates and asks only about the unsure ones ("Needs a look"). **Phase 26:** categories that learn ("always for this merchant"), a monthly budget per category, Bills & subscriptions ("still using this?"), and grocery trips linked to the card charge. **Phase 27:** 🎁 surprises (a charge hidden from chosen jar members until a reveal day, while totals stay whole), money alerts to Teams first (bill due, sync broken, over budget; each member's own switches), quarterly and yearly bills, background syncs. **Phase 28:** backups by the person themselves after a fresh sign-in, jars sealed in the household backup (and put back on restore, Phase 28.5), your own readable copy, and a backup history announced in Teams. **Phase 29:** order emails (Amazon, Apple, Publix) read from your own mailbox onto the charges that paid for them. **Phase 30:** who changed what in a shared jar, the same bank or Privacy.com account kept out of a second jar, and one Teams group chat per jar for its alerts. **Phase 31:** saving up (leftovers roll over, goals like "$400 by August"), the next 30 days of bills with a total, and bills that went up. **Phase 32:** safe to spend until payday, with its lowest point and a heads-up when checking may run low. **Phase 33:** Trends, money out month by month and where each month went. **Phase 34:** Net worth, bank balances plus the house, cars and loans typed in, month by month. **Phase 37:** each jar's own categories, renamed, added and removed (charges, rules and budget move along) |
| **Vehicles** | Bespoke mileage-and/or-date maintenance tracking (not the task engine), append-only service history with costs, fill-up log + MPG, cost of ownership, NHTSA recall alerts, maintenance templates, print view, no points; grown-ups only |
| **Microsoft Graph** | Dashboard calendar widget, per-contact recent-emails card, profile enrichment (photo/name/phone) |

The database currently holds **test data only** — it's meant to be wiped before real use.
Recent phases were checked in the browser with the temporary dev sign-in (`DEV_AUTH`,
localhost only; it must come out before the app ships — see "Dev sign-in" in
docs/BUILD.md), not with a real Microsoft sign-in.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind v4** (hand-rolled components, no UI kit)
- **PostgreSQL 17** (Docker) + **Prisma 7** (uses the `@prisma/adapter-pg` driver adapter)
- **Better Auth** 1.7: passkeys, Microsoft (Entra ID) and generic OIDC, all optional but passkeys — *not* Auth.js
- **Vitest** for unit and database tests, **Playwright** for browser tests, **GitHub Actions** for CI

## Prerequisites

- Node 24 LTS (`.node-version` says 24.21.0) with **npm 11.19 or newer** (`npm -v`; the install
  refuses an older npm, see "Dependencies" below), Docker Desktop (with WSL2 on Windows).
  macOS and Windows both work; nothing in the scripts is tied to one.
- Optional: a Microsoft Entra app registration in the family's Microsoft 365 tenant, for
  Microsoft sign-in and the Microsoft 365 features (see [docs/BUILD.md](docs/BUILD.md)
  "Phase −1" for the exact portal steps and required delegated Graph permissions)

## Running it locally

```bash
cp .env.example .env      # then fill in the real values — see below
npm ci                    # exactly what package-lock.json says
npm run db:up             # starts Postgres 17 in Docker
npm run db:migrate        # applies Prisma migrations
npm run dev               # http://localhost:3000
```

Then either:
- **Set it up like a real install**: open http://localhost:3000 (not 127.0.0.1: passkeys belong to
  `localhost`), which goes to `/setup`; name the household and make your passkey (see "How
  access works"), and the guided setup takes it from there. Or
- **Use test data**: `npm run db:seed` (a household and placeholder people) and optionally
  `npm run db:seed:demo` (demo data in every area, replacing the household's), then sign in with
  a Microsoft account from the family tenant (when `MICROSOFT_*` is set; the first sign-in links
  to the `SEED_ADMIN_*` person) or, on this machine only, the temporary dev sign-in
  (`DEV_AUTH=1`, docs/BUILD.md "Dev sign-in"). Pick your profile tile to enter the app.

### Moving to another computer

A fresh clone has everything in git, and nothing that isn't. Bring these across yourself, over
something private (a password manager, AirDrop, a USB stick; not email or chat):
- **`.env`**: its keys and secrets. Keep `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY` the
  same if you bring the database across (sign-in tokens and saved bank-feed credentials in it are
  encrypted with them); for a fresh database, make new ones.
- **`.git/info/privacy-terms`**, the family's own term list for `npm run privacy:check` (see
  Privacy). Git never copies it: without it the check finds nothing and says "No privacy terms
  to check against". Put it back before the next commit.
- **The dev database** only if you want it (it's test data): `npm run db:backup`, or start
  fresh.

Then the setup above, `npx playwright install --no-shell chromium` once for the browser tests,
and `npm test` to see it all works. Claude Code's own memory for this project stays on the old
machine too; what matters is in docs/PLAN.md and docs/BUILD.md.

### Environment variables (`.env`)

| Var | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string (matches `docker-compose.yml`) |
| `POSTGRES_PASSWORD` | Overrides the dev Postgres password — only takes effect on a fresh Docker volume (see `.env.example`). Keep in sync with `DATABASE_URL` by hand. |
| `BETTER_AUTH_SECRET` | Session/cookie signing secret (`npx @better-auth/cli secret`) |
| `BETTER_AUTH_URL` | Base URL, `http://localhost:3000` in dev |
| `MICROSOFT_CLIENT_ID` / `_SECRET` / `_TENANT_ID` | Optional: from the Entra app registration, for Microsoft sign-in and the Microsoft 365 features. All three or none (a partial set stops the app at start) |
| `TZ` | The server's time zone. Set it to the household's (Settings → Household): "today" and due dates follow the server's clock, and Settings → Household says when the two differ |
| `FAMILY_CALENDAR_NAME` | Optional default: the exact name of the calendar Home shows, e.g. a synced Google Calendar, for anyone who hasn't picked one in Settings → Calendar on Home (each Microsoft grown-up can). Unset → their main Outlook calendar |
| `ALERT_MAILBOX` | Shared mailbox Sticker Store alert emails come from (see Alerts). Empty → email alerts unavailable |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Optional phone push keys (`node scripts/generate-vapid.mjs`) and contact. Empty → the server makes and keeps its own, with `CONTACT_EMAIL` or the `https://` `BETTER_AUTH_URL` as the contact (see Alerts) |
| `DOCINTEL_ENDPOINT` | Azure AI Document Intelligence custom-subdomain endpoint for receipt prices (see Receipts). Empty → "Snap the receipt" explains it isn't set up |
| `DEV_AUTH` | **Temporary, local only.** `1` shows the dev test sign-in on localhost (docs/BUILD.md "Dev sign-in"); never set in production |
| `BACKGROUND_JOBS` | Background jobs (money syncs and alerts, every 30 minutes). Unset → on in production, off in development; `1` on, `0` off |
| `CONTACT_EMAIL` | Contact address outside services ask for in the User-Agent (api.weather.gov, Open Food Facts). Empty → a placeholder |
| `SEED_ADMIN_EMAIL` / `_FIRST_NAME` / `_LAST_NAME` | Who `npm run db:seed` makes the first admin; use your Microsoft sign-in address so your first sign-in links to it |
| `INTEGRATION_ENCRYPTION_KEY` | 32 random bytes, base64 — encrypts household-level third-party credentials (SimpleFIN, Kroger, ...) at rest. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

`.env` is gitignored; never commit it. Only `.env.example` is tracked.

### Other scripts

```bash
npm run test        # vitest — scheduler + assignment engine
npm run test:db     # database tests: backup restore, garage-supply stock (dev Postgres, throwaway households)
npm run test:e2e    # browser tests on a production build and a fresh database (see Testing)
npm run lint        # eslint
npm run privacy:check  # no real family details in files, branch or unpushed commits (see Privacy)
npm run build       # production build (also full typecheck)
npm run db:studio   # Prisma Studio (browse/edit the DB, e.g. to fix up an auto-provisioned name)
```

> **After any `prisma migrate` / `prisma generate`, restart the dev server.** The Prisma
> client is cached on `globalThis` and survives hot reload, so a running server keeps using
> the pre-migration client and throws "Cannot read properties of undefined" on new models.

## Testing

Three kinds of tests, all run by GitHub Actions on every pull request and every push to `main`
(`.github/workflows/ci.yml`):

| What | Command | Needs |
| --- | --- | --- |
| Lint, types, privacy check, unit tests | `npm run lint`, `npx tsc --noEmit`, `npm run privacy:check`, `npm test` | the two keys in `.env` (no database) |
| Migrations match the schema, database tests | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`, `npm run test:db` | Postgres (`npm run db:up`); the tests make and drop their own scratch databases |
| Browser tests | `npm run test:e2e` | Postgres, and Chromium once: `npx playwright install --no-shell chromium` (on Linux, add `--with-deps` for its system libraries) |

The **browser tests** (`e2e/`, Playwright) play one made-up household's first day on a brand-new
install (`e2e/smoke.spec.ts`): Dad sets the app up with a passkey, invites Mom, who joins from a
second browser with her own; every app's page (from `lib/apps.ts`, so a new app is covered) and
every Settings page opens with no error screen, console error or server error; Dad signs out and
back in; and, signed out, the setup page, an app's page and a made-up invite stay shut. Every one
of those pages, plus setup, an invite, the profile picker and sign-in, is checked for
accessibility (Phase 44.1, below), and the Shop list is opened with the network off (Phase 44.2).
`e2e/doors.spec.ts` checks what doesn't need a household: the sign-in routes the app turns off,
the dev sign-in and the dev-only pages answer 404, and a page, an API route and a static file
carry the security headers. Passkeys come from Chromium's built-in virtual authenticator, so
nothing touches a real device.

`npm run test:e2e` builds the app for production and starts it on http://localhost:3100
(`e2e/serve.mjs`) against **its own database**, `E2E_DATABASE_URL` in `.env` (see
`.env.example`), which every run drops and makes again: its name must end in `_e2e` and it
can't be `DATABASE_URL`'s. The server gets an environment of its own: fresh keys each run, and
the dev sign-in, background jobs, Microsoft, an OIDC provider, Sentry (and its build plugin),
alert email, phone push, receipt reading and the contact address all off, whatever `.env` says;
its time zone is this machine's, as the browser's is. `E2E_SKIP_BUILD=1` reuses the last build (it must be one this
script made); `E2E_BASE_URL=<address>` runs the tests against a server that's already running
on a fresh install instead (a container, say). A failure leaves a trace in `test-results/`:
`npx playwright show-trace <path>`.

**Accessibility (Phase 44.1).** The target is WCAG 2.2 AA. `@axe-core/playwright` runs axe's
WCAG 2.0, 2.1 and 2.2 A and AA rules and its best practices on every page in the list, in two
passes: light at desktop width, then dark at phone width (dark by the system setting, with
reduced motion so no colour is measured mid-fade). Any finding fails the test with the rule, the
elements and a help link; one run lists every page that fails. axe goes in over the browser's
debugging protocol, so the pages keep their real script policy (`lib/e2e-guard.test.ts` makes
sure no test turns it off). Checked by hand, since axe can't see them: a "Skip to content" link
and one `<main>` on every page (the app's scrolling area takes keyboard focus, so a page with
nothing to tab to still scrolls); focus moves to each guided-setup step's title and into the
grocery item sheet (kept there with Tab, given back on close), and confirm-in-place panels
already focus their button; tabbing never hides a control behind the Shop view's or the
Groceries undo bar's panel; motion stops for people who ask their device for less; every page
has its own tab title; no field blocks pasting, so a PIN or sign-in works with a password
manager (`lib/accessibility-guard.test.ts`). Form errors are announced (`role="alert"`) next to
the form, not tied to each field. Not done yet: a screen-reader pass by a person, worth doing
once the family uses the app.

**On Windows**, if the tests stop with `browserType.launch: spawn UNKNOWN` (Windows says
Playwright's Chromium has a "side-by-side configuration" problem), use the installed Edge
instead, which is Chromium too: `E2E_CHANNEL=msedge npm run test:e2e`.

**CI**, in three jobs: checks; the database (Postgres 17 as a service, migrations deployed and
compared with the schema, then the database tests); and the build with the browser tests (the
Playwright report and traces are kept for 7 days when something fails). A second workflow,
`supply-chain.yml`, runs `npm run deps:check` and `npm audit signatures` when `package.json`,
`package-lock.json` or `.npmrc` change, and every Monday (GitHub pauses a schedule after 60 days
without activity in the repository; Actions → Supply chain → Run workflow runs it by hand). No
real secrets are involved: each run makes its own keys, and nothing reaches Microsoft, an OIDC
provider, Sentry or the family's email. Actions are pinned to full commit SHAs and the Postgres
image to its digest, each at least 7 days old when pinned (the same rule as npm packages, see
Dependencies); checkout keeps no token, and the jobs can only read the repository.

**Owner steps (optional):**
- **PRIVACY_TERMS secret** (Settings → Secrets and variables → Actions): the term list,
  comma-separated, so CI checks for the family's own details too. Without it, CI still catches
  hidden characters. In CI the check names the file and line, never the term, and each plain term
  of 4 characters or more is masked in the log. Code on any branch pushed to this repository can
  read the secret (forks and Dependabot can't), so only add it while you're the only one pushing.
- **Actions settings** (Settings → Actions → General): "Require actions to be pinned to a full-length
  commit SHA", and allow only actions from GitHub (these workflows use only `actions/*`).
- **Required checks and auto-merge** (Settings → General and Settings → Rules): a ruleset on
  the default branch requires a pull request (no approvals needed for a single maintainer), blocks
  force pushes and deletion, and requires the three CI jobs and *Production image and browser
  tests*. With **Allow auto-merge** on, a pull request merges itself once they're green. (On a
  private repository, GitHub Free has neither: there, look at the checks before merging.)

## Dependencies

Every version is pinned and every install is checked, because worms like Shai-Hulud spread
through install scripts in freshly published versions of popular npm packages (they hit
over a thousand versions in 2026 alone, and are usually caught within days). The rules live
in `.npmrc` and `package.json`:

- **Exact versions.** `package.json` has no `^`/`~` ranges, `save-exact=true` keeps it that
  way, and `package-lock.json` fixes every transitive version with its sha512 hash. Install
  with `npm ci`, which installs exactly the lockfile and fails if it disagrees with
  `package.json`.
- **A 7-day cooldown** (`min-release-age=7`): when npm picks a version, it only takes ones
  published more than a week ago. It doesn't re-check what's already in `package-lock.json`,
  so **any change to the lockfile gets `npm run deps:check`** (exact pins, registry-only with
  sha512, every install script reviewed, nothing younger than 7 days or pulled from the
  registry) before it's merged. A security fix that can't wait: add the package to
  `min-release-age-exclude` in `.npmrc` for that one install, then remove it.
- **Registry only** (`allow-git=none`, `allow-remote=none`): no git or URL dependencies,
  which would skip registry signatures and the cooldown.
- **Install scripts only by name and version** (`strict-allow-scripts=true` plus
  `"allowScripts"` in `package.json`): argon2, prisma and @prisma/engines may run theirs;
  esbuild, unrs-resolver and fsevents are denied (they work without). Any other package that
  shows up with an install script stops the install with `ESTRICTALLOWSCRIPTS`. Look at the
  script before approving it (`npm install-scripts approve <pkg>`), and approve the exact
  version. `npx` doesn't read `allowScripts`, so a one-off tool with an install script stops with the same error: name it with
  `--allow-scripts=<pkg>` after reading the script, never `--dangerously-allow-all-scripts`.
- **npm 11.19+ only** (`engine-strict=true`, `engines` in `package.json`): older npm doesn't
  know the two rules above and would run every install script.

**Updating a package:** check what it is and how old (`npm view <pkg> time --json`), read
its changelog, `npm install <pkg>@<version>` (saved exact, cooldown applied), then
`npm run deps:check`, `npm audit`, `npm audit signatures` (every package must have a
verified registry signature), the tests, the build, and a look in the browser. Update on
purpose, a few at a time. Not `npm update` or `npm audit fix` (both pick fresh versions
across the tree; older notes in docs/BUILD.md that suggest `npm audit fix` predate these
rules), and never `--force`.

`npm audit` is expected to report the one accepted item below (5 "high" lines, all the same
`braces` advisory) until upstream fixes it, and `npm audit --omit=dev` nothing; anything else
is new and needs a look.

**Checked 2026-10-08:** 619 packages, all from registry.npmjs.org with sha512 integrity and
verified registry signatures (185 with provenance attestations); none of the versions named
in the 2026 Shai-Hulud / CHAINDROP waves; nothing published in the 7 days before. Known and
accepted then: `deepmerge-ts` inside Prisma's config loader (overridden since, see
2026-10-12) and `braces` under ESLint (an advisory with no fixed version yet; it only reads
our own glob patterns, dev only).

**Checked 2026-10-12:** `npm audit` reported 8 "high" lines from two advisories.
- `deepmerge-ts` below 8 (GHSA-ggr8-5vv4-36mx: a merge of two self-referencing objects
  recurses until the stack runs out). Prisma 7.10.0's config loader pins 7.1.5 and uses it
  only as c12's merger for our own `prisma.config.ts`, so nothing outside could reach it, but
  `@prisma/client` names the Prisma CLI as a peer, which made it count as production. No
  Prisma release ships 8 yet (`npm audit fix` would downgrade Prisma to 6), so an override in
  `package.json` pins `deepmerge-ts` to 8.0.2 (published 2026-08-21). Its one breaking change
  is that Maps now merge deeply, and Prisma's config has none. Checked with `prisma generate`,
  `migrate deploy`/`status`/`diff` on a fresh database, every test and the build. **Remove the
  override** once a Prisma release depends on deepmerge-ts 8 itself.
- `braces` up to 3.0.3 (GHSA-vfj7-8cjw-p6xm: deeply nested brace patterns exhaust the stack),
  with no fixed version anywhere. It's under ESLint only (`eslint-config-next` →
  `@next/eslint-plugin-next` → `fast-glob` → `micromatch`; the newest plugin still uses it),
  where it expands the plugin's own patterns for finding this project's app folders. Dev only,
  never in the app, no outside input: accepted until a fixed `braces` or plugin ships.

**Updated 2026-10-12 (Phase 40.1):** `better-auth` 1.6.23 → 1.7.7 (published 2026-09-30; 1.7 is
what the passkey sign-in builds on, and 1.7.7 carries the fix for a critical magic-link advisory,
GHSA-965c-763c-88jm, though magic links aren't used here), with `@better-auth/passkey` 1.7.7
(`@simplewebauthn/server` 13.3.3) and `zod` 4.4.3 → 4.5.4, the version Better Auth 1.7 asks
for (one copy, not two). 792 versions pass `deps:check`; `npm audit` still shows only
`braces`.

**Added 2026-10-17 (Phase 41):** `@playwright/test` 1.64.0 (published 2026-10-07), dev only, for
the browser tests. It brings `playwright` and `playwright-core` at the same version and nothing
else, with no install scripts (the browsers are a separate, explicit `npx playwright install`).
795 versions pass `deps:check`; `npm audit signatures` verifies them all; `npm audit` still
shows only `braces`. `deps:check` now retries a busy registry (429/5xx) a few times before
counting it as a problem, for CI.

**Upgrading an install to this version:** stop the running app, run `npx prisma migrate deploy`,
then start the new build (an old build signing someone in between the two would add a second,
old-style Microsoft account row for them). The `better_auth_1_7` migration re-keys every Microsoft sign-in from Entra's
pairwise `sub` to the directory `oid` (Better Auth 1.7 looks accounts up by the `oid`; a row
left on `sub` would lock that person out), and stops with an error if any Microsoft sign-in
has no stored ID token to read it from; see docs/BUILD.md Phase 40.1 for the fix.

**Trimmed 2026-10-09:** the unused shadcn button and its four packages (@base-ui/react,
class-variance-authority, clsx, tailwind-merge) and the vendored shadcn stylesheet are gone (the
one utility the app used, `no-scrollbar`, lives in `app/globals.css`); the seeds and
`prisma.config.ts` read `.env` with Node's own `process.loadEnvFile`, so `dotenv`, `pg` and
`@types/pg` are no longer direct dependencies (Prisma's adapter still brings `pg`).

**Updated 2026-10-09:** `argon2` 0.45.1 (no security fixes; Node 18/20 dropped, types fixed). PINs are
hashed in one place, `lib/pin-hash.ts`: Argon2id with explicit settings (64 MiB, 3 passes, 4 lanes,
above the OWASP floor), upgraded on the next right PIN when the settings change. The package
stays rather than Node's own `crypto.argon2`, which is still experimental and has no PHC strings
or rehash check (the package's own README says it will wrap the built-in once that's stable).

**Not needed now, worth doing on purpose later** (age on 2026-10-08): minor updates for
react/react-dom 19.3.0 (29 days), zod 4.6.5 (24), tailwindcss/@tailwindcss/postcss 4.3.3 (84), tsx 4.23.15 (18),
better-auth 1.7.x (a week; wait a little longer); @types/node to 24 to match
Node 24. Bigger moves, each its own change: ESLint 10 (9.x is out of support), TypeScript 7,
Vitest 5, Prisma 8 (still a release candidate).

**Updated 2026-10-22 (Phase 42):** `npm audit` showed three critical advisories in Next.js 16.3.8
(GHSA-2464-fhr4-w9xw, remote code execution in the image optimizer with SVG files;
GHSA-673q-mjm6-r5xr, remote code execution through `use cache` returning typed arrays;
GHSA-p3m5-59mp-jv5r, a denial of service through server actions), two in Vitest 4.1.11 and six in
the Vite 8.3.0 under it. Now: `next` and `eslint-config-next` 16.4.2 (published 2026-10-15,
installed a few minutes short of 7 days old with `--min-release-age-exclude` on the command line,
the owner's call; `.npmrc` unchanged, and `deps:check` passed once they were 7 days old),
`vitest` 4.1.12, and `vite` 8.3.4 through `overrides` (Vitest allows any Vite 6 to 8, so it
didn't move by itself). Next 16.4's Turbopack couldn't build with `@sentry/nextjs` 11.0.0 (it
tried to bundle the `sentry` CLI's type file), so `@sentry/nextjs` is 11.8.0 (2026-10-15), which
brings `@sentry/cloudflare` along. 796 versions pass `deps:check`; `npm audit` shows only
`braces`. **Remove the `vite` override** once Vitest requires a fixed Vite itself.

## Running in production (Phase 43)

The home server runs the production image (`Dockerfile`) with `docker-compose.prod.yml`: the
database, a one-shot migration step, the app and a Cloudflare Tunnel. Families reach it from
anywhere at its own hostname, behind Cloudflare Access. **Not yet for real family data:** the
security work (Phase 42) comes first (docs/PLAN.md).

What the tunnel means: no router ports are opened (the tunnel connects out to Cloudflare);
Cloudflare handles HTTPS, so it handles the family's traffic in transit; the domain's DNS has to
be on Cloudflare; and Cloudflare Access keeps everyone but the family away from the sign-in page.

### The server (once)

1. **A Debian VM on Proxmox** (2 cores, 4 GB of memory, 32 GB of disk is plenty), with Docker
   from Docker's own packages (docs.docker.com, "Install Docker Engine on Debian") and git. Only
   the owner is in the `docker` group: anyone in it can read the settings (`docker inspect`).
2. **The code:** `git clone` the repository to `/opt/familyos`. The app itself comes from the
   published images ("Start, update, roll back"); the checkout holds the compose file and the
   scripts.
3. **Settings:** copy `familyos.env.example` to `/etc/familyos/familyos.env` and fill it in.
   Never name it `.env.production` (`next build` would read that). Compose reads it as the user
   who runs it, so it and its folder belong to the owner:
   `sudo chown <you> /etc/familyos /etc/familyos/familyos.env`, then `chmod 700 /etc/familyos` and
   `chmod 600 /etc/familyos/familyos.env`. The secrets (Docker mounts these itself) go in
   `/etc/familyos/secrets` (700): `db_password` (the same password as in `DATABASE_URL`, mode
   600) and `tunnel_token`, the tunnel's token. `cloudflared` runs as a non-root user (65532), so
   its token belongs to it: `sudo chown 65532:65532 /etc/familyos/secrets/tunnel_token` and
   `sudo chmod 400 /etc/familyos/secrets/tunnel_token`. **Keep a copy of `familyos.env` in the
   password manager:** a backup is only usable with its `BETTER_AUTH_SECRET` and
   `INTEGRATION_ENCRYPTION_KEY`.
4. **Pick the hostname for good** (`BETTER_AUTH_URL`): passkeys are bound to it, so changing it
   later strands every one. Choose it before the first passkey is made.

### Cloudflare (once, in the dashboard)

1. Put the family's domain on Cloudflare DNS.
2. **Zero Trust → Networks → Tunnels:** create a tunnel (Cloudflared), copy its token into
   `tunnel_token`, and add a public hostname (the one in `BETTER_AUTH_URL`) for the service
   `http://app:3000`.
3. **Zero Trust → Access → Applications:** a self-hosted application for that hostname, with a
   policy that allows only the family: Microsoft Entra as the login method (the family's
   Microsoft 365 accounts), or one-time PINs to the family's email addresses. A session of about
   a month means each device signs in to Cloudflare about once a month; a shared kids' tablet
   needs a grown-up to do that once.
4. With Microsoft sign-in, add `<BETTER_AUTH_URL>/api/auth/callback/microsoft` as a redirect URI
   in the Entra app registration.

### Start, update, roll back

The server runs the images CI tested and published (Phase 46): `ghcr.io/d0nm3ga/familyos` and
`ghcr.io/d0nm3ga/familyos-migrate`, each tagged `sha-<full commit>` for every commit on `main`
from Phase 46 on (a pull request's own commits have none: pick one from `main`'s history).
A fork changes the owner in the compose file and the Dockerfile's source label.
The version it runs is pinned in one line, in a `.env` file beside the compose file. Compose reads
it for every command, the cron scripts included, and an image build never sees it
(`.dockerignore`). Only that line goes there; settings stay in `/etc/familyos/familyos.env`.

```bash
cd /opt/familyos
git fetch && git checkout <a commit on main>
echo "FAMILYOS_VERSION=sha-$(git rev-parse HEAD)" > .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The checkout and the image stay on the same commit: compose, the backup and break-glass scripts
and the Caddy file come from the checkout. `up -d` runs any new migrations first, then replaces
the app. **To update**, repeat with the new commit; **to roll back**, with the previous one. A
migration the older code doesn't know stays applied (if `migrate` refuses, see "A migration
failed"); the restore drill covers going back further. A typo in the version fails the pull
with an error, and a missing `.env` stops every compose command with "set FAMILYOS_VERSION":
nothing is built or pulled in its place. Commits from before Phase 46 have no image; their
checkout still builds on the server (`up -d --build`). Logs: `docker compose -f docker-compose.prod.yml
logs -f app`.

- **First time:** the packages are public (the owner's call, 2026-10-23), so the server pulls
  with no sign-in. The first publish from a new repository makes them private: set each one to
  public once (the account's Packages → the package → Package settings). Images built on the
  server before Phase 46 can then be removed (`docker image rm familyos-app familyos-migrate`).
- **Where an image came from:** each published image has a signed record of the workflow and
  commit that built it. On any machine with the GitHub CLI signed in:
  `gh attestation verify oci://ghcr.io/d0nm3ga/familyos:sha-<commit> --owner D0NM3GA`, then
  check the digest it names matches the one the server pulled (`docker image inspect
  ghcr.io/d0nm3ga/familyos:sha-<commit> --format '{{index .RepoDigests 0}}'`). The digest is the
  real pin: re-running CI for a commit pushes its `sha-` tag again.
- **Building on the server instead** (if the registry were ever unreachable): add the build
  file and use a tag of your own, never a published one:
  `FAMILYOS_VERSION=local docker compose -f docker-compose.prod.yml -f
  docker-compose.build.yml up -d --build`. Images are built for x86-64, like the server; a Mac
  builds its own the same way.

- **Sign-in limits and sessions:** request limits live in the database (Phase 42), so a restart
  doesn't reset them. A sign-in lasts 30 days, then each grown-up signs in again.
- **A migration failed:** the app stays down on purpose. Read `docker compose -f
  docker-compose.prod.yml logs migrate`, fix the cause, then `docker compose -f
  docker-compose.prod.yml run --rm migrate node_modules/.bin/prisma migrate resolve --rolled-back
  <migration name>` and start again.
- **Changing the database password later:** `POSTGRES_PASSWORD_FILE` only applies to a fresh
  volume, so run `ALTER USER familyos PASSWORD '…'` in the database
  (`docker compose -f docker-compose.prod.yml exec db psql -U familyos`), then update
  `db_password` and `DATABASE_URL` and restart.
- **Sentry:** `SENTRY_DSN` in the settings file, read when the app starts (Phase 46: never built
  into the image); the server hands it to each page for the browser. A restart applies a change.
- **Base images** (Node, Postgres, cloudflared) are pinned by digest in `Dockerfile` and
  `docker-compose.prod.yml`. Bump them by hand, with `.node-version` for Node, at least 7 days
  after a release, like npm packages.

### Only through Cloudflare Access (Phase 42)

With `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in `familyos.env` (Zero Trust → Access →
Applications → your app: the team domain, and the Application Audience tag), the app itself
checks Cloudflare's signed token on every request and refuses anything else, so nothing reaches it
except through Access, even from inside the house. If Cloudflare is down, nothing gets in: that's
what break-glass is for.

Pages also carry a strict script policy, and sign-in rate limits are kept in the database. A
sign-in lasts 30 days, then each grown-up signs in again.

If every request is refused, the app's log says why once a minute (`[access] Refused a request
… (wrong audience)` and the like): check `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`. A malformed
team domain is said at start, and every request but the health check gets a 503 until it's
fixed. The health check (`/api/auth/ok`) goes through the database-backed rate limits, so with
the database down the app shows as unhealthy and Docker restarts it.

### Break-glass: when Cloudflare is down (Phase 42.7)

An emergency entrance on the home network, **off unless you switch it on from the server**. It
serves the app's own hostname (passkeys only work there) with a certificate kept current in
advance, skips only Cloudflare's gate (everyone still signs in with their passkey), tells every
admin when it starts and ends, shows a banner on every page, and switches itself off after 24
hours.

Once:

1. In Cloudflare, make an API token that can only **edit DNS for the family's zone** and put it in
   `/etc/familyos/secrets/cf_dns_token` (600).
2. Put the VM's home-network address in `familyos.env` as `BREAK_GLASS_LAN_IP` (give the VM a
   fixed address on the router).
3. Root's cron (`sudo crontab -e`):

   ```bash
   0 4 * * 1   /opt/familyos/scripts/break-glass-cert.sh >> /var/log/familyos-cert.log 2>&1
   */10 * * * * /opt/familyos/scripts/break-glass.sh check >> /var/log/familyos-break-glass.log 2>&1
   ```

   Run `sudo /opt/familyos/scripts/break-glass-cert.sh` once now to get the first certificate.

In an emergency, at home:

1. On the server (Proxmox console, or SSH): `sudo /opt/familyos/scripts/break-glass.sh on`
   (24 hours; `on 4` for four).
2. Point the hostname at the VM for the devices that need it: a local DNS override on the router
   or Pi-hole, or a line in one device's hosts file (`<VM address>  <hostname>`). Browsers using
   their own secure DNS may skip the router's answer; the hosts file always wins.
3. Sign in as usual. When Cloudflare is back: `sudo /opt/familyos/scripts/break-glass.sh off` and
   remove the override.

Rehearse it every few months with the restore drill: switch it on, sign in from one device through
a hosts-file line, switch it off. `scripts/break-glass-test.sh` rehearses it against the image (CI
runs it).

### Nightly backups

A host cron job, as the owner:

```bash
15 3 * * *  BACKUP_NAS_DIR=/mnt/nas/familyos /opt/familyos/scripts/backup-prod.sh >> /var/log/familyos-backup.log 2>&1
```

It dumps the database (`pg_dump -Fc` through the running database container), checks the file
with `pg_restore --list`, keeps 14 days in `/var/backups/familyos` (600 files in a 700 folder),
and copies each one to the NAS share mounted at `BACKUP_NAS_DIR` (it stops with an error if
the share isn't mounted, rather than filling the VM's own disk, and compares the copy). To
restore one (Phase 42 turns this into a practiced drill): stop the app, restore in one
transaction (a failed restore leaves the database as it was), then start everything again so
any newer migrations run before the app:

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U familyos -d familyos --clean --if-exists --single-transaction < /var/backups/familyos/<file>.dump
docker compose -f docker-compose.prod.yml up -d
```

### Restore drill (Phase 42.6)

Every few months (and after any big change), prove a backup really restores:

```bash
scripts/restore-drill.sh /var/backups/familyos/<newest>.dump
```

It restores the dump into a throwaway stack beside the real one (its own database, network and
settings: no background jobs, fresh keys so nothing secret in the dump can be opened, no
Microsoft, alerts or tunnel), runs the migrations as an update would, starts the app and waits
for it to be healthy, compares row counts in the family's tables with the `.counts` file the
nightly backup writes beside each dump, checks a database carrying a migration the code doesn't
know still migrates (what a rollback leaves), then removes everything it made. Nothing it does
touches the real database. Rehearse break-glass at the same time.

### Testing the image

`scripts/container-test.sh` builds the image (`docker-compose.build.yml`, under a local tag),
starts it on a fresh database with throwaway settings (the app on `http://localhost:3100`, no
tunnel), checks the run image (nothing secret, no development tools, not root, no Sentry
address and no `NEXT_PUBLIC_` value, built with decoy Sentry settings in the environment to
prove compose forwards none), runs the browser tests against it, then backs up what they made
and restores it with the drill. CI runs it on `main` and on pull requests that change what goes
into the image; on any other pull request the check passes in seconds without building, so it can
be a required check (`.github/workflows/container.yml`). On `main`, a separate job then publishes
the images it tested ("Start, update, roll back"). `lib/deploy-guard.test.ts` keeps the rules:
no build arguments, no build in the production compose file, only the publish job writing to the
registry, every action pinned.

## Testing on phones (camera barcode scanning)

The grocery list's **Scan** button uses the camera, which browsers only allow on HTTPS (or
`http://localhost`), and Microsoft sign-in only allows plain http on localhost. So phones
need the dev server on a real hostname with a real certificate. On the PC, **Scan** already
works at `http://localhost:3000` with a webcam.

One-time setup:

1. **DNS:** point a hostname (e.g. `dev.example.com`) at this PC's LAN address
   (give the PC a DHCP reservation so it doesn't change). A record at
   the DNS host, or a local override on the router.
2. **Certificate:** get a Let's Encrypt certificate for that hostname with a **DNS
   challenge** (the PC isn't reachable from the internet, so the HTTP challenge can't
   work). On Windows, win-acme or certbot with your DNS provider's plugin. Save the key
   and full-chain certificate as PEM files outside the repo. They expire every 90 days.
3. **Entra:** in the app registration → Authentication → Web, add the redirect URI
   `https://dev.example.com:3000/api/auth/callback/microsoft`.
4. **Firewall:** allow inbound TCP 3000 on the Private network profile.
5. Copy `.env.lan.example` to `.env.lan` and fill it in.

Then:

```bash
npm run dev:lan     # https://dev.example.com:3000
```

Use that address on **every** device while it runs, the PC included: it sets
`BETTER_AUTH_URL` to it, so sign-in cookies belong to that address, not to localhost.
The dev test sign-in is off here (it's reachable from the home network); sign in with
Microsoft. Plain `npm run dev` only listens on this PC (127.0.0.1).
The decoder is the same on iOS, Android and desktop (zxing, compiled to WebAssembly and
served from this app).

## Family calendar

The **Calendar** app (`/calendar`) shows the family's week in one place: chores and doses,
birthdays and dates, homework and school calendars, car maintenance, and (for the signed-in
account's own profile only) its Outlook events. Each item links to where it lives. Kids have it too:
they see only their own school things, no cars and no Outlook.

### In Outlook

Calendar → **Outlook sync ⚙️** (`/calendar/outlook`, also in Settings) keeps a dedicated Outlook calendar
filled with birthdays, anniversaries and vehicle maintenance due dates (chores and meds are
optional). One-time setup:

1. **Entra portal:** App registrations → this app → API permissions → Add a permission →
   Microsoft Graph → Delegated → `Calendars.ReadWrite` → Add, then **Grant admin consent**.
   Sign-in doesn't ask for this permission, so nothing breaks before you do it.
2. Signed in as yourself (an admin, not a switched profile), open `/calendar/outlook`, tap
   **Grant calendar access** if it's shown, then **Connect**.
3. In Outlook, share the new calendar with the family ("Can view all details").
4. After an hour or more, tap **Sync now** once, to confirm writing still works after the
   Microsoft token has refreshed.

It updates when its owner uses the app (every 30 minutes at most) or taps Sync now; the app
stores no Microsoft token for background work. Disconnect deletes the calendar from Outlook.

## Alerts (Sticker Store orders)

Admins always get the in-app bell. On **Settings → Alerts for store orders**, any admin can
also turn on **Teams** and **email** for each admin, and each admin can turn on **phone
notifications** on their own phone.

### Teams (once, for the whole family)

One person builds one small workflow. After that, FamilyOS sends each alert to that one
link with the recipient's Microsoft sign-in address, and the **Flow bot** messages that
person in their own Teams chat. Nobody else has to set anything up. On **Settings → Alerts
for store orders**, any admin can switch Teams (and email) on for each admin.

1. In Teams, open **Workflows** and pick the webhook template (currently **Post to a chat
   when a webhook request is received**; Microsoft renames these now and then). Choose
   **Flow bot** and a chat with yourself for now, then finish. Copy the link it shows.
2. Open the workflow for editing (**Workflows → Manage → Edit**, which opens the Power
   Automate designer). In the trigger **When a Teams webhook request is received**, set
   **Who can trigger the flow?** to **Anyone**. FamilyOS doesn't sign in to call it (the
   link's `sig` is the password); new flows default to "Any user in my tenant", which makes
   FamilyOS report "Teams rejected the family link".
3. Inside **Apply to each**, open **Post card in a chat or channel** and set:
   - **Post as**: Flow bot
   - **Post in**: Chat with Flow bot
   - **Recipient**: switch to the expression (fx) tab and enter `triggerBody()?['recipient']`
   - **Adaptive Card**: don't touch it. The template already passes along the card FamilyOS
     sends.

   (The loop and step names vary by template version, e.g. "Send each adaptive card". You're
   looking for the step that posts a card; only **Post in** and **Recipient** change.)
   Save.
4. In FamilyOS, sign in with your own Microsoft account, paste the link under **Teams for
   the family**, and press **Send a test** for yourself.

**Money alerts in a group chat (Phase 30, optional).** A jar can send its alerts once to a
Teams group chat (jar Settings → **One Teams chat for this jar**). FamilyOS then adds a
`chatId` to what it sends, and the flow needs a second way to post:

1. In the flow, inside the loop, add a **Condition** before **Post card in a chat or
   channel**: expression `empty(coalesce(triggerBody()?['chatId'], ''))` **is equal to**
   `false`.
2. In **True**, add **Post card in a chat or channel**: **Post as** Flow bot, **Post in**
   Group chat, **Group chat**: *Enter custom value* → expression `triggerBody()?['chatId']`,
   and the same **Adaptive Card** as the existing step.
3. Move the existing Post card step into **False**. Save.

Whoever owns the flow must be in the group chat, or Teams refuses the post. If you added the
optional hardening Condition below, keep it around both branches (chat posts still carry a
family member's address). One-to-one chats
can't take Flow bot posts, so FamilyOS only accepts group chat links. The chat is not in
backups: set it again after a restore.

Optional hardening: add a **Condition** before Post card so it only posts when
`endsWith(triggerBody()?['recipient'], '@example.com')` (your own domain). Anyone holding the link
could otherwise message anyone in your tenant as the Flow bot.

Troubleshooting:
- "Teams accepted it" means the workflow received the request. If the message doesn't
  show up, open the workflow's **Run history**, pick the failed run, and look at the **Post
  card in a chat or channel** step.
- Each person must have signed in to FamilyOS with Microsoft once, so FamilyOS knows their
  Teams address. Guest and personal Microsoft accounts can't receive Flow bot messages.
- The Workflows app must be allowed in the Teams admin center.
- "Teams rejected the family link": the workflow is off or deleted, or step 2's trigger
  setting isn't **Anyone**.

The link contains its own password (`sig=`), so FamilyOS stores it encrypted, never shows it
again, and never logs it. Only an admin signed in with their own Microsoft account (not a
profile picked with a PIN) can replace or disconnect it, and the page shows who set it. Old
Office 365 "incoming webhook" connectors were retired in April 2026, so only Workflows
links are accepted.

### Phone notifications (each grown-up, on their own phone)

Straight from FamilyOS, no Teams needed. A phone alerts whoever turned it on last.

1. Nothing to set up on the server (Phase 45.2): it makes its own phone-alert keys the first
   time they're needed and keeps them in the database, encrypted with
   `INTEGRATION_ENCRYPTION_KEY`. Push services want a way to reach whoever runs the server, so
   it needs `CONTACT_EMAIL`, or the app served over `https://` (its own address is used
   instead, so no family email goes to Apple, Google or Mozilla unasked); Settings → Alerts says
   so if neither is there. Keys already in `.env` (`node scripts/generate-vapid.mjs`) still win.
   If the keys ever change, every phone has to turn alerts on again: if
   `INTEGRATION_ENCRYPTION_KEY` changes, Settings → Alerts offers an admin new keys.
2. Phone alerts need **https**: the real address, or `npm run dev:lan` for testing
   (README, Testing on phones).
3. **iPhone / iPad:** in Safari, open FamilyOS, tap **Share → Add to Home Screen**, then open
   FamilyOS from the Home Screen and sign in there (it has its own sign-in).
   **Android:** Chrome works as-is.
4. **Settings → My notifications → This phone → Turn on alerts on this phone**, then allow
   notifications. Any grown-up can (money alerts go to every jar member's phone); admins can
   also use **Send a test** in their row under Settings → Alerts.

My notifications lists your own phones to remove; any admin can also remove an admin's phone
from their row on Alerts (handy for a lost phone). If
notifications were blocked, allow them in the phone's settings and reload the page.

### Email (once, by an admin)

Alerts are sent from a shared mailbox with an app-only Graph token. Exchange **RBAC for
Applications** limits the app to that one mailbox. Do **not** add the Graph `Mail.Send`
application permission in Entra: Entra and Exchange grants add up, so an org-wide Entra grant would make the scope meaningless.

1. Exchange admin center → **Recipients → Mailboxes → Add a shared mailbox**, e.g.
   `familyos@example.com` (no license needed).
2. In Exchange Online PowerShell (`Connect-ExchangeOnline`), with the app registration's
   **Application (client) ID** and its **Enterprise application Object ID**:

   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> -DisplayName "FamilyOS"
   New-ManagementScope -Name "FamilyOS mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'familyos@example.com'"
   New-ManagementRoleAssignment -App <client-id> -Role "Application Mail.Send" -CustomResourceScope "FamilyOS mailbox"
   Test-ServicePrincipalAuthorization -Identity <client-id> -Resource familyos@example.com
   ```

   The test should show `Application Mail.Send` as **InScope: True** for the mailbox. Changes
   can take 30 minutes to 2 hours to apply.
3. Set `ALERT_MAILBOX="familyos@example.com"` in `.env` and restart.
4. On the Alerts page, turn on Email and press **Send a test**. Emails go to the address
   you sign in with (or the email on your People profile).

Alerts go to people with the **Admin** app role in Entra. Give both parents that role.

## Receipts (grocery prices)

After a trip, a grown-up can **📸 Snap the receipt** (the link on the "Trip saved!" note, or
`/groceries/receipts/new`). Azure AI Document Intelligence reads the store, date and each
line; FamilyOS matches the lines to what you bought and shows them for a quick check. Saved
prices show as **Last paid** on the item sheet and in the Pantry, for grown-ups only.
Matches you pick are remembered, so the next receipt fills in on its own. Nobody types a
price.

Privacy: the phone shrinks the photo (which also drops its location data) before sending it.
FamilyOS never stores the photo; it deletes the service's copy of the result straight after
reading (Microsoft otherwise keeps input and result for 24 hours). Only the prices you save
are kept.

### Set it up (once, by an admin)

It uses the same FamilyOS app registration as sign-in, with no API key and no Graph
permission: an Azure role on the one resource is the whole grant.

1. In the [Azure portal](https://portal.azure.com), create a **Document Intelligence**
   resource. Pricing tier **Free F0** (500 pages a month, plenty). Under networking/identity,
   give it a **custom subdomain name** (for example `familyos-docs`): Microsoft Entra
   sign-in only works on a custom subdomain.
2. On the resource: **Access control (IAM) → Add role assignment → Cognitive Services User**
   → members: the **FamilyOS** app (search by its name; it's the enterprise app behind the
   app registration). Role assignments can take about 5 minutes to apply.
3. Set `DOCINTEL_ENDPOINT` in `.env` to the resource's endpoint, e.g.
   `DOCINTEL_ENDPOINT="https://familyos-docs.cognitiveservices.azure.com/"`. FamilyOS refuses
   any other kind of address (it sends a token there).
4. Optional hardening, once a receipt reads fine: turn off key access so only Entra works:
   ```powershell
   Set-AzCognitiveServicesAccount -ResourceGroupName <group> -Name <resource> -DisableLocalAuth $true
   ```

Troubleshooting:
- **"refused this app (401/403)"**: the role isn't applied yet (wait 5 minutes), it was given
  to the wrong app, or the endpoint is a regional one rather than the custom subdomain.
- **"busy, try again in a minute"**: the free tier reads one request a second.
- **"Couldn't find any items"**: a flatter, brighter photo with the whole receipt in frame.

## Money jars (Finances)

Money lives in **jars**. Each jar has its own members, and nobody else sees it, an admin
included. You only get into a jar using FamilyOS as yourself, signed in with your own
Microsoft account: a profile switched to on someone else's sign-in (or by PIN) can't open
Money at all. So Grandma gets a jar of her own once she has her own Microsoft account in the
family tenant; she then signs in on her own and makes or joins her jar.

The honest boundary: this keeps money private inside the app. Whoever runs the server, the
database or the Microsoft tenant can still read the data.

### Bank feed (SimpleFIN, once per jar)

1. Sign up at [SimpleFIN Bridge](https://bridge.simplefin.org) (about $15/year) and link your
   banks and cards there.
2. In SimpleFIN, make a **setup token**. In FamilyOS: Money → the jar → Settings → Bank feed,
   paste it, Connect. The token works once; FamilyOS stores the connection encrypted with
   `INTEGRATION_ENCRYPTION_KEY`.
3. It syncs about once an hour at most (SimpleFIN allows ~24 reads a day): when you open the
   jar and it's over 6 hours old, or with Sync now.

### Privacy.com (optional)

Privacy.com charges also show up on the bank account that funds them. With your Privacy.com
API key (account settings) connected to the jar, those bank rows show the real store and
the card's nickname. FamilyOS only reads transactions, never card numbers.

### Statement files

Settings → Import a statement: OFX/QFX works best; CSV needs date, description and amount
(or debit and credit) columns. Re-importing the same file adds nothing. Rows the bank feed
already has fold in automatically; near matches show up under **Needs a look**.

### Bills

Found from the jar's own charges: weekly, every two weeks, monthly, every three months or
yearly, plus every Privacy.com card. The bank feed only reaches back about three months, so
a yearly bill shows up once older statements are imported (two steady charges a year apart,
on a Privacy card or in Bills / Subscriptions).

**Coming up** lists the regular bills (monthly or slower, and subscriptions; not the weekly
grocery run) expected in the next 30 days, plus any a few days late, with about how much they
add up to. One line per bill, so the total is "about". A bill whose price moved and stayed
moved (the latest charges agree on a new price, more than $1 or 5% away from the steady price
before it) shows 📈 or 📉, until it changes again; a rise is also a money alert under the
bills switch, once, when the second charge at the new price arrives.

**✍️ Added by hand** covers what charges can't show: school fees, a yearly registration, a
bill paid by check. Name, amount, how often (monthly, quarterly, yearly or once) and the next
due day. They count in Coming up, the 30-day total, Safe to spend and the bill-due and
low-balance alerts exactly like found bills. If one stands for a bill that's also found from
charges, pick it under "Already found from charges?" (or give it the same name) and it's
counted once. Anyone in the jar sees them; they're in both money backups.

### Activity

One month at a time (← Older / Newer →), with a chip for every category. Tap a charge for its
details and everything you can do with it: category ("just this one" or "always for this
merchant"), the order it paid for, the grocery trip, a 🎁 surprise. **Spreadsheet** at the bottom
downloads this month or everything as a CSV for Excel: only members can, surprises hidden from
you are left out, and each download shows in the jar's history.

### Categories

Settings → **🏷️ Categories**: each jar's own, so changing them in one jar leaves the others
alone, and everyone in the jar sees the change (it's in the jar's history). Rename one (and its
emoji) in place: every charge, budget and "always for this store" rule keeps pointing at it.
**+ Add** a spending or income category (spending ones go just before Other; pay in any income
category counts for Safe to spend). **Remove…** moves its charges, its rules and its budget to
the category you pick, of the same kind, then removes it: two budgets add up; if only the
removed one was saving up, the one you pick takes over its saving up and goal, and if both
were, the one you pick keeps its own (the question says which, before you confirm). What the
app did with the removed one carries on in the one you pick: charges it would have guessed
there, grocery trips, and Bills spotting bills and subscriptions. Other, Income and Transfers
can be renamed but not removed, since the app counts on them, so their rows have no Remove
(settings lists only show what you can change). Names are 1 to 40 characters, one per jar
ignoring case; the emoji is optional, one emoji.

### 💸 Safe to spend

On the **Bills & ahead** tab: how much is free until the next payday. In Settings → **Safe to
spend**, tick the day-to-day spending accounts (checking; not credit cards or savings) and,
if you like, a cushion ("keep at least $500 in checking"). It starts from those accounts'
balance (the bank's available balance, with its "as of" time), takes off every regular bill,
card autopay and savings sweep that leaves those accounts before payday, finds the lowest
point, and subtracts the cushion. "How it's worked out" lists every line.

- **Payday** is regular money in on those accounts, filed as 💵 Income or 🔄 Transfers, from
  somewhere that never takes money out, and big enough to be pay. Every two weeks (a bonus
  under the same name is fine), the 1st and 15th (weekend shifts included; it needs two
  paychecks on each day first), weekly and monthly are recognised. No payday found: it
  looks two weeks ahead and says so; put your paycheck in Income on Activity and it'll find it.
- A bill due today or a few days late is counted today, unless about that much already left
  checking (another regular bill's charge doesn't count as paying it).
  Card payments that change every month count at the most they've been lately. A card paid
  by hand on no fixed day isn't counted. Two checking accounts moving money between each
  other on a schedule count it as money out (a known limit).
- **Alert** (Settings → Alerts for me, on by default, nothing until accounts are ticked):
  "Family may run low before payday (around Oct 12)", once per pay period (even if payday is a
  day or two late), only with a payday
  found and a balance from the last two days, never with amounts.
- A plan, not a promise: only regular bills are counted, and the balance is a day old at most.

### 🐷 Saving up

On the Budget page, a category with a monthly budget can **roll leftovers into next month**:
what it doesn't spend carries forward, and overspending comes out of it, so lumpy costs
(school fees, car registration, birthdays, a yearly subscription) have money waiting. Add a
goal ("Need $400 by August") and it shows how much to put aside each month and how close you
are; setting a goal turns rollover on. The carry uses the current monthly budget for every
month since rollover was turned on (up to two years), so changing the budget changes what's
carried; turning rollover off (or taking the budget off) forgets the carry and the goal. A
surprise hidden from you doesn't count against a category until its reveal day, so your
carry can read a little higher than the person who marked it. "Over budget" for these
categories means over budget plus carry. Nothing moves real money: it's a plan.

### 📈 Trends

The **Trends** tab shows money out for each month of the last year (bars stacked with what
isn't in a category yet, in grey) and, for the month you tap, where it went: each category's
amount and share, a small month-by-month line, and the change from the month before. The
month in progress is compared with the same days of last month ("Compared with Sep 1–7").
Every number is the Budget page's for that month: US-dollar accounts only, transfers left
out, pending charges counted, and a refund comes off its category in the month it arrives (a
refund the month after the purchase makes that month $0, not negative). A surprise hidden
from you shows only in the month's **🎁 Surprises** line, never with a day. Tap a category
to open Activity filtered to that category and month (Activity takes `?month=` too, with a
📅 chip to clear it). The bars start when the jar's money does. Bunson only ever notes a
category that came in lower (two whole months, at least $25 and 20% down); there's no alert.

### 💎 Net worth

The **Net worth** tab adds up what the jar has and takes off what it owes: bank-feed balances
(a credit card or loan the bank sends as a negative balance is listed under **What we owe**),
plus things the feed can't see, typed in by hand: the house, the cars, a 401(k), a loan at
another bank. Each has a value and the day it was worth that (back to 1950, so the purchase
price counts); **Update** adds a new value (the same day again replaces it), **Values so far**
can take a wrong one off, and **Remove** takes the whole thing out of every month (sold the
car? set it to $0 instead and the past stays). A home, car or other value older than about
six months, a loan older than three, or a bank balance not updated in 45 days gets a
🕰️ "still right?" nudge, on the page only.

The bars show net worth at each month's end for the last year (this month so far, matching
the big number). Bank balances are kept from the day the feed first syncs after Net worth
arrived, one per account per day, so earlier months start out **paler**: they're missing some
balances, and the "since last month" and "since a year ago" changes and Bunson's cheer only
compare with a whole month. A thing typed in counts its first value back to the start of the
bars. US-dollar accounts only. Statement files don't carry a balance, so an account that only
has those isn't counted: add it below as something you own if it should be.
Balance history and the typed-in values are in both backups; changes are in the jar's history.

### 🎁 Surprises

On any charge in Activity: **🎁 Surprise?** → pick who it's hidden from (other jar members)
and the day it can be seen (within a year). Until then those people don't see the charge
anywhere (Activity, Needs a look, Bills, alerts); their Budget shows one **🎁 Surprises**
total instead, so the month still adds up, and everyone sees how many surprises are waiting.
Only whoever marked it can **Show it now** (which shows the order email on it too). An
order email still waiting for its charge can be marked the same way, and its charge keeps
the mark when it arrives. The bank's own app still shows everything, and
for the few minutes a bank lists a charge as both pending and posted, the unmarked twin can
show; once the pending one drops, the posted one takes the mark.

### Money alerts

Each member picks their own in the jar's Settings → **Alerts for me**: a bill due in the next
3 days (monthly or slower, or a subscription) or a bill that went up (Phase 31), the bank feed
or Privacy.com not syncing for a day, a category over budget (off unless turned on; once per
category a month, even if the budget is raised and passed again; a saving-up category counts
its carry), and checking that may run low before payday (Phase 32). They go to the person's Teams chat
through the family's Teams link (see Alerts), to their phone if it's set up, and to the
bell. They never include amounts. They're sent by the background jobs (`BACKGROUND_JOBS`),
which also sync each jar every 6 hours, so the server has to keep running (the home
container does).

**One chat for the jar (Phase 30).** Instead of a Teams message to each person, a jar can post
its alerts once to a Teams group chat: make a group chat with everyone in the jar (no kids),
copy its link in Teams (the chat's ⋯ → Copy link, or a link to any message in it) and paste it
in Settings → **One Teams chat for this jar**, then **Send a test**. The family flow needs one
extra step for this (see Alerts → Teams). The chat gets every kind of alert anyone in the jar
has switched on, but only ones everyone can see: an alert about a 🎁 surprise still goes only
to the people who can see it, in their own Teams chat. Everyone still gets the bell and their
phone, by their own switches.

### 🕘 Who changed what

The jar page's **🕘 Recently** (and **See all**) lists what people changed: categories (set on a
charge, or added, renamed and removed) and "always" rules, budgets, Bills answers, order and grocery-trip links, surprises, members,
connections, imports, the Teams chat. The automatic tidy-ups aren't listed. Anything about a
surprise (the charge, or a rule or Bills answer for its store) is left out for the people it's
for, until the reveal day. History is kept a year and isn't in backups.

### One account, one jar

The same account in two jars would count every charge twice. So:
- **Privacy.com**: connecting a key that's already connected in another jar you're in is
  refused, naming that jar. If you're not in that jar, nothing is said (someone else's jar
  stays private) and it connects.
- **Bank feed**: a bank account that already comes in through another jar the person who
  connected the feed is in is left out, and Settings says how many. The other jar is named
  only to people who are in it. SimpleFIN can't tell FamilyOS that two logins are the same
  bank, so if your spouse links the same bank under their own SimpleFIN login into a jar they
  aren't sharing with you, both jars get it.
- Statement files aren't checked: they go into the account you pick.

### 📬 Order emails

In a jar's Settings → **Order emails**, a member can have FamilyOS read order emails from
**Amazon, Apple and Publix** in their own Microsoft mailbox (nothing else is opened; the app
already has read access to your own mail from signing in). Only the order is kept (retailer,
order number, date, total, item names), never the email. It reads when you open the jar, at
most every 6 hours (or **Scan now**), looking back 90 days the first time.

- An order is put on the charge that paid for it (same total, the retailer's name on the
  charge, within a few days; Amazon up to three weeks; Publix within 15% since you pay at the
  register). Amazon charges each shipment separately, so a split order sits in **From your
  email, not matched** at the bottom of the jar, where you can pick its charge.
- Everyone in the jar sees the orders right away (it's a shared family jar). The only
  exception is a surprise: an order on a charge marked 🎁 is hidden with it, and an order
  still waiting for its charge can be marked **🎁 Surprise?** itself (same rules as a
  charge). When it's matched, by itself or by hand, the charge takes the same mark (unless
  someone already marked that charge).
- A mail only counts if your mail server confirmed it really came from the retailer
  (Authentication-Results), so a fake "Amazon" email can't add orders. Orders never change
  amounts, categories or budgets.
- Amazon's confirmations no longer list item names, only a category ("Floor Care"). Sam's
  Club isn't read yet (its emails carry no prices).

Money jars ride in the household backup **sealed** (an admin can't open them; see Backups), and
each member can download their own readable copy (**Keep a copy** on the Money page). Bank
connections aren't in either: reconnect after a restore. Keep your statement files too.

## Backups

There are two kinds of backup:

- **In the app: Settings → Data & backups (`/data`).** Any adult can download a CSV of any
  section (people, chores, points, meds, groceries, vehicles) to open in Excel or share.
  Admins can download a **whole-household backup** (`.json`) with everything that lives
  only in this app. It never includes PINs, sign-in links, photos (those come from
  Microsoft 365) or stored integration secrets. Store it like the `.env` file: it holds
  meds, contacts, notes and the household location.
- **Money jars in it are sealed** (Phase 28): every jar is inside, encrypted on the server
  with `INTEGRATION_ENCRYPTION_KEY`. The admin holding the file can't read them; only a
  FamilyOS server with the same key can. **Keep that key with your backups** (a password
  manager, not next to the file): without it the sealed jars can't come back. Bank
  connections aren't included (members reconnect).
- **Putting money jars back** (Phase 28.5): when restoring, tick **Also put the money jars
  back** to replace today's jars with the file's. You only see counts, never what's inside;
  jar members are told. Grown-ups who haven't signed in on this server yet (a rebuilt
  server) keep their jars and get them on their first Microsoft sign-in. Restoring without
  the box is refused while a jar member hasn't signed in (it would take them out of their
  jar). Bank feeds need reconnecting in each jar's Settings; this month's bill alerts may
  come again. Backups made before Phase 28.5 can't put jars back: make a fresh one. Jars
  follow the Microsoft account people sign in with, not the email on their People card;
  someone waiting to sign in can't have that email changed until they have.
- **Your own money jars:** Money (`/finances`) → **Keep a copy** downloads a readable file
  of the jars you're in, as you see them (surprises meant for you stay out).
- **Who, how, and a record (AAA).** Backups and restores are made by the person themselves
  (their own Microsoft sign-in, not a switched profile), signed in within the last 15
  minutes: the page offers **Sign in again**. The app can't force a password prompt itself;
  Entra does ("Sign in every time" under How access works). Every backup and restore is in
  **Backup history** on
  `/data` (who, when, size, a fingerprint of the file) and announced in Teams and the bell:
  a household backup or restore to the other admins and everyone in a money jar (adults
  with their own Microsoft sign-in), your own money copy to you and the other members of your
  jars (never anyone outside them, admins included). Pressing it again within 5 minutes is
  recorded but not announced again.
- **Restoring that file** (same page, admin signed in with Microsoft only) **replaces** the
  household's data with the file's. You see what will change first and type `REPLACE` to
  confirm; a copy of the household as it was downloads automatically. People who sign in
  with Microsoft keep their sign-in. Afterwards, set PINs for restored family members in
  Settings → Household, and reconnect any integrations (Kroger etc.).
- **The whole database: `npm run db:backup`**, below. This is disaster recovery for this
  machine, including sign-in and security data.

```bash
npm run db:backup   # writes backups/<db>-<timestamp>.dump (gitignored, local only)
```

Restore into a running Postgres container (drops and recreates matching objects first).
This copies the file into the container rather than piping it in, so the same two
commands work in PowerShell, cmd, and bash alike:

```bash
docker compose cp backups/<file>.dump postgres:/tmp/restore.dump
docker compose exec postgres pg_restore -U familycrm -d familycrm_dev --clean --if-exists /tmp/restore.dump
```

(A shell redirect like `pg_restore ... < backups/<file>.dump` works in bash, but PowerShell
doesn't support `<` and will error — use the two commands above instead.)

Backups contain live Microsoft Graph tokens and PIN hashes — treat the `backups/` folder
like the `.env` file: never commit it, never send it anywhere unencrypted. This only writes
to the local `backups/` folder; nothing is scheduled or copied off the machine yet — see
[docs/PLAN.md](docs/PLAN.md) "Open items" for that as part of the hosting move.

## Error monitoring (Sentry)

Errors and a sample of performance traces go to your own Sentry project when `SENTRY_DSN` is
set (`.env` in development, `/etc/familyos/familyos.env` on the server; `SENTRY_ORG` /
`SENTRY_PROJECT` are only for a future source-map upload). Phase 46: it's read when the app
starts and handed to each page for the browser, never built into the image. (It was
`NEXT_PUBLIC_SENTRY_DSN` before: rename the line.) Leave it empty and Sentry is
completely off, which is the case in tests and CI.

**This app holds health, contact and location data, so what may be sent is locked down in
code** (`lib/observability/`; see docs/BUILD.md Phase 15). Sentry never receives:
- names, emails, IP addresses, or cookies (users are an opaque id);
- request or response bodies, or URL query strings;
- database query values, or local variables;
- console output, the machine's hostname, or its timezone;
- the household's coordinates (weather-service requests aren't traced at all).

Clicked-element descriptions keep the element but lose its labels (avatars are labeled by
name). The browser's user-agent string is kept only on web-vital measurements, which
Sentry needs to score them, and on browser sessions. There's also no session replay and no
feedback widget. Every import of `@sentry/*` outside `lib/observability/` and the root
`instrumentation*`/`sentry.*.config` files fails lint, so nothing can bypass those rules.

**One setting has to be switched on in Sentry itself:** Project Settings → Security &
Privacy → **Prevent Storing of IP Addresses**. Without it, Sentry's servers geolocate the
*connection* an event arrives on, which the SDK can't prevent (verified live: without it,
events showed the household's city). While there, also turn on **Data Scrubber** and **Use
Default Scrubbers**, and add `q`, `email`, `phone`, `firstName`, `lastName` under
**Additional Sensitive Fields**.

Source maps aren't uploaded yet; that needs `SENTRY_AUTH_TOKEN` and waits for hosting. Dev
stack traces are readable anyway.

## How access works (and what's still not built)

**Setting up a new install (Phase 40.1c).** The first page a brand-new install shows is
`/setup`: whoever opens it first names the household and becomes its admin, with a **passkey**
on their device (or, if the install has Microsoft, by signing in with a Microsoft account that
has the Admin role). **Finish setup right after installing, before anyone else can reach the
address**: until it's done, anyone who opens it could set the app up instead (the owner's call:
a first-visitor setup rather than a one-time link from the server). Once a household exists,
`/setup` is gone.

**Passkeys** sign grown-ups in with their device's own PIN, fingerprint or face; kids stay on
PIN profiles under a grown-up's sign-in. A passkey belongs to the address the app is served
at (`BETTER_AUTH_URL`): changing that address later means making new passkeys. In
development use `http://localhost:3000` (not `127.0.0.1`, and not a phone on `npm run
dev:lan`'s LAN address: passkeys need a name, not an IP). Better Auth limits sign-in attempts
per address in production. Behind a reverse proxy, put the proxy's address (or subnet) in
`TRUSTED_PROXIES` so it reads the client's real address from `X-Forwarded-For`; without it,
only a header with exactly one address is believed, so the proxy must then overwrite the header
rather than add to it.

**Your own passkeys (Phase 40.2a).** Settings → My passkeys adds a passkey on another device, or a
spare, so losing a phone doesn't lock you out; it also renames and removes them. Adding one
asks for a sign-in from the last 5 minutes (it's a new way in), removing one from the last 15;
your last passkey can't be removed, and removing one signs you out on your other devices. People who sign in with Microsoft use
Microsoft only (the owner's call), so Entra's Conditional Access always applies to them. Every
change to a sign-in goes in the sign-in audit log (the page's "Recent changes").

**Inviting a grown-up (Phase 40.2b).** Which ways in an install has (passkeys, and Microsoft when
its `MICROSOFT_*` values are set) is set in `.env`; Settings → Sign-in says which are on, in a
sentence rather than a list (the owner's call). An admin, signed in within the last 5 minutes, invites
someone from Settings → Sign-in: a grown-up already in the household on a PIN, or someone new,
as Adult or Admin. The app shows a link once; send it to them yourself (it works once, for 48
hours). They open it on their own device, signed out, and make a passkey with one tap. From
then on their tile opens only when they sign in themselves, not with a PIN. Waiting invites can
be cancelled, and every invite is in the audit log. A backup restored onto a fresh install
brings people back without their sign-ins: invite passkey people again.

**Looking after other people's sign-ins (Phase 40.2c).** Settings → Sign-in lists the other
grown-ups who sign in with a passkey. An admin, signed in within the last 5 minutes, can make
them an admin or not, **reset their passkeys** when they've lost a phone (their passkeys and
sign-ins everywhere stop, and the admin gets a link, good for one hour, to hand over in person),
or **take their sign-in away** (they're a PIN profile again, never an admin, and need a new PIN
from Settings → Household; not for someone in a money jar). The app always keeps at least one
admin who can sign in. Each change goes in the audit log, and the person is told every time
(by email too where the install can send it); other admins are told unless they switch that off
in My notifications.

**Your own OIDC provider (optional, Phase 40.3).** Families with an identity provider (Google,
Authentik, Keycloak, Pocket ID…) can sign in with it: register a confidential client there with
the redirect address `<BETTER_AUTH_URL>/api/auth/callback/oidc`, set the four `OIDC_*` values in
`.env` (see `.env.example`), and restart. It must say whether an email is verified
(`email_verified` in its ID token or userinfo response) for invites to use it. At start the
app checks it can reach the provider; if it can't, the app starts without it and the sign-in page
just doesn't offer it until a restart (the owner's call). Nobody gets in through it uninvited:
the first visitor can set the app up with it, and after that an admin's invite offers "Use
<provider> instead" next to the passkey, which only works with an account whose email the
provider has confirmed and that matches the invite's (a reset's link stays passkey-only).
Signing out leaves the app, not the provider; "sign in again" asks the provider to check again
(it may not). Admins change the role of, or take away, an OIDC person's sign-in in Settings →
Sign-in like a passkey person's (there's nothing to reset). Switching to a different provider
later means everyone on it is invited again.

**Microsoft (optional).** Sign-in is pinned to the family's single Entra tenant. Role (**Admin** or **Adult**) comes
from an Entra **App Role** assigned to your Microsoft account — not a guess by the app —
re-checked on every request. A new-ever sign-in with no Admin/Adult role assigned (e.g. a
kid's own Microsoft 365 account — kids do have real accounts, they're just not meant to
use them against this app yet) is turned away at `/not-provisioned` rather than defaulting
to Adult. Kids' day-to-day access is still the local, PIN-gated profile picker, operating
inside whichever adult is actually signed in. Admins can view the household roster at
`Settings → Household` and remove someone who doesn't sign in with Microsoft (a kid, or a
grown-up on a PIN); it asks first, and any adult can add them back from their People page.
People who sign in with Microsoft are added and removed in Entra, so their rows have no
Remove, and the page says so once (the owner's call, Phase 38; Settings lists show only what
can be changed). Taking someone's app role away in Entra cuts them off (Phase 40.4, "Checking
Entra" below).

**Checking Entra (Phase 40.4).** With Microsoft on, the app asks Entra every half hour (and when
an admin presses **Check now** in Settings → Sign-in) who is assigned to it, with its own Graph
access: grant the app registration the **application** permissions `Application.Read.All` and
`GroupMember.ReadBasic.All` and give **admin consent** (Entra admin center → App registrations →
the app → API permissions). `Application.Read.All` lets it read every app registration's
settings in the tenant (not secrets); there's no narrower permission for this. Roles follow
Entra; someone no longer assigned as Admin or Adult (Kid doesn't count) is cut off on the first
check that says so (the owner's call): signed out everywhere, not an admin anywhere in the app,
invites and reset links they made stop working, and no alerts leave the app for them (a jar's
shared Teams chat is the chat's own: take them out of it there). They and the other admins are
told, and it's in the audit log. A later sign-in that Entra gives a role to
brings them back. Only a group's **direct** members count (Entra doesn't pass an assignment down
to nested groups either), and a group with hidden membership needs `Member.Read.Hidden` too. Any
trouble reading Entra changes nothing, and a check that would leave no admin who can sign in is
refused. Keep **Assignment required?** on for the app (Enterprise
applications → the app → Properties), so Entra refuses anyone unassigned before they reach the
app (except Global Administrators, whom Entra lets through regardless; the app's own rule below
turns them away); group assignment needs Entra ID P1. At sign-in, a Microsoft account whose token has no Admin
or Adult role gets no access, whatever it had before.

The picked profile lasts only for the sign-in it was picked in: signing out (or someone else
signing in on the same tablet) sends you back to the picker, and a profile that signs in
with Microsoft only ever opens for that person's own sign-in. Five wrong PINs in a row lock
that profile for 15 minutes, and each further lock doubles (30 minutes, an hour, ... up to a
day) until the right PIN is entered. Kids' PINs are 4 to 6 digits; a grown-up who uses a PIN
instead of Microsoft needs 6 (from the next time their PIN is set).

Every response carries security headers (no framing by other sites, `nosniff`, a
same-origin referrer, camera only for this site; HSTS once it runs in production). A full
Content Security Policy for scripts and styles isn't set yet: it needs nonces for Next's
inline scripts.

### What stays on a phone (Phase 44.2)

Opening the Groceries pages starts the app's service worker (`public/sw.js`), which keeps one
copy of the Shop list on that device so it opens in a store with no signal: the page as it
last loaded, with the script and style files it needs, and nothing else (no other page and no
API answer is ever saved or served stale). It's saved only from a clean answer (never a sign-in
redirect or an error page), replaced whole each time Shop opens with signal, dropped after
7 days, and removed when anyone signs out on that device (every sign-out goes through
`lib/auth-client.ts`'s `signOut`; `lib/sign-out-guard.test.ts` checks). Opening any other page with
no signal shows a small "No signal" page with a link to the saved list, with no family data in
it. Check-offs made offline (Phase 23) wait on the device per household and are kept through a
sign-out, so they're sent the next time anyone in the family signs in there; ones older than
7 days are dropped. The owner's calls (2026-10-22): the family has no shared devices (any
device more than one person uses is managed in Intune), so the saved list stays when someone
switches profile.

### Sign in every time (Conditional Access, once by an admin)

A "fresh sign-in" unlocks your own tile without its PIN, lets you set or change that PIN, and
allows the backups. Microsoft remembers you on its own, so without this policy a kid at a
shared tablet could tap **Sign out**, **Sign in**, pick your account and be "fresh" with no
password. Entra closes that (the owner's call, 2026-10-09); the app needs no change.

1. **Licence:** [Entra admin center](https://entra.microsoft.com) → Overview should show
   **Microsoft Entra ID P1** (or P2). Business Premium includes P1.
2. **Security defaults:** if the tenant still uses them (Entra ID → Overview → Properties →
   Manage security defaults), first create Microsoft's baseline "Require MFA for all users"
   policy, then turn security defaults off. Conditional Access can't run alongside them.
3. If **Remember MFA on trusted devices** is on, turn it off; Microsoft says it fights with
   sign-in frequency.
4. Entra ID → **Conditional Access** → **Policies** → **New policy**, named
   "FamilyOS: sign in every time":
   - **Users:** include All users; exclude your emergency (break-glass) account.
   - **Target resources:** Select resources → **FamilyOS** (the app registration). This works
     for a web app like ours because Entra applies a policy to a server-side app whenever it
     asks for a sign-in (ID) token.
   - **Grant:** Grant access → **Require multifactor authentication** (without MFA, "every
     time" can loop).
   - **Session:** Sign-in frequency → **Every time**.
   - **Enable policy:** **Report-only** first.
5. Check it: sign out of FamilyOS and sign in again; the sign-in log should show the policy
   would have applied. Then switch the policy to **On** and try again: Microsoft asks for your
   password or Authenticator. The Outlook calendar card should still load an hour later
   (for background token refreshes Microsoft waits for your next real sign-in).

Microsoft won't ask more than once every 5 minutes, so a sign-out and sign-in within 5
minutes of a real one still goes through without a password. That's a small gap, and it's
accepted.

**Who can reach the app at all** is Entra's: with **Assignment required?** on (above), anyone in
the tenant who isn't assigned is refused by Entra itself, before the app (Global Administrators
aside, whom the app refuses itself without an Admin or Adult role). Conditional Access
policies (sign-in frequency, MFA) apply on top. See [docs/PLAN.md](docs/PLAN.md) "Open items."

## Make it yours

An admin opens **Settings → Make it yours** (Phase 35). Everything there is for the whole
family, on every device, kept in the database and the household backup, never in the code:

- **App name:** type the family's name and the app adds the "OS": Smith becomes SmithOS,
  with the sunny OS like FamilyOS's (up to 22 characters before it). It shows in the top bar,
  sign-in, "Who's using…?", tab titles, phone alerts, emails and the Home Screen. Blank is
  FamilyOS.
- **Top bar color:** Ink (the original), Ocean, Forest, Berry, Plum, Clay, Teal or Slate,
  for the top bar, the rail and the main buttons in light and dark mode. Presets only, each
  checked for readable white text (`lib/theme-colors.ts`, with a contrast test).
- **What the kids earn:** stickers and the Sticker Store, or stars / points / coins / gems,
  or the family's own word ("acorn", "acorns", "Acorn Shop"). Only the words change;
  balances stay.
- **The mascot:** visits everyone (each person can still turn him down in their own menu)
  or off for everyone, which hides him everywhere; and his name (Bunson by default).
- **Home Screen icon:** the bunny, or the app name's first letter in sun yellow on the top
  bar color, drawn at every size the browser and phones ask for. A new look reaches the tab
  on the next reload in Chrome (within a week of ordinary browsing) and on the next load in
  Firefox; an unchanged icon is a quick "not modified" (Phase 39).

One family per install: before anyone signs in (the sign-in page, the Home Screen name and
icon) the app shows the install's own household's choices. A phone keeps the name and icon it
was installed with until the app is added to the Home
Screen again. Outside services (weather, Open Food Facts, school feeds, Sentry) only ever see
the product name, FamilyOS.

### Turning apps off

Not every family needs every app. An admin turns them on and off in **Settings → Apps**, which
lists only the apps that have a switch: Calendar, Chores, Meds, Groceries, School, Money, Store
and Cars. The Garage has no switch of its own; it goes with Cars. Home, People, Data and
Settings are always on (the app needs them to work, and Settings is how you'd turn things back
on), so they aren't in the list.

A turned-off app disappears for everyone: the rail, the launcher, the phone's bottom bar,
Home's cards, search, the calendar week, the bell and Bunson's chatter. Opening one of its
pages (a bookmark, an old tab) leads to a short "turned off for your family" note instead, and
its spreadsheets aren't offered. Someone already in the app sees the change on their next page.
Its background work pauses too: Money's bank syncs, order emails and alerts; the Outlook
calendar sync; school calendar feeds; car recall checks. Nothing in the app is deleted, the
household backup keeps everything (and which apps were off), and turning an app back on
brings it all back.

Two things to know: with the family calendar in Outlook connected, a turned-off Chores, Meds,
School or Cars takes its events off that calendar (they're copies, made again when the app is
back on). And bank feeds and order emails only reach about 3 months back, so Money off for
longer than that leaves a gap the app can't fill in later (a statement file can).

## Privacy

The repository holds nothing about the family that runs it, so it could be published as
open source. Real names, emails, domains, places, schools, banks and the like live only in
`.env` and the database; code, tests, seeds and docs use a made-up family (Dad, Mom, Grandma,
kids Ivy and Max, `example.com`). The rules for building it are in [AGENTS.md](AGENTS.md)
"Privacy and naming".

`npm run privacy:check` looks for your family's real details in every file, the branch name
and commits not yet on `main` (messages and author emails), and for hidden characters
(zero-width, bidi controls) that could hide text from a reviewer. It reads them from
`.git/info/privacy-terms`: one term per line (surname, first names, domain, town, school...),
never committed, shared by every worktree. Run it before each commit and pull request.
`npm run privacy:check -- --history` instead counts which terms appear anywhere in the git
history, across every branch.

**Before making the repository public:** removing the working tree's details doesn't remove
them from history. Either publish a fresh repository started from a clean snapshot (simplest:
one commit, nothing to rewrite), or rewrite this one's history (`git filter-repo` with a
replace-text file, then force-push every branch and have every clone re-clone). Check the
result with `--history`, and make sure the GitHub owner's name and the commit author emails
don't identify you either. `--history` only sees what's in this clone: run `git fetch --all`
first so every branch is counted. Pull request titles, descriptions and comments live on
GitHub, not in git, and GitHub keeps serving old commits by their id even after a rewrite;
a fresh repository leaves all of that behind, which is why it's the simpler choice.


## Project layout

```
app/(app)/          authenticated app shell + feature pages (people, chores, meds, groceries, vehicles)
app/(app)/…/actions.ts   server actions (all scope every mutation by householdId)
app/api/            Better Auth handler + the authenticated photo-serving route
components/tasks/   shared recurring-task board UI (Chores and Meds both render from this)
components/vehicles/  Vehicles' own board UI — not on the shared task engine, see below
lib/                prisma client, auth, session, active-profile, and the
                    tasks/ (shared recurring-task engine — Chores and Meds both ride this)
                    vehicles/ (bespoke mileage-and/or-date engine — Vehicles does NOT ride tasks/)
                    groceries/ graph/ domain modules
prisma/             schema, migrations, seed
docs/               PLAN.md (roadmap) and BUILD.md (phase log + acceptance record)
```

## License

MIT (see [LICENSE](LICENSE)): use it, change it and share it, keeping the copyright notice. It
comes with no warranty. The app's dependencies keep their own licences.
