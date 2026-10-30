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
| 47 | The pet: a digital pet with a room, toys, petting and mini-games, and a hidden bonus for chores | built |
| 44 | Polish: accessibility checks on every page, Shop list without signal | merged |
| — | Kids' allowance | waiting |
| — | Go live on the home server | tabled |
| — | Remove the dev sign-in (just before going live) | tabled |
| — | LMS connector (Canvas or Google Classroom) | waiting |
| 48 | Slim the migrate image to Prisma's CLI | merged |
| 49 | The household's timezone in every date calculation | merged |
| 50 | Teams without Power Automate: the app's own Teams bot, a jar chat picked from a list | merged |
| 51 | Find the school calendar from the school's web address | merged |
| 52 | Statement imports that work out their own columns | merged |
| 53 | Smaller setup fixes: VIN, bank feeds, alert mailbox, Entra role link | merged |
| 54 | The pet's fun pass: growing-up moments, juice, collection book, tricks | merged |
| 55 | The pet's daily surprises and sound | next |
| 56 | The pet: tap the egg open, drag things around the room (and 56.1, tighter hitboxes) | merged |
| 57 | Dropdowns that look like the app: styled native, a styled list, custom pickers where earned | scoped |

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

Everything through Phase 46, Phase 48 (the migrate image cut from 2.26 GB to about 690 MB) and
Phase 49 (the household's timezone everywhere) Phase 50 (Teams through the family's own Teams
app, no Power Automate) Phase 51 (finding the school calendar from its website) and Phase 52
(statement CSVs that work out their own columns) are merged to `main` (2026-10-23). The project
moved to this public repository the same day (one clean commit; the earlier history is archived
privately). `main` takes changes only through pull requests: a ruleset requires the three CI
jobs and the container check, and a pull request merges itself once they pass. Every merge to
`main` publishes the tested app and migrate images (`ghcr.io/d0nm3ga/familyos`, `…-migrate`,
public, tagged `sha-<commit>`, with signed provenance).

**Tabled until the owner says it's time (2026-10-23):** going live (the server, Cloudflare
Tunnel and Access, the pinned version, backups and break-glass, following
`docs/guides/admin.md`, then entering the real family) and, with it, removing the dev sign-in.
The database still holds test data only.

**The remaining engineering work:** Phase 57 (dropdowns that look like the app, scoped
2026-10-29). Otherwise what's left waits on a decision (below) or on going live; the pet's
Phase 55 is its own track.

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

## Phase 47 — scope (the pet, 2026-10-23)

**The owner's calls (2026-10-23):** a digital pet for the kids, just for fun. It keeps the
heart of a Tamagotchi (care over time: hunger, happiness, poop, sickness, discipline, life
stages, care mistakes that shape the adult, and death from neglect), with **artistic
liberty** past that: a room the pet lives in and the kid decorates, toys it plays with, petting,
and real mini-games instead of left-or-right. The animations are simple but alive, better than
an LCD. It is **completely separate from points, stickers and the Store**: it never reads or
writes `PointsLedger`, and nothing in it costs anything in the real world. **Finishing a chore
quietly brings the pet a gift**, an extra that is never a cost, never taken back, and never
announced. That's an easter egg the kids discover on their own: the Chores app never mentions
the pet, and the pet never mentions chores. The clock runs only during **care hours**, so a
school day can't kill a pet. When a pet dies, a **memory book** keeps it and a new egg is ready
right away (owner's picks).

Five parts, in this order, each its own commit series; one pull request. A Fable scope review
goes here before building. The play part (47.3) is the biggest; if it runs long, the last two
mini-games move to a Phase 47 rather than holding up the rest.

### 47.1 — The simulation (pure, no database)

- **`lib/pet/sim.ts`**: `advance(state, from, to, careHours, timeZone)` returns the new state
  and what happened along the way (pooped, got sick, called for attention, grew, died). It's a
  pure function of its inputs: random events come from a seeded generator (pet id + tick
  number), so advancing the same span always gives the same answer, however it's split up.
  The server advances the pet lazily whenever it's viewed or cared for. No cron, no timers.
- **Meters:** hunger, fun and energy (0–100, shown as 4 hearts or a bar with words), discipline,
  weight, and a hidden **bond** that grows with every kind of care and play and never goes down.
  Hunger and fun drop during care hours. Energy drops with play and refills with naps. Meals fill
  hunger, snacks fill fun but add weight, and too many snacks make the pet sick. Bond unlocks
  tricks and changes how the pet greets its kid.
- **Poop and mess:** poop appears on the clock, and a messy room (uncleaned poop, toys
  everywhere) raises the odds of getting sick. **Sickness** is shown as a sad, green-faced pet
  with a thermometer. Medicine cures it, sometimes needing two doses. Sickness left too long
  causes death.
- **Attention calls:** when a meter empties or the pet is sick, it calls. Answering within the
  window (15 care-minutes) is care. Missing it is a **care mistake**. Some calls are fake
  (fussing while full and happy), and a gentle "No" raises discipline. Ignoring a fake call is
  a discipline mistake.
- **Stages:** egg (hatches in about 5 minutes; tapping it makes it wobble), baby (about 1
  care-hour), child (about 1 care-day), teen (about 3 care-days), then adult. The grown-up form
  is picked from care mistakes, discipline and bond. Each species has two child, three teen and
  four adult forms, from scruffy to splendid.
- **Death:** too many hours with empty meters, sickness left untreated past its limit, or old
  age (adult lifespan of about 10–20 care-days, longer with good care; owner's question 1).
- **Care hours:** one setting per household, with weekday and weekend windows in the household
  timezone. Defaults are 7–8am and 3–8pm on weekdays and 8am–8pm on weekends (owner's question
  2). Outside them, the pet is asleep: its meters freeze, and visiting shows it asleep with a
  night light on.
- **What the pet does on its own** (`lib/pet/behavior.ts`, pure): a small weighted chooser
  picks the next idle behavior from its state and the room: wander, sit, look at the kid, nap
  in its bed when tired, play with a toy left out, sniff a decoration, stare out the window,
  dance when happy, sulk when bored. Seeded and tested like the sim, so "it went and napped in
  its bed" comes from its state, not a coin flip in the UI.
- **Personality:** set at hatch from the seed: a favorite toy, a favorite food, a favorite
  petting spot, and one quirk (sleepy, bouncy, shy or show-off) that weights its behaviors.
  Kids discover these by playing, and nothing on screen lists them up front. They show up in
  the stats page once noticed (the first time the favorite is used).

### 47.2 — Data, the room and the pet

- **Models:** `Pet` (person, species, name, stage, form, personality, state as typed columns,
  `lastAdvancedAt`, `seed`, `bornAt`), `PetItem` (things the pet owns: kind (food, toy, decor,
  wearable, charm), item id, used or not, and where it's placed in the room),
  `PetGift` (one row per gift: `instanceId` **unique**, `personId`, `grantedAt`, `itemId`),
  `PetPlay` (the last time each mini-game paid out, for its cooldown) and `PetMemorial` (name,
  species, final form, age, cause in kid-gentle words, dates). One live `Pet` per person.
  Losing a pet writes its memorial and deletes the live row in one transaction. Items stay with
  the kid, so the next pet moves into the same decorated room. All rows belong to the household
  and are covered by the backup (optional fields, so old backups still restore), with
  `lib/backup/coverage.test.ts` updated.
- **Server actions** (`app/(app)/pet/actions.ts`): `hatch`, `feed`, `clean`, `medicine`,
  `sayNo`, `pet` (one petting session), `playWithToy`, `finishGame`, `placeItem`, `wear`,
  `useItem`, `rename`. Each one loads the active profile's own pet (never one picked by an id
  from the client), advances it to now, applies the action and saves under an optimistic
  `lastAdvancedAt` guard, so two tabs can't double-feed. Input goes through zod. Form buttons
  use `SubmitButton`. Games and petting call actions directly.
- **The room:** a side-on room drawn in SVG, with a floor, a back wall, a window and slots for
  furniture. It has a bed, a food bowl, a toy box and a rug from the start.
  - **The window shows the real day:** sky color from the household clock (morning, day, dusk,
    night), and today's weather from `getDailyForecast` (`lib/weather.ts`, already cached) as
    rain, snow, clouds or sun, when home is set. It falls back to a clear sky when it isn't. The
    pet reacts: it watches the rain, and its ears perk up at snow. This is the one place the
    pet uses the rest of the app's data, and it's display only.
  - **Seasons:** the window and a small wall decoration change with the month (leaves, snow,
    flowers, sun). They're picked by date, with no holiday-specific content.
  - **Decorating:** a "Decorate" mode shows the room's slots (wall, floor left, floor right,
    shelf, window sill). Tap a slot, then pick a decoration the pet owns to put there, or move
    one. It works by tap, not drag, so it's easy on phones and with a keyboard. Decorations
    change the room, and some change behavior: a cushion becomes a second nap spot, a plant
    makes it calmer, and a lamp keeps it company at night.
  - **Mess shows:** poop and toys left out stay where they are until cleaned or put away.
- **Animation, simple but alive:** the pet is an SVG built from parts (body, eyes, mouth, ears
  or wings, accessory), so expressions are cheap: blink, look toward the pointer or last tap,
  squash and stretch when it hops, wiggle when petted, droop when hungry, zzz when asleep, and
  hearts or sparkles when happy. Movement uses the Web Animations API and CSS transitions, with
  `requestAnimationFrame` only inside a running mini-game. A shared `PetSprite` component takes
  the species, form, mood, pose and accessory. Every animation has a
  `prefers-reduced-motion` version (a pose change, no movement), and nothing flashes.
- **Art:** in-house SVG and CSS only. There are no image files, no fonts from outside, no game
  engine and no new packages. Three species to start (a round blob, a little bird and a
  long-eared critter), each picked at hatch time.
  **Swappable later** (the owner's call, 2026-10-23): pixel-art sprite sheets made with an AI
  tool (PixelLab) may replace the drawn shapes once there's a subscription. So `PetSprite` and
  the room's item renderer take the same inputs (species, form, mood, pose, item id) a
  sprite-sheet version would, and nothing outside them knows how a pet is drawn. Any generated
  art would be made at build time and committed, never called from the running app, and only
  after checking that its terms allow it in an MIT repository.
- **The screen** (`/pet`): the room fills the top. Below it is a bar of big buttons: Feed,
  Play, Clean, Medicine, Lights, and a "more" menu for Decorate, Wardrobe, Stats and
  Memories. The status line says the pet's mood in words ("Pip is hungry and a bit bored")
  as well as showing the meters. axe checks run in both themes.
- **Where it lives:** a new app, `pet` ("Pet", 🥚, not adult-only), last in the everyday group,
  and in `SWITCHABLE_APPS` so a family can turn it off in Settings → Apps. Kids always get one
  when the app is on. Grown-ups can opt in from the pet screen.
- **The memory book** (`/pet/memories`): each pet the person has had, drawn in its final form,
  with its age, favorite toy and a gentle line ("Pip lived 12 days and grew into a Splendid
  Sprout"). It has no delete button for kids. An admin can clear one, with `ConfirmSubmit`.
- **Notifications:** none in this phase. While a call is open, the pet shows the call on its
  own screen and as a small dot on its app tile.

### 47.3 — Play: petting, toys and mini-games

- **Petting:** stroke the pet with a finger or the mouse. It leans into it, closes its eyes,
  and hearts float up. Its favorite spot (head, cheeks, belly or back) gives a big reaction,
  and finding it is part of the fun. Too much petting in a row and it wriggles away, giggling,
  to stop it being a fun-meter button. Keyboard and screen-reader users get a "Pet" button with
  the same result. Petting adds fun and bond, capped per care-hour.
- **Toys** (from the toy box, or left out in the room): tap a toy to play with it together.
  - **Ball:** flick it and the pet chases it, sometimes bringing it back.
  - **Plush:** the pet cuddles it and naps better.
  - **Bubble wand:** blow bubbles and the pet jumps to pop them.
  - **Drum:** tap a rhythm and the pet bounces along.
  - **Kite** (on windy or sunny days from the window weather): the pet runs back and forth.
  A toy left out gets played with on its own later (47.1's behaviors), and its favorite toy
  gets an extra-happy reaction. More toys come from chore gifts (47.4) and from growing up
  (each stage brings one).
- **Mini-games** (`components/pet/games/`), each about 30–60 seconds, made for small hands and
  pointer, touch or keyboard. Each has a pure rules module (`lib/pet/games/*.ts`: spawning,
  collisions, scoring, from a seed) tested on its own, and a thin view. All are in this phase
  unless 47.3 runs long (see the intro):
  1. **Snack Catch:** treats fall, and the kid slides the pet's bowl to catch them, dodging the
     odd broccoli (which the pet pulls a face at). It fills hunger without adding weight.
  2. **Bubble Bath:** bubbles cover the pet, and popping them (with a rubber duck bonus)
     cleans it and makes it happy. It's the fun way to bathe, next to the plain Clean button.
  3. **Hide and Seek:** the pet hides behind the kid's own furniture and decorations, and the
     kid taps where they think it is, with the tail peeking out as a hint. A more decorated
     room means more hiding spots.
  4. **Copy Dance:** the pet does a short dance (a sequence of 4 moves, growing each round),
     and the kid repeats it with arrow buttons. It trains discipline.
  5. **Fetch Far:** a timing bar: throw when the marker is in the sweet spot, and the pet runs
     out and back across the yard. Better scores mean longer runs.
- **Game results:** a game sends its score to `finishGame`, which caps the effect (at most one
  full meter step per game) and allows one payout per game per care-hour (`PetPlay`), so
  posting a fake score gets nothing extra. Playing again past the cooldown is still allowed,
  just for fun, and the pet still cheers. Kids can't lose anything by playing badly: a low score
  still gives a little fun.
- **Energy:** play costs energy. A tired pet yawns and asks for a nap rather than play,
  which keeps play from replacing care.

### 47.4 — The secret (chore gifts)

- **Pull, not push:** `completeInstance` and the rest of the Chores code are **not changed**.
  When the pet is advanced, `lib/pet/gifts.ts` looks for this person's chores finished since
  the pet's `bornAt` (`TaskInstance` with `status: DONE` that this person did: the same
  recipient rule the stickers use) that have no `PetGift` row yet. It grants them in one
  transaction, with the unique `instanceId` stopping doubles. A chore undone before the pet is
  next opened brings nothing. One undone after its gift was granted leaves the gift (no
  takebacks), and redoing it can't earn a second one.
- **Limits:** at most 3 gifts a day (owner's question 3). Chores past the cap that day just don't
  bring one, and nothing carries over. Only chores done after the first pet hatched count, so
  the first pet doesn't arrive with a pile of presents.
- **What a gift is:** drawn from a weighted gift table, with some gifts found only this way.
  It can be a feast (fills hunger and fun with no weight gain), a new toy, a hat or outfit, a
  decoration for the room, a **lucky charm** (stops the next sickness), or rarely a **sparkle
  treat** (counts toward a more splendid next form). Everything a gift does, ordinary care can
  also do, so gifts make things easier and give extras to collect. They never cost anything or
  replace normal care.
- **Showing it:** a present box at the door the next time the pet is opened, which the pet
  unwraps with the kid. Each one has a hint line from a pool that starts very vague ("A present
  appeared! Where did it come from?") and gets warmer with each gift that kid has received
  ("…it smells like a freshly made bed", then "…someone's been helping around the house!"). It
  never says the word "chore" or the reward word.
- **Kept secret everywhere:** no pet mention in Chores, Home's chore cards, Points, the Store,
  notifications or the mascot's lines. The family guide describes the pet but not the gifts. The
  admin guide covers them under a "Spoiler: for grown-ups" heading. A test reads the Chores and
  Points page sources and fails on any pet reference.

### 47.5 — Docs

- `docs/guides/family.md` (the pet, its room, toys and games, with no spoiler) and
  `docs/guides/admin.md` (care hours, turning it off, clearing a memory, and the spoilered
  gift rules).
- `docs/BUILD.md`, plus this plan.

### Checks

- Unit (the bulk): `advance` is deterministic and gives the same result split or whole; it
  freezes outside care hours and across a DST change; meters, energy, bond (never drops), poop,
  sickness, fake calls, care-mistake counting, and every stage change and form pick; each death
  cause and nothing else; behavior choices from state and room; personality from the seed; each
  mini-game's rules (spawns, collisions, scoring, same seed same game); the game payout cap and
  cooldown; the petting cap; the gift hint ladder; the daily gift cap; the gift table never
  yields an item that costs anything; and the secrecy test.
- Database: one live pet per person; actions only touch the active profile's own pet; the
  optimistic guard; items survive a pet's death into the next pet's room; gifts granted once
  per chore instance; undo after a gift keeps the gift and redo grants none; a kid can't
  receive a gift for a chore someone else did; death writes the memorial atomically;
  `PointsLedger` is unchanged by every pet action (row count before and after); and the backup
  round trip.
- Browser: `/pet` and `/pet/memories` join the every-page list (axe, both themes, reduced
  motion); a turned-off Pet app is gone from the launcher and goes to the "turned off" page. No Weather Service
  calls in tests (the existing stub).
- `privacy:check`, lint, types, `deps:check` (no new packages).

### Not in this phase

- Phone alerts when the pet calls. This needs a per-kid switch and quiet hours, so it's its own
  follow-up.
- Visiting a sibling's pet, pets playing together, a yard or second room, more species, and
  sounds (there are none in this phase, so nothing surprises a quiet house).

### Built (2026-10-23)

Built as planned, with the deviations listed under Phase 47 in docs/BUILD.md. The defaults
below are what shipped; the owner can still change them.

### The owner's questions

1. Adult lifespan: about 10–20 care-days (longer with good care) is the plan. Should it be
   shorter, longer, or never die of old age?
2. Default care hours: 7–8am and 3–8pm on weekdays, 8am–8pm on weekends?
3. Up to 3 chore gifts a day?
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
  `SchoolTask.dueDate`, `SchoolAssignment.dueDate` for rows typed in (every row today; an LMS
  connector's rows will carry their own times, and school feed events are instants in their own
  table), and `ItemPrice.observedAt` where it came
  from a receipt's printed date without a trip (`lib/groceries/receipts.ts`). The build confirms
  the list against every writer. **What doesn't:** instants (`createdAt`, `completedAt`,
  sign-ins, calendar and feed events) and the people dates `middayInZone` already writes in the
  household zone.
- **The move** happens in the same transaction that saves the zone: each value's date and clock
  time in the old zone become the same date and clock time in the new one, so a chore due Tuesday
  stays due Tuesday and an 8:00 AM dose stays at 8:00 AM. A clock time that doesn't exist or
  happens twice on a DST change is settled the same way every time. (Built in JavaScript with the
  app's zone data, not Postgres's `AT TIME ZONE`: Fable's implementation review found Intl names
  Postgres doesn't know.) Clearing the zone moves the days back to the deploy's. `TaskInstance` is
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
  the restored household's zone, says so in the
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
  household zone set, process zone different); typed-in versus connector school rows; the lock
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

## Phase 50 — scope (Teams without Power Automate, 2026-10-23)

Teams alerts go through a Power Automate Workflows link that one admin builds by hand (a template,
a trigger set to "Anyone", an expression for the recipient, a second branch and a condition for
jar chats; README "Teams"), and a jar's Teams chat is a pasted link. The link is a password
anyone holding it can use to message anyone in the tenant as the Flow bot. The aim: connect Teams
from Settings with Microsoft's own pieces, pick a jar's chat from a list, and drop the Workflows
link.

**What Microsoft allows (researched 2026-10-23, Microsoft Learn):**
- **An app can't post chat messages as itself.** Graph's send-message calls take delegated
  permissions only (app-only is for importing history). Posting as a family member would make
  alerts come "from Dad" and can't reach Dad himself.
- **Activity feed notifications** (`TeamsActivity.Send`) are app-only, but they can only link to
  a Teams address, not the app's, and Microsoft shows them on phones only for apps on its allow
  list. Most of the family reads alerts on a phone.
- **A Teams bot** can message a person or a group chat it's installed in, with the Adaptive Cards
  the app already builds. That's what the Flow bot is. A single-tenant Azure Bot can use the
  family's existing app registration (new multi-tenant bots ended July 2025). The app can
  install itself for each person through Graph (`TeamsAppInstallation.ReadWriteSelfForUser.All`)
  and in a chat (`…SelfForChat.All`), read that person's bot chat from the install, and send
  through the Bot Connector service. Nothing has to reach the app from outside, so Cloudflare
  Access stays as it is.

**The approach (recommended): the app's own Teams bot.** Fable's scope review (2026-10-23)
checked it against Microsoft's docs: installing through Graph, reading the person's chat id from
the install and posting with the global service address, without ever receiving anything, is
Microsoft's own documented pattern; a single-tenant token works; the free tier covers Teams.

### 50.1 — The family's Teams app

- The app builds its Teams app package itself: a manifest with a notification-only bot
  (`isNotificationOnly`, so there's no compose box), personal and group chat scopes, and
  `webApplicationInfo` (`id` the app registration, `resource` `api://botid-{appId}`; without it
  Graph won't list the installs). Name, developer name and descriptions come from the family's
  settings (Make it yours), never a fixed product name; its URLs from `BETTER_AUTH_URL`. Icons: the
  192×192 color icon from `lib/app-icon.tsx`, and a new 32×32 outline, white on transparent only
  (Teams rejects anything else). Nothing in it leaves the family's tenant.
- `HouseholdAlerts` keeps the manifest's fixed id, the catalog's app id, and the published
  version and a hash of what it was built from. A changed name or icon publishes a new version
  (`/appDefinitions`). The catalog takes a moment to show a new app, so the first install retries.
- Settings → Alerts → **Teams** shows what's done and what's next, as a short checklist: the
  Azure Bot answers (a test token and a dry call), the app is in the catalog, each grown-up has
  it, and a test message arrived.

### 50.2 — Messages to each grown-up

- `lib/alerts/teams.ts` sends through Bot Connector (`/v3/conversations/{chatId}/activities`)
  with a token for `https://api.botframework.com/.default` from the existing app registration
  (`lib/graph/app-token.ts`). The cards stay as they are (`teamsPayload` without `recipient`).
- A grown-up signed in with Microsoft gets the app installed for them on first need, addressed by
  their Entra object id (the Microsoft `Account.accountId`, never the email), and their bot
  chat's id is read from the install and kept (`AlertPrefs`, with the install id). Handled
  explicitly: `BotDisabledByAdmin` (a plain "Teams isn't allowed for you here"), not in the chat
  or chat gone (reinstall, read the chat again, send once more; this also covers a quiet chat
  Teams has let lapse), 429 (wait for Retry-After), 401 (a fresh token).
- Same rules as today: only people with a Microsoft sign-in, recipients from
  `lib/alerts/targets.ts`, failures on Settings → Alerts, one bad recipient never stops the rest.
  The bot sends only: a message typed to it isn't answered (there's no inbound address).

### 50.3 — A jar's group chat, picked from a list

- Jar Settings → **Teams chat** lists the group chats the signed-in member is in (delegated
  `Chat.ReadBasic`, asked for on this button only; `/me/chats?$filter=chatType eq 'group'` with
  members, paged), by topic and members' names, with anyone outside the family's organization
  marked (posts reach them too). Picking one installs the bot there and sends a hello. The pasted
  link and its parsing go.
- The app may install itself in any chat in the tenant (`…SelfForChat.All`), so the pick is the
  guard: only a jar member, and the server accepts only a chat id from that member's own fresh
  listing at save time, of type group. Without a chat-reading permission the bot never sees the
  chat's messages (it would only hear an @mention, and it doesn't listen); the guide says so.
- A one-to-one chat can't be picked, as today. Posts no longer need a member's address.

### 50.4 — Retire the Workflows link

- `HouseholdAlerts`' encrypted link and its host (the table stays for 50.1's columns), its checks
  (`checkTeamsWebhookUrl`, `*.logic.azure.com`, `sig`, the AAD label), the Sentry rule that
  treats those hosts as private (`lib/observability/options.ts`), the link form
  (`settings/alerts/controls.tsx`), their tests, and the README's Power Automate steps go.
  `lastSentTeams` now means Teams accepted the message (Bot Connector's 201). Backups don't change
  (alert settings were never in them).

### 50.5 — Setup an admin does once

- In the Azure portal: create an **Azure Bot** (free tier), single-tenant, "use existing app
  registration" (the family's), and turn on the **Microsoft Teams** channel. The messaging
  address can be left empty or be the app's: Teams' install notices then stop at Cloudflare
  Access and show as delivery failures in the Azure Bot resource, which is expected.
- In Entra: grant `TeamsAppInstallation.ReadWriteSelfForUser.All` and
  `TeamsAppInstallation.ReadWriteSelfForChat.All` (application), and `Chat.ReadBasic`
  (delegated).
- In Teams admin center: allow custom apps for the family (an app permission policy), then add
  the app to the catalog (see question 3).
- `docs/guides/admin.md` and the README get these steps; the
  family guide says where Teams alerts come from now.

### Tests

- Unit: the manifest (family name and icon, no fixed name, required fields and lengths,
  `isNotificationOnly`, the outline icon only white and transparent), a new version when the name
  or icon changes, the Bot Connector payload, error wording, install and chat-id handling with
  Graph mocked (the roster 403 reinstall, 429, 401). Database: recipients, a missing install, one
  failure among several, a jar chat pick (only an id from the member's own listing; an external
  member shown). The guard tests keep the Workflows hosts out. No live Microsoft call in CI.

### Not in this phase

- Answering from Teams (approve an order with a button): the bot would need an address Teams can
  call, through Cloudflare Access; a later phase if wanted.
- Activity feed notifications, and alerts to kids (no Microsoft sign-in).

### The owner's answers (2026-10-23)

1. **The app's own Teams bot**, not activity notifications or Power Automate.
2. **Create a free-tier Azure Bot** in the family's tenant (an Azure subscription, no cost at
   this size), on the family's existing app registration.
3. **An Add to Teams button** for an admin who is a Teams or Global administrator, publishing
   through Graph, and again when the name or icon changes.
4. **Remove the Workflows link now:** nothing is live yet.
## Phase 54 — scope (the pet's fun pass, 2026-10-23)

**The owner's call (2026-10-23):** items 1–5 of the researched fun list, split in two on Fable's
advice (its scope review, 2026-10-23, is folded in). This phase: a growing-up moment and a juice
pass, a collection book of every form, and tricks unlocked by bond. Daily surprises and sound
are Phase 55. Same rules as Phase 47:
additive only, nothing bought, the chore secret kept, nothing leaves the server, no streaks,
no countdowns, no guilt.

### 54.1 — Growing up, seen

- `advance` emits `hatched` and `grew` events as `{minute, kind}` only (`sim.ts`); they gain the
  new `stage` and `form`, so a catch-up that passes two stages knows both (tested).
- **`Pet.shownStage` / `Pet.shownForm`** (nullable): the last form the kid has seen. When the
  page's pet is in a different stage or form, the room opens with the **reveal**: the old form
  glows, turns to a silhouette, pops into the new one with sparkles, and a line in the pet's
  voice names it ("Pip grew into a Splendid Sprout!"). A focused **Yay!** button (Escape too;
  not "any key", which would swallow Tab) calls `seeGrowth`. The reveal is keyed by stage and
  form, not state synced from props. Reduced motion: a still before-and-after.
- **`seeGrowth` is its own plain update** (`pet.updateMany({ where: { personId } })`), with the
  values read from the row's own state on the server, never from the client, and no
  `lastAdvancedAt` in it: it works while the pet is asleep, and it can't race the care guard or
  the minute refresh. The first view of a pet with null shown fields sets them the same way,
  without a reveal (existing pets, and after a restore). Not in backups: a display bookmark.

### 54.2 — The collection book

- **`PetDiscovery`** (person, species, stage, form; unique together; never the egg): every form
  a person's pets have reached. One helper, `recordDiscoveries`, writes the forms from the
  growth events plus the current form with `createMany({ skipDuplicates })`. It's idempotent, so
  it needs no `lastAdvancedAt` guard and runs on **every** path: in `catchUp` before the
  alive/gone split (so a pet that grows and then goes still counts), on the idle-skipped view,
  and after the care save in `changeInTx`. The book also fills in from `PetMemorial` (which keeps
  species, stage and form) on its first view, so pets from before this phase count.
- In backups (it's the kid's progress): a `.default([])` array (format 8 is still unreleased),
  `build.ts` select, `plan.ts` person remap and a duplicates check on (person, species, stage,
  form), `restore.ts` delete-then-insert and counts, `coverage.test.ts` (and `shownStage`,
  `shownForm`, `shownTricks` on the pet's allowlist). Migrations after
  `20261111150000_pet_gifts_checked`: `20261114120000_pet_shown`, `20261114130000_pet_discovery` (after other branches' `20261112`–`20261113` folders, so they sort last).
- `/pet/book`: per species, the 10 forms (baby 1, child 2, teen 3, adult 4) in stage order. Found
  ones drawn in full with their name; the rest as a dark silhouette with "???" and a hint line in
  the pet's voice about care in general ("Raised with lots of care…"), never presents or anything
  that would give away the chore secret. A count per species ("4 of 10"). An empty state with no
  pet and no memories (the every-page browser pass visits before hatching). Linked from the pet
  screen next to the memory book. Read only; no prizes for completing it.

### 54.3 — Tricks

- `lib/pet/tricks.ts` (pure): five tricks unlocked by bond (sit 10, spin 25, wave 45, bow 70,
  roll over 100) as `unlockedTricks(bond)`, and a `tryTrick(trick, discipline, rng)` that does
  it, or (low discipline) does something sillier instead, with lines in voice.ts. Bond stays on
  the server: the page passes the unlocked list and the newly unlocked ones. Performing a trick
  is client-only, a show for the kid with no action and nothing to farm. Each trick is a pose in
  the sprite (CSS keyframes in globals.css, still under reduced motion). The Play panel gets a
  **Tricks** row; locked ones show as "???" ("Get closer to learn more").
- The one change on the server: a newly unlocked trick is announced once, on the reveal pattern
  (54.1), from `Pet.shownTricks` (a count), saved by `seeGrowth`.

### 54.4 — Juice

- One effects layer (`app/(app)/pet/effects.tsx`) replacing the hearts-only floaters: hearts,
  sparkles, crumbs, bubbles and stars, each a short CSS animation from a point. Used for:
  - meals and snacks: the food flies in an arc from the bowl to the pet, then crumbs;
  - cleaning: a puff of bubbles where each poop was;
  - petting: hearts (bigger burst on the favorite spot); toys and games: sparkles;
  - a squash-and-stretch on every tap of the pet.
- Everything stills under reduced motion (globals.css already does this), and nothing flashes.

### 54.5 — Docs

- The family guide (the reveal, the book, tricks), `docs/BUILD.md` and this plan.

### Checks

- Unit: growth events carry stage and form; discovery from events; every species × stage × form
  has a name; tricks unlock by bond and `tryTrick` is deterministic for a seed; the voice style test covers the new lines, which are all exported from voice.ts as `*_LINES` so
  the test sees them.
- Database: a catch-up through two growths records both discoveries and the reveal shows the
  newest; a pet that grows and goes in one catch-up still records the form; growth during a
  care action is recorded; `seeGrowth` works while asleep and only touches your own pet;
  discoveries survive the pet's death and a backup round trip; `PetDiscovery` coverage.
- Browser: `/pet/book` joins the every-page list (axe, both themes); the existing pet-room test.
- `privacy:check`, lint, types.

### Not in this phase

- Daily surprises and sound (Phase 55), and items 6–13 of the fun list (adventures, playdates,
  seasons in the room, family-life reactions, the diary, personal bests, the Home peek, photo
  mode).

## Phase 55 — scope (the pet's daily surprises and sound, 2026-10-23)

**The owner's call (2026-10-23):** items 4 and 5 of the fun list, split from Phase 54 on Fable's
advice. Same rules as Phase 47 and 54. To be re-scoped against the code once Phase 54 lands.

### 55.1 — Something new each day

- `lib/pet/moments.ts` (pure): `dailyMoment(seed, day, context)` picks at most one small moment
  for the household's date from the pet's view seed, the season, the weather and whether the
  mascot is on: a ladybug on the sill, a bird at the window, a butterfly, a rainbow on a rainy
  day, snow excitement on a snowy one, the mascot (by the family's name for it) peeking in at
  the window's edge, only when the family's mascot is on, or nothing (about one day in four, so
  it stays a surprise). Same day, same moment. `day` is the household's date, worked out on the
  server (`dayIn`, exported from queries.ts).
- The room draws it, the pet reacts (goes to the window, waves), and a line in voice says it
  once per day per device (`localStorage` through `useSyncExternalStore` with a server snapshot,
  the nav rail's pattern, so the server render matches and no effect sets state). Purely
  visual: no items, no state, nothing missed by not visiting.

### 55.2 — Sound, off until turned on

- `app/(app)/pet/use-pet-sound.ts`: Web Audio, made in the browser (no files). Each species has a
  voice: a few short oscillator "syllables" per line, like Animalese, pitch by species; a
  favorite petting spot is higher and quicker (as in Pokémon Refresh); plus a pop, a munch, a
  ta-da and a soft splash. The context starts only on a tap (autoplay rules).
- **Off by default**, a 🔈 toggle on the pet screen, remembered per device (`localStorage`
  through `useSyncExternalStore`, as above; sound belongs to the device in the room). Hidden, and
  silent, when the family's mascot is off or this person's mascot volume is Off: the page passes
  `soundAllowed = look.mascot.on && profile.bunsonVolume !== "OFF"` (the layout's own rule), so
  the family's quiet setting covers the pet too. Web Audio needs nothing from the CSP.

### 55.3 — Docs

- The family guide (daily moments, the sound switch), the admin guide (sound follows the
  mascot setting), `docs/BUILD.md` and this plan.

## Phase 56 — scope (tap the egg open, drag things around the room, 2026-10-24)

**The owner's call (2026-10-24):** a new egg hatches with a few taps instead of a five-minute
wait, and decorating is drag and drop. Asked how free placing should be, the owner chose
"slide along surfaces": anything goes anywhere along the surface it belongs on, several things
per surface (over snapping to the five old slots, or dropping anywhere at all). See BUILD.md.

## Phase 51 — scope (find the school calendar from the school's web address, 2026-10-23)

Adding a school calendar today means finding its subscribe link on the school's site and pasting
it (School → Calendars; Phase 18.5). Families know the school's web address, not where its iCal
link hides. The aim: type the school's address, and the app finds the calendars the site offers,
checks each one, and lets an admin add the right one in a tap. Fable's scope review (2026-10-23)
measured real district sites and is folded in.

**What school sites do (researched 2026-10-23):** there's no common format.
- **Plain links work** on sites that embed a Google Calendar (its public feed is
  `calendar.google.com/calendar/ical/<id>/public/basic.ics`; newer embeds carry the id
  base64-encoded) and on WordPress sites with The Events Calendar (a
  `<link rel="alternate" type="text/calendar">`).
- **Finalsite**, the most common K-12 platform, builds its Subscribe button with a script, so a
  plain scan finds nothing. But its calendar element names the calendars
  (`data-calendar-ids=…`), and `/fs/calendar-manager/events.ics?calendar_ids[]=<id>` on the same
  site returns the feed.
- **SchoolMessenger Presence** builds its iCal link in a script too; some of its sites link
  Google embeds as well.
- **Some platforms** (Apptegy among them) answer a plain fetch with a "check your browser" page
  or a 403, so nothing on them can be read without a real browser.

Expected: about a third of schools with the generic scan; over half with the Finalsite rule. Not
finding one is common, so that answer has to be honest and specific.

### 51.1 — The finder

- **Input:** the school's web address (`lincoln-elementary.example` or a full https address).
- **Pages it reads** (at most 4): that page, then up to 3 links on the same school site (the same
  registrable domain, so `www.` and the apex, a district and its schools' subdomains) that look
  like a calendar ("calendar", "events", "iCal", "subscribe" in the link text or address). The
  same-site rule is checked on the address after redirects, and `<base href>` is honoured.
- **What it looks for** on each page:
  - Links and `<link rel="alternate" type="text/calendar">` ending in `.ics`, with `?ical=1`, or
    starting `webcal://`, on any https host (calendars often live on another host: Google,
    Outlook, an athletics site).
  - Google Calendar embeds and links (`src=` ids, plain, `%40`-encoded or base64; also in
    `data-src`): each becomes its public `basic.ics`, on `calendar.google.com` or the older
    `www.google.com/calendar/ical/…`.
  - Outlook published calendars (an `.html` link with a matching `.ics`).
  - **Finalsite:** `data-calendar-ids` on a calendar element → that site's
    `/fs/calendar-manager/events.ics?calendar_ids[]=<id>` for each id.
  - iCal addresses written inside `onclick` handlers or inline scripts (a cheap extra for
    platforms that build the link in a script).
- **The scanner** is one linear pass over the HTML (tags and attribute values, quoted or not,
  entities like `&amp;` decoded, relative and protocol-relative links resolved); no regex runs
  over the whole page, no scripts run, no new dependency.
- **Each candidate is tried** with the guarded feed fetch (at most 8), and kept only if it's a
  calendar the app can read. Each result shows its name (`X-WR-CALNAME`, else the link text), the
  host it's on, how many events in the next 4 months, and the next three (the household's zone,
  the same window the add form uses).
- **Blocked sites are told apart:** a 403, 429 or 503, or a small page that is only a browser
  check or a "turn on JavaScript" notice, gives "That site only opens in a full browser. Open its calendar page and copy the
  Subscribe or iCal link into the box below" instead of "nothing found".
- **Limits:** 10 seconds and 2 MB per page or feed (a per-call deadline across its redirects),
  12 fetches per search, and no new fetch after 30 seconds, and one search at a time per household (a lock in the
  database, as feed refreshes use).

### 51.2 — Safety

- Every fetch, page or feed, goes through the Phase 18.5 guard: every resolved address checked and
  pinned, no private or local networks, redirects followed by hand through the same guard, https
  only (a `webcal://` link is read as https), no compressed answers. The fetch is parameterised
  (deadline, `Accept`, the body check: HTML for a page, iCalendar for a feed); the guard is shared.
- Admins only, as adding a feed is today (it makes the server fetch an address).
- Errors are fixed text, never an address (feed addresses can carry tokens). The found addresses
  never reach the browser: the result list goes back as one encrypted, signed bundle (bound to the
  admin, the household and a 15-minute expiry), and **Add** opens it and takes the chosen entry.
  Nothing is kept in server memory, so a restart or a second app instance doesn't matter. The
  feed is stored encrypted when added, as today.

### 51.3 — The screens

- **School → Calendars:** "Find it from the school's website" above the existing form: the address,
  **Find calendars**, then the list, each with **Add** (name prefilled and editable, and who it's
  for). Nothing found, or a blocked site: the honest line above, with the existing tips and the
  paste box below as the fallback.
- The guided setup links to this from its last step ("All set": there's no school step), when
  School is on and no calendar is added yet.

### Tests

- Unit: the scanner (quoted and unquoted values, entities, relative, protocol-relative and
  `<base>` links, `webcal://`), Google ids (plain, encoded, base64, several on a page), Outlook
  links, Finalsite ids, script-embedded addresses, link scoring, the same-site rule after
  redirects, the limits, blocked-site detection, the bundle (tampered, expired, another admin).
- The finder takes its page and feed fetchers as arguments, so the fake-site cases are real unit
  tests: a home page linking a calendar page linking an `.ics`; a Google embed; a Finalsite page; a
  site with nothing; a challenge page; a candidate that isn't a calendar (dropped). Fixtures use
  made-up hosts and ids only.
- The guard itself keeps its Phase 18.5 tests; the browser test covers the finder's screens with
  a refused private address (a local fixture site can't be reached, by design).

### Not in this phase

- Running a page's scripts (a headless browser) for sites that need one.
- Platform rules beyond Finalsite; more can be added the same way when one is seen in the wild.
- LMS connectors (Canvas, Google Classroom), still waiting on the owner.

### The owner's answers (2026-10-23)

1. **School → Calendars**, with a link from the guided setup's school step.
2. **Include the Finalsite rule.**
3. **When nothing is found:** the honest line and the paste box; no email draft.

## Phase 52 — scope (statement imports that work out their own columns, 2026-10-24)

A jar takes statement files for history the bank feed doesn't have (Phase 25). OFX and QFX are
read reliably (every row carries the bank's own id). A CSV only works when its header row uses a
few exact names (a date, a description, an amount or debit and credit), otherwise it's refused
with "Try the bank's OFX/QFX download instead". Real bank and card CSVs often don't fit: lines of
account details before the header, no header at all, names like "Trans. Date" or "Original
Description", semicolons or tabs, dates as `20261003`, `03-10-2026` or `Oct 3, 2026`, a separate
"Type" column saying debit or credit, and credit cards that list charges as positive. The aim:
the app works the columns out itself, shows what it understood on a few rows, and lets the person
fix it before anything is saved, once per account. Fable's scope review (2026-10-24) checked it
against real bank and card export layouts and is folded in.

### 52.1 — Reading the file

- **Encoding:** UTF-8 (with or without its byte-order mark), else Windows-1252 (an "é" from an
  older bank export), and UTF-16 when the file starts with its byte-order mark.
- **Separator:** comma, semicolon or tab, whichever splits the rows into the same number of
  fields most consistently. The quoted-field splitter gets the separator as a new setting (it's
  comma only today).
- **Where the rows start:** the header is the first row followed by rows that read as data; lines
  of account details before it are skipped. A file whose first row already reads as data has no
  header.
- **Header names, wider:** the common variants for each role ("Trans. Date", "Post Date",
  "Transaction Description", "Original Description", "Amount (USD)", "Withdrawal", "Deposit",
  "Type", "Debit/Credit").
- **Names first, content second:** each column is scored on the first 50 data rows for how many
  cells read as a date, as money, or as words, and the header's name counts most.
  - **Decoys left out:** a balance column ("Balance", "Running Bal."), and a column whose steps
    match another money column's; a reference, check or card number (digits with no decimal point
    or sign never count as money, and 8 digits count as a date only when nothing else does); a
    category, type or status column (few different values) is never the description.
  - **Two dates:** the posting date wins over the transaction date (the reconciler matches the bank
    feed on the posting day).
  - **A second text column** (memo, original description, extended details) becomes the row's memo.

### 52.2 — Dates and amounts

- **Dates:** `YYYY-MM-DD`, `YYYYMMDD`, `M/D/YYYY`, `M/D/YY`, `M-D-YYYY`, `D.M.YYYY`, and month
  names (`Oct 3, 2026`, `3 Oct 2026`). Whether `03/10/2026` is March or October is decided once for
  the whole file: a first part over 12 means day first, a second part over 12 means month first,
  and when every row could be either it follows the household's setting (below), shown in the
  check step, where whoever imports can switch it for that file.
- **The household's date order** (the owner's call): Settings → Household → **Date order in
  statement files**: Automatic (the household's location: month first in the US and the rest of
  the Americas that write dates that way, day first elsewhere), Month first, or Day first. Admins
  change it; `Household.statementDateOrder`, in backups.
- **Amounts:** as today (`$`, `(1.00)`, `CR`/`DR`, the Unicode minus), plus a comma decimal
  (`1.234,56`, `1,50`), worked out for the file before any cell is read (today's money reader
  would take `1,50` as 150.00).
- **Debit and credit pairs:** both positive, or a credit written negative; either reads right
  (today's rule, with tests for both).
- **Which way is money out:** a single amount column is taken as negative-is-out. A Type column
  sets the sign only when every amount is positive, and only for values it knows (debit/credit,
  withdrawal/deposit, sale/payment/return/fee); an unknown value never changes a sign. Card
  exports differ (some list charges positive, some negative), so when nearly all amounts are
  positive the preview **suggests** flipping, beside the rows it would change; it's never applied
  on its own (a savings account with only deposits looks the same).

### 52.3 — Check, then import

- **Choose the file → Check it**: the jar's Statement section shows what the app understood: the
  date, description and amount columns (labelled dropdowns of the file's own column names or
  "Column 3"), the date order, which way is money out, how many rows will be skipped, and the
  first 5 rows as they'd be saved (a table: date, words, amount, "in" or "out" in words). **Import**
  saves with those choices. OFX and QFX skip this and import as today.
- Stateless: the browser keeps the chosen file in the page and sends the same file with each step
  (not a plain form post, which clears a file field after it returns), so nothing of it is kept
  on the server between the two steps.
- **Remembered per account:** the choices are kept on the account with the file's layout (a hash
  of its header, or its column count when there's none, and the reader's version, so a smarter
  reader asks again), so the next statement from the same bank
  goes straight to the check with them already set (question 2).
- Re-importing the same file with the same choices adds nothing, as today (a row's id is a hash
  of its day, amount and words). Changed choices make new ids, so:
  - **Each import can be undone:** rows remember which import brought them, and the jar's
    Statement section lists recent imports with **Remove this import** (asked first). A wrong
    guess costs a tap, not a month of wrong money.
  - **A row already there from another import** (same account, day, amount and words) is folded
    in rather than added twice.

### Tests

- Unit, with made-up bank and card exports (no real bank, merchant or amount from anyone's
  accounts): each separator and encoding; details lines before the header; no header; the wider
  names; columns found by content; the balance, reference-number and category decoys; both dates;
  every date form, both date orders and the zone fallback; comma decimals; Type columns (and an
  unknown Type value); debit and credit pairs both ways; a card file that suggests flipping; a
  column pick that overrides the guess; the layout hash; no readable rows after the choices; the
  row cap. Existing CSV and OFX tests stay as they are.
- Database: a remembered layout reused for the next file; re-importing adds nothing; a re-import
  after a flipped sign, then **Remove this import**; a row folded onto one from another import.
- Browser: choose a file, check it, fix a column, import, see the rows in Activity.

### Not in this phase

- PDF statements (no reliable text layout), and Excel files (save as CSV first; the guide says so).
- Splitting one file into several accounts.

### The owner's answers (2026-10-24)

1. **Every CSV shows the check step** before importing; OFX and QFX import straight away.
2. **Remember the choices** for each account's file layout.
3. **Ambiguous dates:** the household location's standard (month first in the US) by default, as
   a setting an admin can change (Settings → Household).
4. **Remove this import** for recent imports.

## Phase 53 — scope (smaller setup fixes, 2026-10-24)

Four small things that still send an admin to a manual or a terminal. Each is its own part and
commit series; one pull request. Fable's scope review (2026-10-24) checked the outside facts
(NHTSA, SimpleFIN, Exchange, Entra) and what already exists, and is folded in.

### 53.1 — A car from its VIN

- **Type or scan the VIN** on a car's form. The camera scanner the Groceries barcode add uses
  (zxing-wasm, self-hosted) gets a `formats` setting and its own code handler, so for a VIN it
  reads Code 39, Code 128 and Data Matrix (door jambs and windshield stickers); a leading `I`
  (an import marker) is dropped. A VIN is 17 characters without I, O or Q. Its check digit is
  checked only for North American VINs (first character 1 to 5, where position 9 is one); any
  other is accepted.
- **Decoded by NHTSA's vPIC** on the server (free, no key; `DecodeVinValues`, with the same
  timeout and short cache of failures as the recall check): make, model, year, trim and engine
  (litres to one place) fill the form, each still editable. vPIC's `ErrorCode` is a list: `0` is
  a clean decode; a make with other codes is a partial decode (said in words); no make means it
  couldn't be read. The recall check (Phase 12) then has the exact make, model and year.
- **Recalls for this car:** NHTSA has no public API for open recalls by VIN (it's manufacturer
  data), so the car's recall card gets **Check this VIN at NHTSA** (nhtsa.gov/recalls, where the
  VIN box is) with a copy button for the VIN, beside the by-model list it shows now.
- **Stored on `Vehicle.vin`** (question 1): in backups (and their coverage test) and the vehicle
  CSV, shown only to grown-ups (Cars, and the Garage with it, is already grown-ups only on the
  server; corrected while building), never in logs or error reports.

### 53.2 — A smoother bank feed

What's already there stays: the setup token is checked before it's spent, the bank's own message
shows on the card, connecting starts a sync, and accounts have their Spending switches. New:

- **Step by step** on the Bank feed card: link the banks at SimpleFIN Bridge (a direct link), make
  a setup token, paste it. A token SimpleFIN refuses as used also says it may have been seen by
  someone else, and to make a new one (SimpleFIN's own advice).
- **SimpleFIN's structured errors** (protocol 2.0's `errlist`, with codes): a bank that needs
  signing in again (`con.auth`) says so in words with a link to fix it at SimpleFIN Bridge; a
  temporary failure says to try later; the old `errors` list is still read.
- **Leave an account out of this jar**: a switch per account (asked first, since it hides money),
  kept on the account (`FinAccount.leftOut`, so backups carry it). The sync stops bringing it in;
  rows it already brought stay but leave the totals and Safe to spend (question 2); switching it
  back brings it in again from the next sync.

### 53.3 — The alert mailbox, set and tested in Settings

- Settings → Alerts → **Email**: the mailbox address is typed there (a household setting,
  overriding `ALERT_MAILBOX`, which stays the fallback; question 3), by an admin on their own
  sign-in, logged in Recent changes, with **Send a test** to yourself. The page says once that the
  server setting is the fallback.
- **The test tells the failures apart by Microsoft's own error code**, in fixed words: Microsoft
  sign-in isn't set up on the server; the mailbox doesn't exist (`ErrorInvalidUser`); it isn't
  ready for mail yet (`MailboxNotEnabledForRESTAPI`, common for a few minutes after a shared
  mailbox is made); Exchange hasn't given the app access (`ErrorAccessDenied`). For the last, the
  page shows the Exchange PowerShell (RBAC for Applications, scoped to that one mailbox:
  `New-ServicePrincipal`, `New-ManagementScope`, `New-ManagementRoleAssignment`, then
  `Test-ServicePrincipalAuthorization`) with the app's client id, its enterprise app's object id
  and the mailbox filled in, ready to copy.
- Safe to set in the app: the RBAC scope only lets the app send as that one mailbox, so a changed
  address just fails its test (the README already warns never to grant tenant-wide `Mail.Send`).

### 53.4 — A link to Entra's role assignments

- The Entra check (Phase 40.4) already reads the app's service principal; it now keeps its id
  (`EntraCheck.servicePrincipalId`, written each run), so the page never calls Graph to draw a
  link.
- Settings → Sign-in, for admins when Microsoft sign-in is on: **Change roles in Entra** opens the
  app's Users and groups page in the Entra admin center
  (`…/ManagedAppMenuBlade/~/UsersAndGroups/objectId/<sp id>/appId/<client id>`; the owner
  confirms the page in the tenant, else it opens the app's Overview), beside the existing **Check
  now**, with a line that changes show here on the next check.

### Tests

- Unit: VIN shape, the North American check digit and a non-North American VIN accepted; the
  vPIC answer read into the form (a fake fetch: clean, partial, unreadable, and a long
  displacement); the scanner's formats and the import marker; `errlist` codes mapped to words (and
  the old `errors`); sendMail's error codes; the PowerShell text (ids and mailbox in, nothing
  else); the Entra link.
- Database: the VIN in a backup round trip and hidden from a kid; the mailbox setting and its
  fallback; an account left out stays out on the next sync and its rows leave the totals; the
  service principal id kept by the check.
- Browser: a car's VIN typed in (the decode faked), and the pages pass axe. No live NHTSA,
  SimpleFIN or Microsoft call in CI.
- Guides: `docs/guides/admin.md` (mailbox, Entra link, bank feed) and `docs/guides/family.md`
  (VIN on a car).

### Not in this phase

- Open recalls by VIN inside the app (no public API).
- Changing Entra roles from inside the app (it would need a write permission on the directory).

### The owner's answers (2026-10-24)

1. **Keep the VIN** on the car (grown-ups only, in backups and the vehicle export).
2. **An account left out of a jar:** its rows already here stay but leave the totals and Safe to
   spend.
3. **The alert mailbox in Settings** overrides `ALERT_MAILBOX`, which stays the fallback.

## Phase 57 — scope (dropdowns that look like the app, 2026-10-29)

The owner noticed the dropdowns look like the operating system's, not the app's. There are 51
plain `<select>`s in 29 files (none `multiple` or with `size`); their closed box gets the app's
border, but the arrow and the open list are the OS's own. Nothing decided that: it's what was
left when shadcn/ui was removed (2026-10-09). The owner picked the mixed approach most polished
apps use (2026-10-29): the app's own look on every dropdown, the native list kept for plain short
choices (phones keep their own pickers, the browser keeps accessibility), and a custom picker only
where a list is long or needs search. Three parts, two pull requests: 57.1 and 57.2 together, then
57.3 once the owner has picked its lists. Fable's scope review (2026-10-29) checked the CSS
against this codebase, the browser facts and the forms, and is folded in.

### 57.1 — Every dropdown looks like the app

- **One rule in `app/globals.css`, not 51 edits,** for `select:not([multiple], [size])`. It is
  unlayered, like the existing phone 16px rule and for the same reason: Tailwind v4's utilities
  layer beats the base layer, and `field`'s `px-3` would otherwise put the text under the
  chevron. So the rule's `appearance: none`, chevron and right padding can't be overridden by a
  select's own classes, which is the point; everything else (border, rounding, colours, width)
  stays with `field`, School's `box` and the forms' own classes.
- **The chevron is a background, not a mask** (a mask on a select clips the whole control, and a
  select can't carry `::before`/`::after`): two small `linear-gradient`s in `currentColor`,
  positioned at the right. They follow the text colour in both themes, need no image, and
  survive `field`'s `bg-background` (Tailwind's `bg-*` sets only `background-color`).
- `select:disabled` gets `opacity: 0.5`, matching the buttons (`field` has no disabled style).
- **Unchanged:** the dark-mode list colours set for Windows (`select option, select optgroup`),
  the 16px font on phones (iPhone zoom), `field`'s focus ring and 44px touch height. Behaviour
  doesn't change: the native list, phone pickers, keyboard type-to-select and screen readers are
  the browser's own.

### 57.2 — The styled open list, where the browser has it

- After 57.1's rule (so it wins on source order), inside `@supports (appearance: base-select)`
  (the test MDN uses) and `@media (pointer: fine)`: the select and its `::picker(select)` take
  `appearance: base-select`, and the open list is drawn as the app's card (rounded corners,
  border, shadow, the popover colours), the chosen option in the brand colour with a tick
  (`::checkmark`), hover and keyboard focus visible. Here 57.1's gradient chevron is turned off
  (`background-image: none`) and the browser's own `::picker-icon` is styled instead, or the
  arrow would show twice.
- **Where it applies:** Chrome and Edge 135 and later. Safari 27 (September 2026) is reported to
  ship it; verify on a device. Firefox has it behind a preference only. Everyone else keeps
  57.1's look with the native list. Form submission is unchanged: every option here has a
  `value`.
- **Phones and tablets keep their pickers:** base-select doesn't use the phone's own sheet or
  wheel (MDN), and `pointer: fine` keeps every touch-first device native: Android phones, and
  iPads, which report `pointer: coarse` even with a trackpad. A Windows laptop with a
  touchscreen reports `fine` (its mouse is primary) and gets the styled list, which is right for
  it.
- Options stay plain text, so nothing depends on the browser having this.

### 57.3 — A custom picker only where it earns its keep

- **One shared component, `components/picker.tsx`, modelled on the grocery add box's combobox**
  (`app/(app)/groceries/add-box.tsx`, a sound ARIA 1.2 combobox), which itself doesn't change.
  The add box is a free-text search against the server; a picker needs more:
  - a passed-in list filtered on the device (case and accents ignored; a zone found by its city),
    with option groups (the receipt's "On this trip" and "Everything else"), an optional emoji
    and second line per option, and a cap on rows drawn (about 50, "keep typing" below) for the
    418 time zones;
  - a strict "must be one of the options" state, the current choice shown when closed, a clear
    button, open on focus and on ArrowDown, and Home/End;
  - **both kinds of caller:** `value`/`onChange` for the controlled ones (the time zone, which
    "Use this device's" also sets; one picker per receipt line; the category picker, which has
    no form at all), and an optional `name` for forms that post to server actions;
  - **validation and reset that work:** the value is carried in a visually hidden text input,
    not `type="hidden"` (which ignores `required`), with `setCustomValidity` on the visible box
    so a required picker blocks submit with the browser's own message; and it resets with its
    form (the `reset` event React 19 fires after a successful action; every `useActionState`
    form here relies on it).
- **Candidates (the owner's call, question 1):**
  1. **Time zone** (Settings → Household): 418 zones in one list today. The strongest case.
  2. **The receipt's item match** (Groceries → a receipt): the trip's items, then the whole
     pantry, which grows with the household.
  3. **Merge into** (Groceries → an item): the whole pantry.
  4. **Money categories** (a jar's Activity): the jar's own categories with their emoji (15 to
     start).
- **Next in line, not in this phase:** the people and contact lists (the doctor and pharmacy on
  a med, a school contact, relationships, invites, a store's members) stay short today but grow
  with Google Contacts sync (Phase 8.5), and "Which charge?" on an order has no limit. The
  picker's API is designed so they can move to it later.
- Everything else is a short plain choice (a role, a cadence, a kind, a unit) and stays styled
  native.

### Tests

- Unit: the picker's filtering (case, accents, a zone by its city), option groups, the row cap,
  and keyboard handling, as pure functions where possible.
- A guard test, like `lib/forms-guard.test.ts`: no `<select>` gains `multiple` or `size` without
  the scope's native fallback being thought about (the unlayered rule means classes can't undo
  the look, so that's the only gap).
- Browser: the accessibility pass (both themes, both widths) covers the chevron's contrast and
  focus, plus axe on an open picker; a picker chosen by keyboard and by mouse posts its value
  through a `useActionState` form and is empty again after success; a required picker blocks
  submit; a receipt with 10+ lines stays responsive. The styled list is checked absent in a
  phone-emulated context (Playwright's `isMobile` device, which reports a coarse pointer;
  `emulateMedia` can't set `pointer`).
- Guides: `docs/guides/admin.md` (time zone search) and `family.md` only if 57.3 changes how a
  list is used.

### Not in this phase

- Rich options inside native selects (icons, avatars): plain text keeps every browser equal.
- Replacing the date fields, checkboxes or radio buttons: not raised; they already follow the
  theme.
- Moving the people and contact lists to the picker (above).

### Questions for the owner

1. **Which lists get the custom picker?** Recommended: time zone, the receipt's item match and
   Merge into; categories only if seeing their emoji in the list matters to you.
2. **The styled list on mouse-first devices only** (Macs, Windows PCs, including touchscreen
   laptops), with phones and iPads always keeping their own pickers: recommended.

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
