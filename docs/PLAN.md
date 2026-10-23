# FamilyOS plan

> The public version of the project plan: where FamilyOS is going and what's decided. What
> each phase actually built is in [docs/BUILD.md](BUILD.md). FamilyOS is a
> non-commercial family app; each family names its own copy in Settings.

## Vision

A HubSpot-style "CRM for the family": one app for chores, groceries, contacts and staying in
touch, calendars, finances, school, vehicle maintenance and medication tracking. It started
with three modules (People, Chores, Groceries) and grew one module at a time, as smaller
sub-apps (in the style of the Microsoft 365 admin center) that share one set of data.

**Guiding principle: copy someone else's homework.** Features aren't invented from scratch.
The app ports proven data models, recurrence logic and UX from established open-source
projects and known-good commercial UIs, re-expressed in its own stack.

## Locked decisions

### Stack and design

| Decision | Choice |
|---|---|
| Starting modules | People Hub, Chores, Groceries |
| Stack | Next.js 16 (App Router) + TypeScript, Tailwind v4, Postgres 17 + Prisma 7, all in Docker |
| UI reference | HubSpot CRM: top search bar, left icon rail, record pages with an info card, a tabbed activity column and a rail of related records |
| Design direction | Warm and family-friendly (rounded type, warm grays, a terracotta accent), with motion and a small mascot; light and dark themes |
| Chores homework source | [Donetick](https://github.com/donetick/donetick): recurrence engine, assignment rotation, points, adaptive scheduling |
| Groceries homework source | [Grocy](https://github.com/grocy/grocy): shopping list, product, quantity unit and store data model |

Grocy is PHP and Donetick is Go, so their backends can't be vendored into a Next.js app. What
the app takes is **schemas, recurrence rules, API shapes and UX flows**, ported to TypeScript.

The chore engine is deliberately generic: medication doses ride the same recurring-task engine.
Vehicles have their own model, since mileage isn't knowable in advance the way a date is.

### Security model

- **Sign-in through trusted libraries, never home-made.** Better Auth handles Microsoft Entra
  ID, any one OIDC provider, and passkeys. A first-run setup makes the first admin with a
  passkey, since most families won't have SSO.
- **Kids don't need accounts.** A Netflix-style profile picker with a PIN inside a grown-up's
  household session. PINs are hashed with Argon2id (explicit settings, rehashed on login).
- **Roles live in Entra for Microsoft users.** Entra app roles (Admin, Adult) arrive as token
  claims and are never set in the app's own UI. Conditional Access decides who can reach the
  app at all, so there's no app-level email allowlist. Instead of SCIM, the app asks Microsoft
  Graph every half hour who's assigned, so a removal in Entra takes effect.
- **A "fresh sign-in" is enforced by Entra**: a Conditional Access policy with sign-in frequency
  "Every time" plus MFA (needs Entra ID P1). Sensitive pages (money jars, passkeys, invites)
  ask for a sign-in from the last few minutes.
- **Only through Cloudflare Access in production.** The app checks the Access token on every
  request and fails closed. A break-glass local entrance, off unless switched on from the
  server and loud when it is, covers a Cloudflare outage.
- **Sessions last 30 days, then sign in again**, matching Access's monthly session.
- **Secrets never in code or the database in plaintext.** Integration tokens and server keys are
  encrypted at rest with a key from the environment; a family's private money jars are sealed.
- **A nonce-based Content-Security-Policy**, database-backed rate limits, strict security
  headers, and a guard test that every destructive action asks first.
- **Least data leaves the house.** Error monitoring (Sentry) sends no PII, no replays, and an
  opaque person id only.
- **Kids never see money.** A family jar is shared among grown-ups by default; surprises, other
  grown-ups' own jars and kids' data are private. Admins can back up everything, sealed jars
  included.

### Microsoft 365 integration

One Microsoft Graph integration covers mail, calendar, contacts, Teams and the Entra checks.

| Service | Role | Integration path |
|---|---|---|
| Entra ID | Grown-up SSO and roles | Better Auth's Microsoft provider, re-keyed on Entra's `oid` |
| Exchange | Family email | Graph `Mail.Read`: recent mail on People records, order and receipt emails into money jars |
| Outlook calendar | Family calendar | Graph read for the Home calendar (each Microsoft grown-up picks their own); a "Family" calendar the app writes dates into |
| Teams | Alerts | Teams-first alerts, with email and phone push as other channels |
| Google Calendar | Existing family calendar | Read through Graph only, because it is already synced into Outlook |
| Google Voice | Family number and contacts | No official API: texting stays manual (deep links). Contacts come from Google Contacts in Phase 8.5 |

### Self-hosting

- **Hosted privately at home**: a Debian VM running Docker on a Proxmox host, reached from
  anywhere through a Cloudflare Tunnel (no router ports opened) with Cloudflare Access in
  front.
- Settings in one locked-down host file outside the repository; nightly `pg_dump` backups kept
  14 days on the host and copied to a NAS, with a restore drill every few months.
- **The hostname is permanent**: passkeys are bound to it. It lives only in the host settings
  file and Cloudflare, never in the repository.
- Dev and production stay as close as possible: the same image runs the browser tests in CI.
- **Nothing goes live, and no real family data goes in, until the security phase (42) is
  done.**

### How the work runs

Each phase goes scope → independent scope review → build and verify → independent
implementation review → fixes → one pull request, merged when the owner says so. A phase that
changes what admins or the family see also updates the guides in `docs/guides/`.

## Roadmap

Status: **merged** (on `main`), **next**, **later**, **waiting** (on the owner's call).

### Foundation and first modules

| Phase | What | Status |
|---|---|---|
| 0 | App shell, schema (household, unified person, accounts, kid profiles), sign-in | merged |
| 1 | People Hub: record pages, index, last-contacted tracking, interaction log | merged |
| 2 | Chores: the generic recurring-task engine, board, points ledger | merged |
| 3 | Groceries: products, units, stores, a phone-first shopping list | merged |
| 4 | Microsoft 365 pass: calendar on Home, recent emails on People | merged |
| 4.5 | Foundation hardening; roles from Entra app-role claims | merged |
| 5 | Meds on the task engine, multi-dose schedules | merged |
| 6 | Vehicle maintenance, due by mileage or time | merged |
| — | Dark mode | merged |
| 7 | Cross-domain foundation: household settings, global search, activity feed | merged |
| 8 | People: stale contacts, relationships, member summary card | merged |
| 8.5 | Google Contacts sync, one-way pull | waiting |
| 9 | Meds: medication stock and refills, prescriber and pharmacy, RxTerms autocomplete | merged |
| 10 | Groceries: product groups, staples auto-suggest, barcode add | merged |
| 10.5 | Barcode camera scanning (zxing-wasm, self-hosted) | merged |
| 11 | Chores: weather-sensitive chores, milestones, rewards shop | merged |
| 12 | Vehicles: fill-ups and MPG, cost of ownership, NHTSA recall alerts | merged |
| 12.5 | Vehicle supplies catalog that counts stock down | merged |
| 13 | Print views (shopping list, fridge chore chart, meds, people, vehicle) | merged |
| 14 | Next.js security upgrade | merged |
| 15 | Sentry error and performance monitoring, scrubbed | merged |
| 16 | Exports: per-domain CSVs and a versioned household backup | merged |
| 16.5 | Restore from backup (replace the household, admin only) | merged |
| 17 | Calendar write-back to a "Family" Outlook calendar | merged |
| 18 | School: student profiles, teachers, forms, homework and grades | merged |
| 18.5 | School calendar feeds (iCal, SSRF-guarded) | merged |

### The family-facing app

| Phase | What | Status |
|---|---|---|
| 19 | Sticker Book shell: the look, navigation, the app's name | merged |
| 19.5 | Big buttons view and mascot moments | merged |
| 20 | Sticker Store: kids spend what they earn | merged |
| 21–21.6 | Alert channels: Teams, email, central Teams alerts, phone push | merged |
| 22 | Groceries: one add box, item sheet, Pantry | merged |
| 23 | Groceries: Shop view (check-offs queue offline) and kid picks | merged |
| 24 | Receipt prices (Azure AI Document Intelligence) | merged |
| 25 | Money jars: accounts, bank feeds, statement import, one reconciler | merged |
| 26 | Money jars: categories, budget, bills, grocery trips | merged |
| 27 | Loop-closers and surprises | merged |
| 28–28.5 | Per-person backups with sealed jars, and restoring them | merged |
| 29 | Order emails into money jars | merged |
| 30 | Shared-jar polish and a jar Teams chat | merged |
| 31 | Saving up with goals, and what's coming up | merged |
| 32 | Safe to spend until payday | merged |
| 33 | Spending trends | merged |
| 34 | Net worth: daily balances plus hand-entered home, car and loan values | merged |
| 35 | Make it yours: name, colors, reward word, mascot, icon | merged |
| 36 | Apps on and off | merged |
| 37 | Editable store sections and money categories | merged |

### Polish, sign-in and going live

| Phase | What | Status |
|---|---|---|
| — | Privacy pass: no family details in the code; `npm run privacy:check` | merged |
| 38 | Sharp edges: confirm in place, no double submits, a guard test | merged |
| 39 | Performance: query counts, loading screens, icon caching | merged |
| 40 | Sign-in: Better Auth, passkeys, invites, admin care of sign-ins, any OIDC, Entra checks | merged |
| 41 | CI and browser tests on every pull request, weekly supply-chain checks | merged |
| 43 | Production container and HTTPS through a tunnel | merged |
| 42 | Security: CSP with nonces, database rate limits, Access check, restore drill, break-glass | merged |
| 45 | Settings hub, guided setup, home location without coordinates | merged |
| 46 | Publish the tested image; the server pulls it instead of building | merged |
| 44 | Polish: accessibility checks on every page, Shop list without signal | merged |
| — | Kids' allowance | waiting |
| — | Remove the dev sign-in | later |
| — | LMS connector (Canvas or Google Classroom) | waiting |
| — | Settings friction fixes (see Phase 45, "Not in this phase") | later |

### Phases 42–45 in brief

- **Phase 42 — Security.** Dependencies brought up past known critical advisories; a per-request
  nonce Content-Security-Policy; Better Auth's rate limits moved to the database so they survive
  a restart; the Cloudflare Access token checked on every request (fails closed); a scripted
  restore drill into a throwaway stack; and a break-glass entrance for a Cloudflare outage.
- **Phase 43 — Production container.** A pinned multi-stage, non-root, read-only image; a
  production compose file (database, one-shot migrations, app, tunnel) with Docker secrets; a
  run book for updates, rollbacks and backups; and CI that runs the browser tests against the
  production image.
- **Phase 44 — Polish.** WCAG 2.2 AA as the target, with axe checks on every page in both themes
  and layouts, plus fixes (skip link, one `<main>` per page, focus handling, linked form
  errors). The Shop list opens without signal from a cached copy that expires after 7 days and
  is cleared on sign-out.
- **Phase 45 — Settings hub and guided setup.** Settings as grouped tiles that show their
  state; a walkthrough right after first-run setup and a "Finish setting up" checklist; home
  location from the device or a ZIP code (rounded to about a kilometer, looked up offline);
  phone-alert keys and the timezone set up without editing the server's settings.

## Current state

Everything through Phase 46 is merged to `main` (2026-10-23). The project moved to this public
repository the same day (one clean commit; the earlier history is archived privately). `main`
takes changes only through pull requests: a ruleset requires the three CI jobs and the container
check, and a pull request merges itself once they pass. Every merge to `main` publishes the
tested app and migrate images (`ghcr.io/d0nm3ga/familyos`, `…-migrate`, public, tagged
`sha-<commit>`, with signed provenance).

**Next:**
1. **Go live** (the owner's steps, deferred on 2026-10-23): the server, Cloudflare Tunnel and
   Access, the pinned version, backups and break-glass, following `docs/guides/admin.md`; then
   enter the real family. The database still holds test data only.
2. **Slim the migrate image** (2.26 GB: it's built from the full install stage, but only needs
   Prisma's CLI), so each publish is faster.
3. Then the open items below: the Settings friction fixes and the decisions waiting on the
   owner.

## Phase 46 — scope (publish the tested image, 2026-10-23)

**The owner's call:** after the move to a public repository, CI publishes the production image
it has just tested, and the home server pulls that image instead of building its own. The
server then runs exactly what passed, and an update or a rollback is "pull this version".
Fable's scope review (2026-10-23) is folded in.

### 46.1 — Publish only what passed

- On a push to `main`, after *Production image and browser tests* passes, a separate job pushes
  the app image (`run` stage) and the migration image (`migrate` stage) to GitHub's container
  registry: `ghcr.io/<owner>/familyos` and `ghcr.io/<owner>/familyos-migrate`, with the owner
  lowercased (registry names must be lowercase; the account name isn't).
- **The tested bytes, not a rebuild:** after the container test and the break-glass rehearsal
  (which reuses the same images), the test job saves both images by name into one archive
  (`docker save`, shared layers stored once, kept one day); the publish job loads and pushes
  them. Only the publish job can write to the registry (`packages: write`, `id-token: write`,
  `attestations: write`, `contents: read`), and it runs no npm install, no build and no tests,
  so no dependency's code ever runs with a token that can publish.
- **Tags:** `sha-<full commit>` (never moves; matches `git rev-parse HEAD` on the server) and
  `main` (the latest). The commit lives in the tag and the provenance record, not in the image:
  the Dockerfile carries only fixed labels (`org.opencontainers.image.source` pointing at the
  repository, which links the package to it, and the licence).
- **Provenance:** a GitHub attestation action signs, for each pushed digest, which workflow and
  commit built it, and stores the record in the registry next to the image. Attest first, then
  move `main`.
- **Order:** each push to main is a concurrency group of its own (only pull request runs cancel
  each other), so no merge's run is cancelled or dropped and every commit on main gets its `sha-`
  image; the publish job moves `main` only if its commit is still the branch's head, so a slow
  run can't point `main` back at an older commit.
- Pull requests never publish.

### 46.2 — Nothing about one family in a public image

- **Sentry's address moves from build time to run time, under a new name.** Today
  `NEXT_PUBLIC_SENTRY_DSN` is a build argument, and Next inlines `NEXT_PUBLIC_*` into both the
  browser and the server code at build time, so a published image would carry one family's
  Sentry project (or, built without it, ignore the setting at run time). It becomes
  `SENTRY_DSN` in the settings file, read only on the server: the server's Sentry setup and the
  script policy read it per request, and the root layout puts it on the page
  (`<html data-sentry-dsn>`), where the browser's Sentry setup reads it. Shared Sentry options
  take the DSN as a parameter instead of one module-level constant. A clean rename: the docs
  and the example settings say to rename the line (no install uses it yet).
- The Dockerfile has no family-specific build argument (`NODE_IMAGE`, the base image pin,
  stays). `scripts/container-test.sh` builds with a decoy `NEXT_PUBLIC_SENTRY_DSN` in the
  environment (proving compose forwards nothing from the build machine) and checks that no
  Sentry ingest address appears in the image's code and its environment has no `NEXT_PUBLIC_`
  value; the guard test checks `.dockerignore` keeps settings files out of the build context.
- A guard test reads the Dockerfile, the compose files and the workflow: no `NEXT_PUBLIC_`
  build argument, no `build.args`, the publish job's permissions exactly as above, and every
  action pinned to a full commit SHA from `actions/`.

### 46.3 — Deploy from the registry

- `docker-compose.prod.yml` names images only: `app` and `migrate` use
  `${FAMILYOS_IMAGE:-ghcr.io/<owner>/familyos}:${FAMILYOS_VERSION:-main}` and
  `…familyos-migrate` at the same version (the two never differ). With no `build:` in the file,
  a failed pull (a typo in the version, the registry down) is an error, never a quiet local
  build under the release's name. Building stays possible through an override file,
  `docker-compose.build.yml`, which the CI stack and a build on the server add with `-f`.
- **Update:** set `FAMILYOS_VERSION` to the new `sha-…` tag in a one-line `.env` beside the
  compose file (compose reads it for every command, the cron scripts included; `.dockerignore`
  keeps it out of any build; unset is an error, never `main`), move the checkout
  to the same commit (compose, the break-glass and backup scripts and the Caddy file come from
  it), then `docker compose pull` and `up -d`. **Roll back:** the previous tag, same steps.
  Checking provenance: `gh attestation verify` on the pulled digest (from any machine with `gh`;
  the README says how, and to compare it with the digest the server pulled).
- **First deploy:** the package's visibility (below), then the same steps; the old locally built
  images can be pruned.

### 46.4 — The break-glass build warning

- `lib/security/break-glass.ts` reads its state file with a path the bundler can't know, so
  Turbopack traces the whole project into the standalone server: every source file, the
  README and the compose files end up in the image (and on a dev machine, `.env` in the local
  build). The read uses `process.getBuiltinModule("node:fs/promises")`, which the bundler
  doesn't trace (a Next import hint doesn't apply to file reads). Done when the warning is gone,
  the middleware's traced project files drop to near zero, and `scripts/break-glass-test.sh`
  still passes.

### The owner's answers (2026-10-23)

1. **Package visibility: public.** The server pulls with no credentials; the image holds only the
   public code. (GitHub can't make a package private again once it's public.)
2. **The server runs a pinned version:** a `sha-…` tag, changed on purpose to update or roll
   back; `main` is never what the server follows.

### Checks

- Lint, types, unit (the guard test), database and browser tests; the container test with the
  decoy check; the break-glass rehearsal; the publish job on the merge to `main`, then pulling
  the published images and verifying their provenance; the privacy check.

### Not in this phase

- Automatic deploys to the server (a watcher that pulls new images): the owner updates by hand.
- CodeQL code scanning: a repository setting (Settings → Code security), no code needed.
- Images for other CPU types: CI builds for x86-64, as the server runs; a Mac builds its own.

## Open items

### Waiting on a decision

- **Kids' allowance:** none, an IOU ledger, or stickers that cash out (the owner's call).
- **Google Contacts sync (Phase 8.5):** one-way pull, waiting on a Google Cloud project with a
  published consent screen (an unpublished one issues refresh tokens that expire weekly), and
  on which account to connect and whether to filter by label.
- **LMS connector:** Canvas or Google Classroom, once the school's system is known. It fills
  `SchoolAssignment` through `source` and `externalId`.
- **Better Auth `cookieCache`:** recommended off for now.

### Known limitations and later work

- **The dev sign-in (`DEV_AUTH`)** still exists for development; production refuses to start
  with it. Removing it before going live is planned (the owner's call to keep it for now).
- **Dates follow the server's clock** until the deployment's `TZ` matches the household's zone;
  using the household timezone in every date calculation is later work.
- **Teams alerts need a Power Automate flow**; a "Connect Teams" button through Graph, and
  picking a jar's Teams chat from a list, are later work.
- **Other setup friction, each its own phase:** finding the school calendar from the school's
  web address, statement imports that work out their own columns, VIN entry or scanning, smoother
  bank-feed setup, the alert mailbox set and tested in Settings, a link to Entra's role
  assignments.
- **Order emails:** improvements to forwarded order mail are deferred. Sam's Club orders can't
  be priced, since its emails carry no prices.
- **Accessibility:** a screen-reader audit by a person is worth doing once the family uses the
  app; no translations.
- **Offline:** only the Shop view is cached; no other page or API answer is ever served stale.
- **Security, not in scope:** a CSP violation reporting endpoint, and Cloudflare settings (WAF,
  bot rules) beyond Access.
- **No automatic image updates:** CI publishes a tested image for every merge (Phase 46); the
  server moves to one when the owner changes its pinned version.
- **Accepted audit item:** `braces` under ESLint only, re-dated in README "Dependencies".
- **Drug interactions** are out of scope: NIH retired its interaction API in 2024.

## Appendix: API integration candidates

The aim is to pull in real data wherever an official, stable API exists, and to avoid building
on unofficial ones.

### Free and official

| API | Module | What it gives | Status |
|---|---|---|---|
| Microsoft Graph | Core | Mail, calendar, contacts, Teams, Entra assignments, one OAuth | in use |
| Google People API | People | Contacts sync | Phase 8.5 |
| Open Food Facts | Groceries | Barcode → name, brand, image; no key | in use |
| NHTSA vPIC + Recalls | Vehicles | VIN decode and open safety recalls | recalls in use |
| FuelEconomy.gov | Vehicles | Official MPG and fuel-cost data | candidate |
| openFDA + RxNorm / RxTerms (NIH) | Meds | Drug names, autocomplete, DailyMed link-out | in use |
| NWS (weather.gov) | Chores, Home | US forecasts, no key; flags weather-sensitive chores | in use |
| Nager.Date | Calendar | Public holidays | candidate |
| ICS feeds | School | School and sports calendars, no auth | in use |
| Census Gazetteer ZCTA | Settings | ZIP → rough location, bundled offline (public domain) | in use |
| Telegram Bot API | Alerts | A family-group bot (Donetick's pattern) | not adopted: the family doesn't use Telegram; Teams, email and Web Push instead |

### Official but conditional

| API | Module | Condition | Status |
|---|---|---|---|
| SimpleFIN Bridge | Money | About $15 a year, read-only bank transactions built for personal apps | in use |
| Privacy.com | Money | Virtual-card transactions into money jars | in use |
| Azure AI Document Intelligence | Groceries, Money | Receipt line items and prices | in use |
| Teller | Money | Free dev tier; reverse-engineered banks, needs a fallback | not adopted |
| Kroger API | Groceries | Real prices and cart push, only for Kroger-banner shoppers | not adopted |
| Smartcar | Vehicles | Odometer-driven maintenance; depends on the car and on hosting | candidate |
| Canvas LMS / Google Classroom | School | Assignments and grades via a parent observer token | waiting on the school's system |
| Home Assistant | Everything | Presence, NFC chore tags; only if already deployed | candidate |

### Retailers without consumer APIs

Amazon, Walmart and Sam's Club offer no consumer API for orders, lists or receipts (Amazon's
product API now needs affiliate sales; Walmart's is approval-gated; Sam's Club's portal is for
advertisers). So purchases are captured three retailer-agnostic ways:

1. **Order and receipt emails** read through Graph and parsed into purchase records.
2. **Periodic manual exports** (order-history downloads) with importers the app provides.
3. **The bank feed** as the backstop: every retailer's total, without line items.

### No official API (avoid)

- **Google Voice**: manual, deep links only.
- **Google Photos**: the Library API is limited to app-created content; no ambient sync.
- **Alexa shopping lists, GasBuddy, Life360, GoodRx**: unofficial APIs only.
- **Plaid**: official, but sales-led production access is the wrong fit for a family app.
