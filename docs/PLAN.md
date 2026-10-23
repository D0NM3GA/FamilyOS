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

Status: **merged** (on `main`), **next**, **later**, **waiting** (on the owner's call),
**tabled** (until the owner says it's time).

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
| — | Go live on the home server | tabled |
| — | Remove the dev sign-in (just before going live) | tabled |
| — | LMS connector (Canvas or Google Classroom) | waiting |
| 48 | Slim the migrate image to Prisma's CLI | merged |
| 49 | The household's timezone in every date calculation | next |
| 50 | Teams without Power Automate | later |
| 51 | Find the school calendar from the school's web address | later |
| 52 | Statement imports that work out their own columns | later |
| 53 | Smaller setup fixes: VIN, bank feeds, alert mailbox, Entra role link | later |

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

Everything through Phase 46, and Phase 48 (the migrate image cut from 2.26 GB to about 690 MB),
is merged to `main` (2026-10-23). The project moved to this public
repository the same day (one clean commit; the earlier history is archived privately). `main`
takes changes only through pull requests: a ruleset requires the three CI jobs and the container
check, and a pull request merges itself once they pass. Every merge to `main` publishes the
tested app and migrate images (`ghcr.io/d0nm3ga/familyos`, `…-migrate`, public, tagged
`sha-<commit>`, with signed provenance).

**Tabled until the owner says it's time (2026-10-23):** going live (the server, Cloudflare
Tunnel and Access, the pinned version, backups and break-glass, following
`docs/guides/admin.md`, then entering the real family) and, with it, removing the dev sign-in.
The database still holds test data only.

**Next, the remaining engineering work, in this order** (each its own phase and pull request;
the owner's questions are asked at each scope):
1. **Phase 49 — The household's timezone in every date calculation**, so "today", due dates and
   streaks no longer depend on the server's `TZ`.
2. **Phase 50 — Teams without Power Automate:** a "Connect Teams" button through Graph, and
   picking a jar's Teams chat from a list.
3. **Phase 51 — Find the school calendar** from the school's web address.
4. **Phase 52 — Statement imports that work out their own columns.**
5. **Phase 53 — Smaller setup fixes:** VIN entry or decoding, smoother bank-feed setup, the
   alert mailbox set and tested in Settings, a link to Entra's role assignments.

The decisions waiting on the owner are under "Open items".

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

## Phase 48 — scope (slim the migrate image, 2026-10-23)

The migrate image is 2.26 GB because it is the whole `install` stage: every dependency of the
app, its build tools and its test tools, to run one command, `prisma migrate deploy`. Each
publish pushes it, and each server update pulls it. A spike that kept only Prisma's CLI and
what it needs came to 686 MB, and it applied every migration to a fresh database under the
production limits (read-only root, no capabilities). Fable's scope review (2026-10-23) is
folded in.

### 48.1 — Only Prisma's CLI, from the same install

- A `migrate-deps` stage from `install` rewrites its own `package.json` to list only `prisma`,
  as a dependency so an `--omit=dev` from the environment can't prune it (keeping `overrides`,
  without which npm would re-resolve and fail offline, and `allowScripts`), runs `npm prune
  --offline --ignore-scripts`, and deletes the scope folders the prune emptied. What is left is
  a subset of the tree `install` built from the lockfile: the same versions, the same files, and
  the schema engine its approved install script already fetched. Nothing is downloaded or
  resolved again, so there's no second lockfile to keep in step and nothing for the 7-day
  cooldown to miss.
- Why not a separate `package.json` and lockfile for the migrate image: two lockfiles drift, and
  each Prisma upgrade would need both changed and checked. Why not a list of directories to
  copy: Prisma's tree changes with each release, and a missed package only shows up as a failed
  migration on the server.

### 48.2 — A migrate image from the base image

- The `migrate` stage starts from `${NODE_IMAGE}`, not `install`, and copies in only the pruned
  `node_modules` and `package.json`, `prisma.config.ts`, `prisma/schema.prisma` and
  `prisma/migrations`. No seeds, no app code, no lockfile, no `.npmrc`. Root-owned files,
  `WORKDIR /app` (the command and the run book use relative paths), `USER node`,
  `CHECKPOINT_DISABLE=1` (Prisma's usage check-in stays off, as it is in CI), the same labels
  and the same command, so `docker-compose.prod.yml`, the restore drill and the "A migration
  failed" steps (`prisma migrate resolve`) are unchanged.

### 48.3 — Guards

- `lib/deploy-guard.test.ts`: the migrate stage starts from the base image, sets `WORKDIR`,
  copies nothing but from `migrate-deps`, and runs as `node`; the prune is `--offline
  --ignore-scripts`, keeps `prisma` as a dependency and leaves `overrides` and `allowScripts`
  alone.
- `scripts/container-test.sh` (the test CI and a Mac both run): checks the migrate image like
  the run image (not root; no settings, lockfile, `.npmrc`, seeds or `.next`; no `next`,
  TypeScript, test tools or `@prisma/client`; no empty folders; the CLI starts), prints both
  image sizes, and fails when the migrate image is over 1 GB (uncompressed), so a later change
  can't quietly bring the whole install back.

### 48.4 — Docs

- README (the image section), `docs/BUILD.md` and this plan. Neither guide changes: admins pull
  and run the image exactly as before, and the family sees nothing.

### Checks

- Lint, types, unit (the guard test), database and browser tests; the container test, which runs
  the new migrate image on a fresh database before the browser tests; the restore drill
  (`migrate deploy` on restored data, and on a database with a migration it doesn't know);
  `prisma migrate resolve` run from the new image; the privacy check.

### Not in this phase

- Deleting parts of Prisma's own dependencies (Studio, its local dev server) by hand: they are
  the CLI's declared dependencies, and a hand-made cut would break quietly on a Prisma release.
- A distroless or Alpine base: the schema engine `install` fetched is matched to this base
  image's C library, and the app image uses the same base.

## Phase 49 — scope (the household's timezone everywhere, 2026-10-23)

"Today", due dates, streaks, the week on the calendar and every date the server prints follow
the server process's clock (`TZ`), not `Household.timezone`. Settings → Household only warns
when the two differ. A sweep found about 140 server call sites that use the local clock
(`atMidnight`, `addDays`, local getters, `toLocale…` with no zone, `todayCivil`), 6 in the
browser, and a handful of columns that store a day as the server's local midnight. A few places
already read the household zone (`lib/people.ts` `dayInZone` and `middayInZone`,
`lib/calendar/agenda.ts`, school feeds, `formatEventWhen`). Most of finance is zone-free
(`@db.Date` columns and UTC civil-date maths); its "today" (`todayCivil`) and
`lib/finance/grocery-link.ts` `localDay` use the local clock.

**The approach (recommended): the server's clock is the household's.** One server serves one
household by design, so instead of passing a zone through 140 call sites, the app sets its own
process zone to the household's. Node 24 picks up `process.env.TZ` changes at run time: local
`Date` getters, `toLocale…` and `Intl` defaults follow at once (checked). The deployment fits:
one standalone Node process, no render workers, `proxy.ts` on the Node runtime, and no
`use cache`, `unstable_cache` or `revalidate` anywhere. Prisma is unaffected: its Postgres
adapter reads and writes `timestamp(3)` as UTC. Better Auth and Sentry use instants only. The
alternative, a zone passed into every date function, is a far bigger change with more ways to
miss a spot, and only pays off with several households per server, which this app will never
have. Fable's scope review (2026-10-23) is folded in.

### 49.1 — The server follows the household's zone

- `lib/household-zone.ts`: `applyHouseholdZone(zone)` sets `process.env.TZ` to the zone's
  canonical name only (an unknown name would silently become UTC; Intl's canonical form can
  differ, e.g. `Asia/Calcutta` for `Asia/Kolkata`) and logs a change once. It runs at start
  (`instrumentation.ts`, skipped during `next build`), on every request where
  `app/(app)/layout.tsx` already reads the household settings (a string compare), on every
  background tick, after the zone is saved (Settings → Household, the guided setup) and after a
  restore. Re-applying per request and per tick closes the start-up window and keeps a second
  app instance in step. With no zone set, the deploy's `TZ` is used as before.
- No `Intl.DateTimeFormat` kept at module level (a made formatter keeps its zone for good) and
  no date worked out at load (`CURRENT_YEAR` in `app/(app)/vehicles/actions.ts`): a guard test
  checks for both.
- The mismatch warning (`warnIfTimezoneMismatch`, Settings' "the server is set to …" notice) is
  retired. A comment where the zone is set says why the process zone is global state on purpose
  (one household per server).

### 49.2 — Stored days move with the zone

- **`Household.dayZone`** (new) records the zone the stored days were written in. Whenever it
  differs from the zone to apply, the days are moved first, then `dayZone` is set. That covers
  a zone change in Settings, the first save of a zone, and **the upgrade itself**: setup already
  stores the device's zone, so installs today can have `Household.timezone` set while their days
  were written in the deploy's `TZ`. The migration starts `dayZone` empty, and the first apply
  after the upgrade treats it as a move from the process zone.
- **What moves:** `TaskDefinition.startDate`, `TaskInstance.dueDate`,
  `VehicleMaintenanceItem.lastDoneAt`, `VehicleServiceLog.doneAt`, `VehicleFuelLog.filledAt`,
  `SchoolTask.dueDate`, `SchoolAssignment.dueDate` for rows typed in (feed rows are already in
  the household zone, `lib/school/feeds/refresh.ts`), and `ItemPrice.observedAt` where it came
  from a receipt's printed date without a trip (`lib/groceries/receipts.ts`). The build confirms
  the list against every writer. **What doesn't:** instants (`createdAt`, `completedAt`,
  sign-ins, calendar and feed events) and the people dates `middayInZone` already writes in the
  household zone.
- **The move** is SQL in one transaction: each value's date and clock time in the old zone
  become the same date and clock time in the new one (`AT TIME ZONE`), so a chore due Tuesday
  stays due Tuesday and an 8:00 AM dose stays at 8:00 AM. Postgres settles clock times that
  don't exist or happen twice on a DST change the same way every time. `TaskInstance` is
  unique on `(definitionId, dueDate)`, checked row by row, so a 12-hour move of an 8 AM and an
  8 PM dose would collide halfway: the rows go to a far-off placeholder first, then to their
  new values.
- **The lock:** instances are generated on page loads (Home, Chores, Meds, a person's page,
  the print chart, the calendar, calendar sync) with `createMany` outside a transaction, not
  only by background jobs. The move takes an exclusive advisory lock (the pattern in
  `lib/setup.ts`); instance generation runs in a transaction holding the shared one, so nothing
  is written in the old zone halfway through a move.

### 49.3 — Backups and restores

- `exportedTimeZone` records `dayZone`, the zone the backup's days are written in. Older backups
  recorded the server's zone, which before this phase is what the days were written in, so both
  read the same way. Today a restore across zones is refused unless the admin accepts the shift
  ("Dates would shift"). Instead, the restore moves the restored days from `exportedTimeZone` to
  the restored household's zone (feed-made school rows excepted, as above), says so in the
  restore summary, sets `dayZone` and applies the zone. A member's own money download
  (`/api/backup/my-money`) holds only jar data, whose dates don't depend on a zone.

### 49.4 — The browser shows the household's dates

- The 6 browser call sites (the chore and meds forms' start date, the Shop list's saved note,
  `formatRelative` on task cards, the bell and the points orders; the build confirms the list) get the server's "today" or the
  zone as a prop and format with `timeZone`. That also ends the possible mismatch between the
  server's render and the browser's.

### 49.5 — Away from home: both times (the owner's call)

- When a grown-up's or kid's device is in a different zone from the household's (a vacation),
  timed things show the home time first and the time where they are beside it, so medication
  stays on its regular schedule: "8:00 AM at home · 2:00 PM here". That covers dose times on
  Meds, Home and task cards, timed calendar and Outlook events, and other times of day the
  server prints. Days stay the household's days: a chore due Tuesday is due on home's Tuesday.
- A small shared component renders the home time on the server (so the first render matches)
  and adds the "here" time in the browser after it loads, only when the zones differ. A short
  note at the top of Home says once that times show home and here while away.
- The device's zone is read in the browser (`Intl`), never sent to or stored on the server.

### 49.6 — Tests

- Vitest runs with a fixed zone that has daylight saving (`America/New_York`), so date tests
  don't depend on the developer's machine.
- Unit: the move across a DST change, dose times, month ends, a clock time that doesn't exist
  and one that happens twice; canonical names only.
- Database: a save that moves days; the two-dose collision; the upgrade move (`dayZone` empty,
  household zone set, process zone different); typed-in versus feed school rows; the lock
  against instance generation; a restore across zones, including an older backup.
- Browser: change the zone in Settings and find a chore still on its day; with the browser in a
  different zone from the household's, a dose shows both times; in the same zone, only one.

### 49.7 — Docs and guides

- `docs/guides/admin.md`: set the timezone in Settings; the server's `TZ` no longer has to match.
  `familyos.env.example`: `TZ` is only used until a zone is set. README, `docs/BUILD.md`, this
  plan. `docs/guides/family.md`: what the two times mean while away.

### Checks

- Lint, types, unit, database and browser tests; the container test with the server's `TZ` set
  to a different zone than the household's, to prove the household's wins (the browser tests
  set up the household with the browser's zone, so the pages still agree with the browser); the
  restore drill; the privacy check.

### Not in this phase

- A zone per person saved on the server: the device's own zone covers travel (49.5).
- Storing days as `@db.Date`: cleaner, but every column above and its callers would change, and
  med doses carry a time of day. The move in 49.2 gives the same result for users.
- Several households per server.

### The owner's answers (2026-10-23)

1. **The server follows the household's zone**, not a zone passed through every function.
2. **Changing the zone later keeps each saved day and dose time** on its date and clock time.
3. **Away from home, show both:** the original time in the household's zone and the time where
   the viewer is, so medication and routines stay regular (49.5).

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
  using the household timezone in every date calculation is Phase 49.
- **Teams alerts need a Power Automate flow**; a "Connect Teams" button through Graph, and
  picking a jar's Teams chat from a list, are Phase 50.
- **Other setup friction:** finding the school calendar from the school's web address (Phase
  51), statement imports that work out their own columns (Phase 52), and VIN entry or scanning,
  smoother bank-feed setup, the alert mailbox set and tested in Settings, and a link to Entra's
  role assignments (Phase 53).
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
