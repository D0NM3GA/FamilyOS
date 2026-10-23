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
