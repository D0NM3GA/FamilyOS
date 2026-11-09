# FamilyOS build log (condensed)

This is a condensed, public version of the project's build log: what each phase built, why,
and the technical decisions a developer working on the code should know about. The full
phase-by-phase diary (review back-and-forth, test counts, day-by-day notes) stays private.

- **Phases are numbered by the plan, not by date.** Half-phases (2.5, 10.5, 12.5, 16.5, 18.5,
  21.5, 28.5) were split out of a larger phase and often built much later. They're listed in the
  order the full log has them, which is roughly build order.
- **Every phase ran the same pipeline:** scope, an adversarial scope review, build, an
  adversarial review of the actual diff, fixes. The reviewer is called Fable. Only findings that
  changed a design are kept here.
- **"The owner's call"** marks a product decision made by the household's owner rather than an
  engineering default.
- Examples use the made-up family: Dad, Mom, Grandma, Grandpa, kids Ivy and Max, contacts named
  Parker.

## Pinned stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | Request APIs are async. `middleware.ts` is `proxy.ts`; auth checks live in layouts, route handlers and server actions |
| Language | TypeScript (strict) | |
| UI | Tailwind CSS v4 (CSS-first `@theme`) | shadcn/ui at first, later removed |
| Database | PostgreSQL 17 + Prisma 7 | No Rust engine; needs a driver adapter (`@prisma/adapter-pg`) |
| Auth | Better Auth 1.x | Entra (tenant-pinned), later passkeys and generic OIDC |
| Validation | zod | |
| Tooling | npm, Node 24 LTS | |

Standing rule: after a migration, regenerate the Prisma client and restart the dev server; the
`globalThis`-cached client in `lib/prisma.ts` survives hot reload.

## Phase −1 — Machine prerequisites

Node 24 LTS, Docker for Postgres, and a single-tenant Entra app registration (web redirect URI,
client secret, `email` optional claim). Secrets go into the gitignored `.env`; `.env.example` is
the committed template.

## Phase 0 — Foundation and app shell

- Docker Postgres with a healthcheck, `db:up`/`db:down`. Core schema: `Household`, `Person` (one
  entity for household members and outside contacts), `ImportantDate`, `InteractionLog`, plus
  Better Auth's tables in the same schema.
- Better Auth's Microsoft provider: tenant-specific authority (never `common`), the base64
  profile image dropped in `mapProfileToUser` (it overflows header limits), `oid` as identity.
  Non-tenant accounts are refused by the single-tenant registration before our callback runs.
- Kid profiles with an argon2 `Person.pinHash` and a picker at `/profiles`. The active profile is
  an HMAC-signed HttpOnly cookie (`lib/active-profile.ts`): tamper-evident, not encrypted, since
  person ids aren't secret. A first sign-in links to a seeded `Person` by email.
- A CRM-style shell (top bar, icon rail) gated by `requireActiveProfile()` in
  `app/(app)/layout.tsx`.

## Phase 1 — People Hub

People index with search and filters, create/edit forms, and a record page modelled on a CRM
company record: key information, a log-interaction box with Catch-up and Activities tabs, and a
right rail with household members and important dates. Logging updates
`Person.lastContactedAt`; Home gets "Upcoming dates" and "Haven't talked in a while" cards.

## Phase 2 — Chores (generic recurring-task engine)

A port of Donetick's model, kept generic so meds and other recurring work can ride it later.

- `TaskDefinition` (domain, frequency ONCE/DAILY/WEEKLY/MONTHLY/INTERVAL_DAYS/DAYS_OF_WEEK,
  points, assignment FIXED/ROUND_ROBIN/LEAST_ASSIGNED, an assignee pool), `TaskInstance` with
  `@@unique([definitionId, dueDate])` for idempotent generation, and an append-only
  `PointsLedger`.
- `lib/chores/schedule.ts` is pure: dates are local calendar days (a chore "due today" must match
  the family's wall clock), day counts go through `Date.UTC` so DST can't skew them, and month
  addition clamps without drifting off the anchor (Jan 31 → Feb 28 → Mar 31). Vitest added.
- Instances roll forward when the board loads (no cron), one at a time so rotation rotates.
- Kids can only complete or undo their own instances, enforced in the server actions.

## Phase 2.5 — Entra profile enrichment

Pulled forward so the Graph token plumbing would exist on the smallest surface first. Linked
adults get name, email, mobile and photo from Graph with the `User.Read` they already had.
`lib/graph` is **self-only**: it takes the token from the current session, never a user id,
because a Graph token only grants `/me`. Failures become `{ ok: false }`, never a crashed render.
Automatic "fill" mode writes only empty fields; the manual "Sync from Microsoft" button
overwrites and only shows on your own record. Photos go through an authenticated route with a
private cache header, and hot-path queries omit the photo bytes.

## Phase 3 — Groceries

A port of Grocy's shopping-list slice: `Store`, `QuantityUnit`, `Product`, one persistent
`ShoppingList` per household, items, and `Purchase` snapshots when a trip is completed. Local
autocomplete is separate from the Open Food Facts lookup so typing never waits on an outside
API; Open Food Facts calls send a custom `User-Agent` and fail closed to manual entry.
`requestedById` (who an item is for) is carried onto purchases.

## Phase 4 — Microsoft Graph pass

- Scopes are listed explicitly in `lib/auth.ts` rather than trusting an undocumented merge with
  Better Auth's defaults.
- Home shows the week from `calendarView`, which expands recurring events. The family calendar
  is a synced-in Google Calendar, invisible to the default-calendar endpoint, so
  `FAMILY_CALENDAR_NAME` names the calendar to read; an unknown name is an error, not a silent
  fallback.
- "Recent emails" needed three fixes found against live data: root `/me/messages` search skips
  Sent Items, and `$search` matches any mention of an address. The final version filters
  received mail with `$filter=from/emailAddress/address eq …` and filters a bounded Sent Items
  batch client-side (Graph has no `any()` on recipient collections).

## Phase 4.5 — Foundation hardening

1. Board queries and `ensureInstancesGenerated` take a required task `domain`.
2. `lib/authz.ts`: `requireAdult()`, `isAdult()`, `assertOwnRecord()`, later `requireAdmin`.
   People actions gained a role gate (a kid can add a contact, not a household member).
3. Better Auth's `encryptOAuthTokens` on; it covers access and refresh tokens only, so `idToken`
   stays plaintext. `lib/crypto.ts` adds AES-256-GCM with a dedicated
   `INTEGRATION_ENCRYPTION_KEY`, AAD bound at the call site, a pinned 16-byte tag and IV/tag
   length checks.
4. ESLint domain walls (`no-restricted-imports`); every new domain registers in the same commit.
5. `PersonRole.ADMIN`, set only from Entra; the People form never accepts it.
6. Entra app roles (`Admin`, `Adult`, `Kid`) read from the stored ID token's `roles` claim
   (group-based assignment needs Entra ID P1). New provisioning is default-deny, which closes a
   kid's own Microsoft account auto-provisioning as an adult; an already-linked person keeps
   their role when the claim is absent. Denied sign-ins go to `/not-provisioned` instead of an
   unrecoverable 500.
7. Settings → Household for admins: a roster with Remove (Entra owns roles). A removed person is
   turned away in `getAuthPerson` before any role resync.

## Design passes — warm and family-friendly, then motion

The first pass found the app had never rendered its font (`--font-sans: var(--font-sans)` is a
self-reference) and wired Nunito, a warm orange chrome, a `brand` token chosen for WCAG AA with
white text, and grays warmed to `stone` by a count-verified rename. The second added life on top
of the CRM layouts with the already-installed `tw-animate-css`: avatar stacks, a popping points
pill, an optimistic completion burst, staggered entrances, and a global `prefers-reduced-motion`
block that zeroes duration and delay. Making the task card a client component briefly serialized
full `Person` rows (PIN hashes included) into the page; since then, every client boundary gets
exactly the fields it needs.

## Phase 5 — Meds (first ride on the task engine)

- The engine moved to a `lib/tasks/` kernel and the card to `components/tasks/` with
  `onComplete`/`onUndo` props, so the Meds board can't call Chores' actions. A `tasksKernel` lint
  zone stops the kernel importing any domain.
- Bucketing by exact midnight equality would have dropped timed doses; now day ranges in a pure,
  tested `bucketInstances`.
- Multi-dose: `TaskDefinition.timesOfDay`. A pure `planInstances` skips existing due dates before
  any assignment pick, and the roll-forward anchor is floored at today so schedule edits (which
  delete future PENDING instances) leave no gap.
- Points go to the assignee, not whoever tapped Done (the owner's call).
- Times are formatted on the server and passed as strings to avoid hydration mismatches.

## Phase 6 — Vehicle maintenance

Mileage can't be known ahead, so vehicles got a flat model instead of the date engine:
`Vehicle`, `VehicleMaintenanceItem` and an append-only `VehicleServiceLog` (the owner's call).
Due status is "whichever comes first" per axis (`lib/vehicles/due-status.ts`). Services can be
backdated and only update the cached "last done" when newest. The quick odometer control is
monotonic (an overshoot would mark everything overdue); the edit form corrects either way. No
points or assignee; mutations are adult-gated; a Home card surfaces anything overdue.

## Security remediation — 2026-09-16

A three-round review before real data led to seven fixes: a client-level Prisma `omit` on
`Person.pinHash` and `Person.photo` (fixing the leak class at the root); an adult gate on People
edits; PIN lockout after five wrong guesses; Better Auth `disabledPaths` for unused routes,
notably `/get-access-token`, which handed the raw Graph token to any request with the session
cookie; Graph-backed cards only for the session owner's own profile (`isSessionOwner()`); a
`localhost` fallback removed from the auth client; Postgres bound to `127.0.0.1`.

## Dark mode — 2026-09-16

The real work was a count-checked, word-boundary-safe codemod converting about 490 hardcoded
light classes to theme tokens, plus hand fixes where it collapsed distinct shades. The no-flash
script is a literal `<script>` in a literal `<head>`, per Next's guide (`next/script`'s
`beforeInteractive` runs too late), with `color-scheme` and `suppressHydrationWarning` set. A
light/dark/system toggle with no new dependency.

## Phase 7 — Cross-domain foundation

First of six follow-up phases (foundation, People, Meds, Groceries, Chores, Vehicles).

- `Household.timezone`, canonicalized through `Intl` but not yet used for due dates; a mismatch
  with the server clock is logged, and the deploy's `TZ` must match.
- Global search (`lib/search.ts`) and an activity feed (`lib/activity.ts`) composing each
  domain's own queries; the mascot (Bunson) gets lines from real data (`lib/bunson-facts.ts`).
  These aggregators may import every domain, and `AGGREGATOR_IMPORT_PATTERNS` stops domains
  importing them back.
- `app/(app)/error.tsx`, the first error boundary under the shell.
- `postinstall: prisma generate`, and `db:migrate` runs generate (Prisma 7 dropped it).

## Phase 8 — People Hub

- `staleContacts` excludes household members unless they have a `contactCadenceDays` override
  and judges others against it or a 21-day default; one pure `pickStaleContacts` serves Home and
  the mascot.
- `PersonRelationship`, stored once and viewed from either side through an inverse map. The
  review found every doc comment described the direction backwards, which would have corrupted
  a future importer; comments and the add form ("Max is Dad's Child") now match storage.
  Equivalent rows from the other side are caught before insert. Adults only.
- Google Contacts sync was split out (it needs a published Google OAuth consent screen first).

## Phase 9 — Meds

- `Medication`, 1:1 with a MED `TaskDefinition`: stock, dose amount, refill threshold,
  prescriber and pharmacy (People contacts). `TaskInstance.quantityConsumed` lets undo restore
  exactly what a dose took.
- Complete/undo are transactions with status-guarded `updateMany` (closing a latent
  double-completion bug) and atomic stock changes; the refill decision uses the row the
  decrement returns.
- A refill hook adds "Refill …" to the shopping list through a kernel (`lib/shopping-list.ts`)
  after commit, never failing the dose; `ShoppingList` got `@@unique([householdId])`.
- Name autocomplete from NLM's RxTerms service, built against the verified live response shape.
- Convenience actions never throw into the error boundary.

## Phase 10 — Groceries

`ProductGroup` categories; pantry suggestions from purchase history (three distinct days, median
interval, stops at three medians). Barcode groundwork: `normalizeBarcode` follows Open Food
Facts' rule (pad to 13 and keep the last 13; EAN-8 untouched), verified live, and lookups prefer
the canonical code returned, with a 5 s timeout. `addItemByBarcode` is deliberately
non-idempotent, so callers debounce. Camera scanning was split to 10.5.

## Phase 11 — Chores

- Weather-sensitive chores: household coordinates, and `lib/weather.ts` wrapping the National
  Weather Service with a timeout and a 10-minute negative cache. Informational only.
- Count-based milestones (not streaks), computed in the completion transaction and shown by a
  board-level toast so a card leaving the list doesn't lose it.
- Chore points go to the assignee. Adult-only reassignment; the completion guard pins
  `assignedToId` so a concurrent reassignment can't credit the wrong person.
- `/points` with a `Reward` catalog; redemptions take a per-person Postgres advisory lock.

## Phase 12 — Vehicles

- A vehicle hub: maintenance, recalls, fill-ups with MPG (LubeLogger's semantics: full fills
  only, partials roll forward, a missed fill breaks the chain), history and cost of ownership.
- Money as integer cents parsed from strings, never floats.
- NHTSA recalls in `<Suspense>` with a timeout and negative cache. Live checks overturned several
  assumptions: everyday model names return nothing, `ReportReceivedDate` is day-first, the
  issues-only model list hides recall-free models, and a zero-result lookup answers HTTP 400.
  Real recalls always win over a failed name match.
- Print view outside `(app)`, since the app layout's overflow clips printing.

## Phase 13 — Print views

A presentational print kernel (`components/print/`, its own lint zone) and `app/print/<domain>`
pages: groceries, chores (per person or a grid, from generated instances, since rotation is
decided at generation), meds (adult-only), people (never `Person.notes`) and vehicles. Long
tables repeat headers and keep rows whole.

## Phase 14 — Next.js security upgrade

Next 16.2 had open advisories (a server-action DoS, critical RCEs), so the app moved to 16.3 with
Prisma 7.10 in lockstep. npm 11's `allowScripts` had to be re-pinned or Prisma's engine download
would be skipped silently. A vulnerable `mysql2` inside Prisma is overridden (Postgres-only app).
Never `npm audit fix --force`: it "fixes" Prisma by downgrading it.

## Phase 15 — Sentry

The owner's defaults: no personal data leaves the house, users are an opaque person id, no
replay, light tracing.

- `@sentry/nextjs` 11 collects cookies, bodies, user info and locals when `dataCollection` is
  unset, so it's pinned and every category is spelled out in `lib/observability/options.ts`.
- Scrubbers (`lib/observability/scrub.ts`) run as `beforeSend`, `beforeBreadcrumb` and
  `beforeSendSpan`, failing closed. `lib/observability/index.ts` is the only doorway, enforced by
  a lint rule against `@sentry/*` imports elsewhere. Client init is `instrumentation-client.ts`;
  source maps are disabled so they aren't published.
- A composition test runs the real SDK with an in-memory transport. It caught user fields copied
  onto spans, hostnames and coordinates; weather requests (whose path is the household's
  coordinates) are excluded, and names are stripped from DOM selectors.
- Sentry geolocates the connection itself, so "Prevent Storing of IP Addresses" must be switched
  on in the project (README "Error monitoring").

## Phase 16 — Exports

`lib/csv.ts` (RFC 4180, a BOM for Excel, a formula-injection guard) and `lib/export.ts`
`authorizeExport` (no cross-site fetches, kids never, adults for CSVs, admins for the backup,
fixed filenames, `no-store`). Seventeen CSVs from each domain's own route. A versioned
whole-household JSON backup read in one REPEATABLE READ transaction; `lib/backup/coverage.test.ts`
fails `tsc` when a model column is neither exported nor allowlisted. Never exported: PIN hashes,
sign-in links, photos, OAuth tokens, secrets. The owner's calls: backup admin-only, no encryption
for now.

## Phase 16.5 — Restore from backup

- Admins can set a PIN for members without their own sign-in (backups never carry PIN hashes).
- `lib/backup/plan.ts` (pure) validates references and uniques, matches household members by
  email one-to-one, and re-issues every id. Errors never echo names, emails or ids.
- `lib/backup/restore.ts`: one REPEATABLE READ transaction that snapshots the household first
  (downloaded as the undo copy), deletes in safe order (never Microsoft-linked people) and
  inserts in dependency order. Apply must echo the preview's plan digest.
- The route checks `Sec-Fetch-Site`, JSON content type, Origin, a signed-in admin, a size cap and
  a typed `REPLACE`; a server timezone mismatch blocks unless overridden.

## Phase 10.5 — Barcode camera scanning

One decoder everywhere: the `barcode-detector` ponyfill over zxing-wasm, loaded only when the
scanner opens, with the wasm self-hosted and hash-checked (`scripts/copy-zxing-wasm.mjs`), never
from a CDN. `lib/groceries/scan-gate.ts` needs two identical reads, allows one submission in
flight and a per-code cooldown. Open Food Facts files UPC-E products twice, so typed UPC-E codes
are expanded by GS1 rules and misses retry under the short form. `npm run dev:lan` serves HTTPS
with a real certificate for phone testing (the owner's call over a local CA on each phone).

## Phase 12.5 — Vehicle garage supplies

`VehicleSupply`, `VehicleItemSupply` and `VehicleServiceSupplyUse` (what a service took, so undo
restores exactly that). Stock changes are single SQL statements that lock the row in a CTE, clamp
at zero and round, locking in id order so two services can't deadlock. Low supplies go to the
shopping list. The owner's calls: undo removes the most recently entered service; backdated
services don't take today's stock unless ticked.

## Phase 17 — Family calendar in Outlook (Graph write-back)

- Incremental consent: only "Grant calendar access" asks for `Calendars.ReadWrite`, so sign-in
  can't break if the tenant hasn't approved it. Granted scopes come from `Account.scope`.
- A dedicated calendar in the connecting admin's mailbox, shared through Outlook, not the
  Google-synced one (the owner's call). No refresh token is kept for
  background work; the app writes only while the owner uses it.
- `lib/calendar-sync/`: pure event building and diffing, and an executor that holds a renewed
  lease, writes its link row before each create, and uses Graph's `transactionId` plus a
  source-key extended property so a crash can't duplicate or orphan events.
- Toggles: dates and maintenance on; chores and doses off (doses warn about who sees them).

## Phase 18 — School

`SchoolProfile`, `SchoolContact` (links to People), `SchoolTask` (forms, fees, to-dos) and
`SchoolAssignment` (overdue derived, never stored), entered by hand until a school-system
connector exists. A kid sees only their own tab and manages their own homework, not grades.
Home card, search, activity (never grades), print card, CSVs, calendar toggles, backup v3.

## Phase 18.5 — School calendar feeds

`SchoolFeed` stores the iCal URL encrypted (feed links carry private tokens); events are a cache;
neither is backed up. The SSRF guard accepts only https, blocks private and special ranges with a
`net.BlockList`, and checks the address the socket actually connects to through a custom
`lookup`, so there's no rebinding window; redirects are manual, with an overall deadline and size
cap. ical.js (pinned) iterates recurrences from DTSTART with a step cap. Refreshes are claimed
atomically and run in `after()`. Feed actions are admin-only.

## Phase 19 — Sticker Book shell

The redesign picked from a round of mocks: ink and paper, Baloo 2 and Gaegu fonts, reactive
brand tokens checked for AA in both themes, and the name FamilyOS. `Person.color` from a
contrast-tested palette. A Microsoft 365-style launcher (`lib/apps.ts`, a pure catalog) with
per-person pins, a phone bottom bar, and grown-up apps hidden from kids' navigation (cosmetic;
pages authorize themselves).

## Phase 19.5 — Big buttons view and mascot moments

`Person.viewMode` (BIG/FULL; kids default to BIG) and `Person.bunsonVolume`. Views never change
permissions. Mascot moments are gated in CSS by a `data-bunson-volume` attribute with a
plain-text twin, so no page loses content when he's hidden. The owner approved light, comic
nagging; he's never sad.

## Phase 20 — Sticker Store

Shelves, rewards with weekly limits and "needs OK", and `RewardOrder` with snapshots. Placing an
order runs under the per-wallet advisory lock; grown-up actions are status-guarded and credit
back only when the flip happened. The order→reward key is NO ACTION, not RESTRICT, so deleting a
household with orders works. A `Notification` inbox and a bell for admins.

## Phase 21 — Alert channels: Teams and email

Teams through a Workflows webhook (Office 365 connectors are retired), the URL encrypted,
allowlisted to the Workflows hosts and path, posted with `redirect: "error"`, never sent back to
the browser. Email through app-only `Mail.Send` scoped by Exchange RBAC for Applications, with no
Entra mail permission (grants are a union). Delivery is scheduled with `after()`, only on success.

## Phase 21.5 — Central Teams alerts

One family Workflows link: the Flow bot can message anyone in the tenant when the recipient comes
in the trigger body. Teams uses sign-in addresses only, changing the link needs an admin on their
own sign-in, and the page says "Teams accepted it", since a 202 isn't delivery.

## Phase 21.6 — Phone push (Web Push)

Node built-ins only: RFC 8291 aes128gcm (matching the RFC's test vector) and RFC 8292 VAPID.
Endpoints are allowlisted to the known push services, p256dh must be on the P-256 curve, and
statuses map to ok, gone, bad server keys, counted or transient. A minimal PWA manifest and
service worker.

## Phase 22 — Groceries: one add box, item sheet, Pantry

Every list row is now a Pantry item, found or created on a normalized `nameKey`. Units were
replaced by a product's package size. One add box handles typing, scanning and keyboard-wedge
barcodes; an item sheet merges look-alikes. Open Food Facts v3 with `product_type=all` so
non-food products match.

## Phase 23 — Groceries: Shop view and kid picks

A Shop view with big toggles, undo and a wake lock. Offline check-offs queue in localStorage (the
stored queue is the single source of truth across tabs) and flush when signal returns. Kids' adds
are `kidPick`s that grown-ups can turn down, notifying the kid.

## Phase 24 — Receipt prices (Azure AI Document Intelligence)

`lib/documents/` calls Document Intelligence v4 with an app-only Entra token (no keys), an
endpoint allowlist, polling, a deadline, and deletion of the service's copy. `ItemPrice` and
`ReceiptAlias` keep prices and learned line names; no images are stored. The phone shrinks the
photo and drops metadata. Grown-ups only.

## Phase 25 — Money jars

The owner's calls: bank feeds through SimpleFIN plus statement import behind one reconciler, and
Privacy.com card enrichment. Money lives in **jars** that even admins can't
open unless they're members.

- `requireJar` opens a jar only for an adult member on their own sign-in; PIN-switching into an
  adult with a sign-in is refused.
- `MoneyJar`, `MoneyJarMember`, `JarConnection` (encrypted per jar), `FinAccount`,
  `FinTransaction` (cents, civil `@db.Date`, ACTIVE/DUPLICATE/SUPERSEDED/IGNORED).
- The bank-feed client allowlists exact hosts, validates with zod and converts decimal strings to
  cents without floats. The Privacy.com client calls only `GET /transactions`, so card numbers
  are never fetched.
- OFX/QFX and strict CSV import; a pure reconciler folds duplicates and asks about near matches.
- A `finances` lint zone, and a rule that search, activity, Home and the shell can't import
  finance code. Jars stay out of the household backup.

## Phase 26 — Budget, bills and grocery trips

Per-jar categories with monthly targets, "always for this merchant" rules and an idempotent tidy
pass after every sync and import. Pure logic for budget months, recurring detection and matching
grocery trips to card charges. Every Privacy.com card counts as a subscription.

## Phase 27 — Loop-closers and surprises

Kids never see money. Background jobs (`lib/background.ts`, started from `instrumentation.ts`,
not during `next build`) sync feeds and send money alerts with no amounts or raw bank text.
Surprises: an adult can hide a charge from chosen members until a reveal day; hidden rows leave
every list and alert but still count in totals, and the mark follows the same charge across
folded and pending→posted rows. Quarterly and yearly bills.

## Phase 28 — Per-person backups and AAA

A 15-minute "fresh sign-in" step-up (`session.freshAge`); credential re-entry is left to Entra
Conditional Access. Sensitive downloads are POST-only with Origin checks. `BackupEvent` records
who and the SHA-256 of the exact bytes saved, and other admins and jar members are told. The
admin's backup seals every jar with a server-held key (household-independent AAD so a rebuilt
server can open it); a member's own copy holds only what they can see.

## Phase 28.5 — Putting money jars back

Opt-in restore of sealed jars inside the restore transaction. Membership is bound to sign-in
addresses (the sealed section carries a digest of the file's people), so editing the file or a
profile email can't make someone a member of another person's jar. Syncs are held meanwhile.

## Phase 29 — Order emails into money jars

The owner's calls: per-person opt-in on their own mailbox (delegated `Mail.Read`), results only
in a jar they're in, never store mail bodies. Parsers for Amazon, Apple and Publix pickup order
emails.

- Only allowlisted sender and subject pairs are opened, and the topmost
  `Authentication-Results` header must show DMARC/compauth pass, so a spoofed From can't add
  orders. Mail forwarded through an address relay is decoded and trusted as far as the relay.
 
- A linear, size-capped HTML-to-lines reader; synthetic fixtures. Scans run on the person's own
  visit (the Graph token is self-only), bounded, in `after()`.
- Matching uses retailer, total and a per-retailer date window (Publix totals within 15%).
 
- Everyone in the jar sees matched orders except where a charge is a surprise, because the two
  parents share one bank and Privacy.com account.

## Phase 30 — Shared-jar polish

`JarEvent` history, filtered so nothing reveals a surprise. One jar per account: a Privacy.com
key's HMAC fingerprint and SimpleFIN account ids keep an account from feeding two jars.
 One Teams group chat per jar, fed only alerts that aren't a surprise for
anyone; the app can't see who's in a chat, so keeping kids out is up to whoever links it.

## Phase 31 — Saving up and coming up

Opt-in rollover per category (a goal turns it on), with a pure envelope calculation capped at 24
months. A 30-day "Coming up" list of bills. Price-change detection compares runs of charges, with
thresholds so a utility's normal wobble doesn't alert.

## Phase 32 — Safe to spend

`lib/finance/forecast.ts` detects paydays (biweekly, 1st/15th with weekend shifts, weekly,
monthly), projects regular outflows on the chosen accounts until then, and subtracts a cushion
from the lowest point. A low-balance alert fires once per pay period, only on fresh balances.

## Phase 33 — Spending trends

Read-only month bars, "where it went" shares and sparklines, all through `budgetMonth` so numbers
match the Budget tab. Surprises are never compared or paced. One hue plus grey after the sticker
palette failed contrast checks.

## Security and performance pass (2026-10-07)

Session and profile lookups once per request (React `cache`). The active-profile cookie is signed
over the Better Auth session id too, so it can't outlive sign-out into the next adult's session.
PIN guesses serialized per profile, lockouts doubling up to a day. Security headers on every
response. The owner's calls: order emails can be surprises, 6-digit PINs for PIN-only grown-ups.

## Full review (2026-10-09)

Read-only reviews of performance, UX and dependencies, plus a 375 px phone pass.

- Cleanup: unused shadcn pieces, the unused `IntegrationCredential` model and dead actions gone;
  one money kernel (`lib/money.ts`).
- Speed: `app/(app)/loading.tsx` (dynamic pages weren't prefetched), Outlook cards streamed in
  `<Suspense>`, instance generation as one LATERAL query plus `createMany({ skipDuplicates })`,
  and indexes for busy pages.
- Phones: shared class strings in `components/styles.ts` (44 px targets), 16 px inputs so iOS
  Safari doesn't zoom.
- Gaps filled: skip/missed doses and chores, editable interactions, a family-week calendar, trip
  history, grocery undo via a short-lived household-bound HMAC token, hand-added bills.
- The owner's calls: the signed-in grown-up's own tile can be PIN-locked; PIN hashing moved to
  Argon2id with explicit parameters above OWASP's floor and rehash on login (`lib/pin-hash.ts`);
  grown-ups-only notes; kids can do "Anyone" chores.

## Phase 34 — Net worth

Per jar: daily balances kept from each SimpleFIN sync plus typed-in holdings (home, vehicle,
other assets, loans) with dated values. Month-end math marks partial months so
a newly connected account doesn't read as a gain. Writes are locked per jar or holding.

## Privacy pass and the FamilyOS name (2026-10-12)

The repository is meant to be publishable as open source. `Household.appName` (the family types
its name, the app adds "OS") is read per request through `getAppName`, never baked in at build.
Outside services get `PRODUCT_NAME` only. Identifiers were renamed to `familyos` (clean breaks on
test data). Personal details were removed; fixtures use the made-up family and the first admin
comes from `SEED_ADMIN_*`. `npm run privacy:check` checks files, the branch, unpushed commits and
the git identity against `.git/info/privacy-terms`, a never-committed term list (rules in
AGENTS.md "Privacy and naming").

## Phase 35 — Make it yours

Settings → Make it yours: app name, top-bar color (eight presets tested for contrast in both
themes), the reward word, the mascot (on/off, renamed) and the Home Screen icon (drawn per
request with `next/og`). Defaults are stored as null so families follow future defaults. UI copy
reads them through `lib/family-look.ts` and `components/family-look.tsx`.

## Phase 36 — Apps on and off

`Household.disabledApps` (NOT NULL so array filters can't silently fail). Switchable: calendar,
chores, meds, groceries, school, money, store, cars (Garage follows Cars).

- A page guard, not a layout gate: a layout doesn't stop its page from running and isn't
  re-rendered on client navigation, so every page of a switchable app starts with
  `await requireAppOn("<app>")`, and `lib/app-guard.test.ts` fails if one doesn't.
- Background work pauses at its source; exports, search, Home and the bell hide off apps. Nothing
  is deleted.
- Settings → Apps lists only switchable apps (the owner's call: settings lists show only what can
  be changed). Money warns that after about three months off the oldest charges can't be fetched,
  since the SimpleFIN window reaches about 90 days back.

## Phase 37 — Editable store sections and money categories

Sections and categories became editable: rename in place, add, reorder, and remove-and-move.
Starting items keep a stable key (`ProductGroup.starterKey`, `FinCategory.absorbedKeys`) so
logic keyed on a starting category follows its charges. Removals re-point charges and rules in
one transaction under the jar's category lock, which the tidy pass also takes. Built-in
categories can be renamed but not removed, with no badge (the owner's call).

## Phase 38 — Sharp edges

First of the polish phases (38–45). The owner's calls: one-tap deletes ask first, in place;
people who sign in with Microsoft are managed in Entra, not removable here.
`canRemoveFromHousehold` decides on both page and action. `SubmitButton` disables itself while
its form is busy (React sends every submit), and `ConfirmSubmit`/`ConfirmAction` ask first;
`lib/forms-guard.test.ts` reads every form to enforce both. `predev` runs `prisma generate`.

## Phase 39 — Performance

Measured with Postgres statement logging. The layout ran about 20 statements per load, mostly
the mascot's facts; he now fetches them from `GET /api/bunson-facts` after load when idle (a GET,
because server actions share one router queue and would hold up a tap on "Done"). One household
read per request. Icons answer `no-cache` with an ETag, since next/og's production default is a
year-long immutable cache.

## Phase 40 — Sign-in and users

The owner's calls: Microsoft Entra, any OIDC provider or a passkey, through trusted libraries; a
new install is set up by whoever opens it first; passkeys for grown-ups, kids stay PIN profiles;
Entra users checked against Graph on a schedule (no SCIM: the app isn't on the internet);
Microsoft people use Microsoft only, so Entra's policies always apply. Better Auth's SSO plugin
was rejected (plaintext client secrets, any user can register a provider) in favor of core
generic OAuth configured from `.env`.

- **40.1a Better Auth 1.7.** A migration re-keys Microsoft accounts from `sub` to `oid` (read from
  the stored ID token, failing rather than skipping). Unique `(providerId, accountId)`. Implicit
  account linking off: a sign-in never attaches to a user because an email matches.
- **40.1b Microsoft optional.** All three `MICROSOFT_*` values or none; a partial set stops the
  server at start. `lib/sign-in-kind.ts` says `microsoft`/`own`/`pin` where it matters.
- **40.1c Passkeys and setup.** The relying party is set explicitly from `BETTER_AUTH_URL`;
  `lib/passkey-hooks.ts` refuses sign-ins without user verification (the plugin's checks pass
  without it). First-visitor setup uses a hashed single-use token, then `finishSetup` creates the
  household under an advisory lock that re-checks "no household yet". Passkeys need
  `http://localhost:3000` in dev.
- **40.2a Your own passkeys.** Adding needs a sign-in from the last 5 minutes and a single-use
  ticket bound to the session; removing never takes the last one and signs out other devices. An
  append-only sign-in audit log (`sign_in_event`).
- **40.2b Invites.** 48-hour single-use links (hash stored, scrubbed from Sentry), accepted in one
  transaction that re-checks the maker's admin role and the target.
- **40.2c Others' sign-ins.** Make/remove admin, reset passkeys (a 1-hour recovery link, the
  owner's call), remove a sign-in; never leaving no working admin. Notices go to the person.
- **40.3 Any OIDC provider.** ID tokens checked against discovery keys, issuer, audience and
  nonce, PKCE on, a start-up preflight. Sign-up only before setup or with a live invite opened in
  this browser, and the provider must confirm the invite's email. Unknown and unlinked accounts
  get the same message.
- **40.4 Checking Entra.** No Admin/Adult role in the current ID token, no access. Every 30
  minutes the app reads Entra's app assignments with its own token (direct group members only);
  unassigned people lose access on the first check. Read errors change nothing, and a run that
  would leave no working admin is refused.

Security tests drive Better Auth's own handler with a software authenticator and a fake OIDC
provider (`lib/test-support/`).

## Phase 41 — CI and browser tests

The owner's call: checks before more changes. GitHub Actions: lint, types, privacy check and unit
tests; Postgres with `migrate deploy`, a schema-drift check and database tests; a production build
with Playwright tests. Actions pinned to full SHAs, no persisted token, read-only permissions, and
the privacy check never prints a term. The browser story sets up a fresh install with a virtual
passkey, takes an invite in a second browser and opens every page. On Windows, `E2E_CHANNEL=msedge`.

## Phase 42 — Security before going live

- Next upgraded for critical advisories (a few minutes inside the minimum release age, the
  owner's call).
- A per-request nonce CSP from `proxy.ts` (`lib/security/csp.ts`), `'strict-dynamic'` plus
  `'wasm-unsafe-eval'` for the barcode decoder; browser tests fail on any violation.
- Rate limits stored in the database; 30-day sessions without sliding refresh.
- The proxy verifies Cloudflare Access's JWT with Node crypto and fails closed
  (`lib/security/cf-access.ts`).
- A restored admin without a sign-in can't use a PIN.
- `scripts/restore-drill.sh` and a root-only break-glass (`scripts/break-glass.sh`): a 24-hour
  local entrance through a pinned Caddy, announced, logged and bannered.

## Phase 43 — Production container

The owner's calls: a Cloudflare Tunnel with Access in front, a Debian VM, settings in a
locked-down host file, nightly backups. A multi-stage `Dockerfile` (`output: "standalone"`,
throwaway build-only keys, a non-root run image, a separate migrate image) and
`docker-compose.prod.yml` (images by digest, Postgres on an internal network with a Docker
secret, the app read-only with no capabilities and never published). `scripts/backup-prod.sh`
verifies each dump and copies it to a NAS share only when it's really mounted.

## Phase 44 — Accessibility and the Shop list without signal

axe checks (WCAG 2.2 A/AA) on every page in light and dark, with fixes such as a `<main>` outside
the shell, a skip link and focus management. The service worker saves the Shop page only from a
clean same-origin HTML answer carrying a marker only the rendered list has (a streamed error
screen arrives as a 200), replays it offline, expires it after 7 days and clears it on sign-out.
The saved list survives a profile switch because the family has no shared devices; shared ones
are managed in Intune.

## Phase 45 — Settings hub and guided setup

The owner's calls: Settings becomes a hub of status tiles, guided setup follows first run, and
typing coordinates isn't acceptable. Home location comes from the device or a ZIP code (a
bundled, server-only Census ZCTA table), rounded to two decimals. VAPID keys are generated and
stored encrypted when not in `.env`. A walkthrough at `/settings/get-started` and a checklist.

## Phase 47 — The pet

A digital pet for the kids, separate from points and the Store: classic care over time (hunger,
fun, sickness, discipline, life stages, death from neglect) that only runs in family-set care
hours, in a room the kid decorates, with toys, petting and five short mini-games. A pure, seeded
simulation catches the pet up whenever it's opened. Finishing a chore quietly brings the pet a
present (additive only, capped daily), kept secret from the chores side by a test. Pets are in
household backups (format 8).

**The pet's voice** (`lib/pet/voice.ts`). The pet never speaks English: each species has one
sound ("blup", "pip", "mrrp"), the way a Pokémon says its own name, and a narrator says what it
does ("Pip flops over for a belly rub", not "Pip is happy"). Plain words for buttons and
settings; the play lives in the pet's lines. Its quirk changes how its happy lines sound, the way
Animal Crossing villagers sound like their type. Lines come in pools, never the same one twice in
a row, written for a 7-year-old to read alone. Eggs come from Egg Island and pets go back there.
`lib/pet/voice.test.ts` keeps the style: every placeholder filled, 90 characters at most, no
dashes, one exclamation mark at most, nothing about chores or the reward word.

**Hardening after review.** A payout, a present and an item are each claimed in the database
before anything is granted (a conditional update, or an insert that skips duplicates; items are
one of each per person), so two taps at once give one. A round or present that changes nothing
is rolled back and doesn't use up its hour. Care hours come from the household row the layout
already read, before any transaction starts. The present check keeps a bookmark (`Pet.giftsCheckedAt`) and
only reads chores finished since its last look, in batches of 100 that never skip one, so it
stays as quick for an old pet as a new one. Actions answer odd input instead of throwing, and
the pet's own seed (which decides sickness and presents) stays on the server. On the screen,
actions don't trigger a second page load, the room doesn't redraw as the eyes follow the
pointer, the minute refresh survives a hidden tab and pauses during a game, and timers stop
when a screen or game closes. Games take focus when they start and give it back to Play;
Bubble Bath plays with Space, Copy Dance says each move, and care results are announced. A
browser test checks the egg room and its panels with axe, light at desktop width and dark at
phone width. The goodbye stays on screen until a new egg is picked.

Departures from the plan: the pet's state is one checked JSON column rather than typed columns;
a turned-off Pet app goes to the usual "turned off" page; clearing a memory-book page isn't built
(each book is only its owner's); changing care hours applies to the time since a pet was last
opened. The small dot on the Pet tile while the pet is calling isn't built: the tile is drawn on
every page, and knowing whether a pet is calling means catching it up, which would put a pet
catch-up on every page of the app. The pet's own screen shows the call.

## Phase 54 — The pet's fun pass

The owner's call: items 1–3 of the researched fun list, plus the juice from item 1, split from
daily surprises and sound (Phase 55) on Fable's advice. Same rules as Phase 47: additive only,
nothing bought, the chore secret kept, no streaks, no countdowns, no guilt.

- **Growing up, seen.** Growth events now carry the stage and form they reached. The pet keeps a
  bookmark of what the kid has seen (`shownStage`, `shownForm`, `shownTricks`); when the pet has
  moved on, the room opens with a reveal: the old form glows to a silhouette and the new one
  pops in with sparkles and a line in the pet's voice, and new tricks are announced the same
  way. **Yay!** (focused, so Enter or Space; Escape too) saves it as seen with its own plain
  update, read from the saved pet on the server, which works while the pet sleeps and can't
  race a care action. A pet from before this phase gets its bookmark without a reveal. Not
  backed up: a display bookmark.
- **The collection book** (`/pet/book`, `PetDiscovery`): every form a person's pets have
  reached, recorded on every catch-up path whenever the pet grew or a reveal is waiting
  (including a pet that grows and goes in one catch-up), and filled in from the memory book for
  pets from before. Per species, 10 forms; found ones in full, the rest as silhouettes with a
  hint about care in general. Read only, no prize for finishing. Backed up.
- **Tricks** (`lib/pet/tricks.ts`): sit, spin, wave, bow and roll over, learned as bond grows.
  Bond stays on the server; the page passes the list. Asking for a trick is a show worked out
  in the browser (good manners make it reliable; otherwise something sillier), with nothing
  saved and nothing to farm.
- **Juice** (`app/(app)/pet/effects.tsx`): hearts, sparkles, crumbs and bubbles from points in
  the room, food that arcs from the bowl to the pet, a bubble puff where each poop was when
  cleaning, and a squash-and-stretch on every tap. Positions use container units of the room,
  so they line up at any size; reduced motion finishes them at once.
- The room's geometry (slots, poop spots, the bowl) moved to `lib/pet/room.ts`. Two migrations
  are named after other branches' `20261112`–`20261113` folders, so they sort last.
- **Fable's implementation review** (2026-10-23), fixed: effects started off-centre (Tailwind's
  translate utility adds to the keyframes' own centring); the reveal claimed to be modal but
  the care buttons stayed live, so a tap mid-reveal could unlock a trick that was then never
  announced (everything else is now `inert` while it shows, and focus returns to Play, or Room
  while the pet sleeps); an egg that grew past baby unseen was said to have "hatched into" a
  child form; under reduced motion the reveal now shows before and after side by side; locked
  tricks are labelled for screen readers; and the promised tests for form names and growth
  during a care action were added. Left as is: a meal flies to where the pet is walking to,
  not where it is mid-walk (cosmetic, over in half a second).

## Grown-up apps closed to kids (security fix)

Hiding grown-up apps from kids' navigation was cosmetic. The owner's call: closed on the server.
`requireAppOn` sends a kid home from any `adultOnly` app, every Cars and Garage action needs an
adult, and `lib/adult-apps.test.ts` fails if a page, action or download skips the check.

## The move to a public repository

The owner's call (2026-10-23): a fresh public repository under a neutral owner, started from one
clean commit, with condensed build and plan logs; the earlier history stays private. MIT licence.
`main` takes changes only through pull requests whose required checks pass, and a pull request
merges itself once they do. The container check always reports: it builds the image only when
something that goes into it changed.

## Phase 46 — Publish the tested image

The owner's calls: CI publishes the image it tested, the packages are public, and the server runs
a pinned version.

- **Publish only what passed.** On `main`, the container job saves the app and migrate images it
  built and tested; a separate `publish` job (the only one with `packages: write`, no checkout,
  no npm) loads and pushes them to `ghcr.io/<owner>/familyos` and `…-migrate` as
  `sha-<commit>`, attests each digest (`actions/attest-build-provenance`, stored in the
  registry), and moves `main` only if its commit is still the branch's head. Each push to main
  is a concurrency group of its own, so no merge's run is cancelled and every commit on main gets
  an image. The images are saved before the break-glass rehearsal, and CI's log is kept out of
  the build context, so the rehearsal reuses them instead of rebuilding.
- **Nothing about one family in the image.** Sentry's DSN was a build argument that Next inlined
  into browser and server code; it's now `SENTRY_DSN`, read on the server at run time and handed
  to the browser on `<html data-sentry-dsn>`. The Dockerfile takes no build argument but the base
  image and carries only fixed labels. The container test builds with decoy Sentry settings in
  the environment (compose must forward nothing) and fails if any Sentry ingest address or a
  `NEXT_PUBLIC_` value is in the image; `lib/deploy-guard.test.ts` checks the Dockerfile,
  `.dockerignore`, compose files and workflows.
- **Deploy from the registry.** `docker-compose.prod.yml` names images only (pinned by
  `FAMILYOS_VERSION` in a one-line `.env` beside it; unset is an error), so a failed pull is an
  error, never a quiet local build under a release's name or a fallback to the latest. `docker-compose.build.yml` adds the build for CI, a Mac or a
  fallback, under a local tag.
- **A smaller image.** The break-glass state read used a path Turbopack couldn't know, so it
  traced the whole project into the standalone server (about 840 source and doc files). It now
  reads through `process.getBuiltinModule("node:fs/promises")`, and the standalone output keeps
  only what it needs.

## Phase 48 — Slim the migrate image

The migrate image was the whole `install` stage (2.26 GB) to run `prisma migrate deploy`. It is
now about 690 MB: a `migrate-deps` stage cuts `package.json` down to `prisma` and runs
`npm prune --offline --ignore-scripts` (then deletes the emptied scope folders), so what's left is a subset of the tree the lockfile
installed, with the schema engine `install` already fetched; the `migrate` stage starts from the
base image and copies in only that, `prisma.config.ts`, the schema and the migrations.

- **Why prune, not a second lockfile or a copy list:** two lockfiles drift, and a hand-made list
  of Prisma's packages breaks quietly on a release. `overrides` stays in the cut-down file, or npm
  would re-resolve and fail offline; `prisma` moves to `dependencies` so an `--omit=dev` from the
  environment can't prune it (review finding).
- **Prisma loads `prisma.config.ts` through jiti**, so the image needs no TypeScript. With a
  read-only root, jiti keeps its cache under the temp folder, which is why compose gives the
  migrate service a `/tmp` tmpfs.
  `CHECKPOINT_DISABLE=1` keeps Prisma's usage check-in from trying to leave the server.
- **Guards:** `scripts/container-test.sh` checks the migrate image's contents and that the CLI
  starts, prints both sizes and fails over a 1 GB budget; `lib/deploy-guard.test.ts` checks the
  two stages' shape.

## Phase 49 — The household's timezone everywhere

"Today", due dates and every printed date followed the server process's `TZ`, and Settings only
warned when it wasn't the household's. The owner's call: the server follows the household's zone.
One server serves one household, so `lib/household-zone.ts` sets `process.env.TZ` to the
household's zone (Node picks the change up at once for local getters, `toLocale…` and `Intl`
defaults), and about 140 date calculations became right without being touched.

- **When it's applied:** at start (`instrumentation.ts`, not during `next build`), in the app
  layout on every request (a string compare), on every background tick, after the zone is saved
  and after a restore. Only canonical names are set: an unknown one silently becomes UTC.
- **Stored days move with the zone** (the owner's call: they keep their date and clock time).
  `Household.dayZone` records the zone the days were written in; when it differs from the
  household's, `moveStoredDays` rewrites them in the same transaction that saves the zone,
  including once on the upgrade itself (setup already stored the device's zone while days
  followed the server's). Clearing the zone moves them back to the deploy's.
  Columns: chore and med start and due dates, vehicle log dates, school due dates typed in, and
  receipt-dated prices (exactly midnight). Instants never move.
- **Review findings that shaped it (Fable):** instances are generated on page loads, not only by
  jobs, so generation re-plans under a shared advisory lock when it has rows to write and a move
  holds it exclusively; task instances are unique per definition and time, checked row by row,
  so they're parked a thousand years out before moving (a 12-hour move of morning and evening
  doses would collide); two doses landing on one time (a skipped hour) keep the done one. The new
  values are worked out in JavaScript with the app's own zone data (`lib/zone-clock.ts`), not
  Postgres's `AT TIME ZONE`: Intl's canonical names include ones Postgres's zone list lacks
  (`Asia/Calcutta`, `Europe/Kiev`), and saving one would have failed every page after.
- **Restores** move a file's days from its `exportedTimeZone` (now the days' zone) to the
  restored household's instead of refusing, and the preview says so.
- **The browser:** client components format with the household's zone (`useHouseholdZone`), so
  they match the server's render. **Away from home** (the owner's call), a time of day shows home
  first and then the device's ("8:00 AM at home · 2:00 PM here") on dose cards, the calendar and
  events, with a note at the top of Home; the device's zone never leaves the browser.
- **Guards:** Vitest runs in `America/New_York`; `lib/household-zone-guard.test.ts` refuses a
  formatter or date made at module load (a vehicle's "newest model year" was one).

## Phase 50 — Teams without Power Automate

Teams alerts went through a Power Automate Workflows link one admin built by hand, and a jar's chat
was a pasted link. The owner's calls: the app's own Teams bot, a free-tier Azure Bot on the
family's existing app registration, an **Add to Teams** button, and the Workflows link removed.

- **Why a bot (researched):** Graph won't let an app post chat messages as itself (delegated only);
  activity feed notifications only link inside Teams, and phones show them only for apps on
  Microsoft's allow list. A notification-only bot is what the Flow bot was.
- **The package** (`lib/teams/manifest.ts`) is built from the family's settings: their app name,
  their color icon and a white-on-transparent outline (Teams refuses any other outline), at this
  install's own address. It's published only into the family's tenant, so it carries the
  family's name, like an alert email's subject. `webApplicationInfo` names the app registration;
  without it Graph won't list the app's installs. A changed name or icon publishes a new version.
  The zip is a small writer of our own (`lib/teams/zip.ts`), no new dependency.
- **Sending** (`lib/teams/family-app.ts`, `lib/teams/microsoft.ts`): the app installs itself for a
  grown-up (app-only, addressed by their Entra object id, never an email), reads its chat with
  them from the install and keeps it, and posts through Bot Connector's global address with a
  token from the same app registration. Nothing has to reach the app from outside, so Cloudflare
  Access is unchanged. When Teams says the chat is gone, it installs and reads it again and tries
  once more; a 401 gets a fresh token, a 429 one wait.
- **A jar's chat** is picked from the member's own group chats (delegated `Chat.ReadBasic`, asked
  for on that button). Because the app may add itself to any chat in the tenant, the server only
  takes a chat id from that member's list, read again when saving, and marks people from outside
  the tenant. The bot can't read the chat.
- **Review findings (Fable):** the scope review confirmed the pattern against Microsoft's docs and
  added `isNotificationOnly`, the outline icon rule, the object id instead of the email, the error
  handling and the pick-is-the-guard rule.
- **Departure from the scope:** Settings → Alerts shows a status line (in Teams, by whom, when,
  and whether the name or icon changed since) rather than a step-by-step checklist; whether the
  Azure Bot answers shows on the first **Send a test**.
- **Removed:** the Workflows link, its URL checks and the Sentry rule for its hosts. Bot Connector
  and the app's Graph install and chat calls are private to Sentry instead.

## Phase 51 — Find the school calendar from the school's website

Adding a school calendar meant finding its subscribe link on the school's site. Now an admin types
the school's website on School → Calendars and the app finds the calendars the site offers, tries
each, and lists the ones it can read with the next few events, ready to add.

- **What school sites do (researched; Fable measured real district sites):** no common format.
  Google Calendar embeds and WordPress sites expose a feed; Finalsite, the most common K-12
  platform, builds its Subscribe button with a script but names its calendars in
  `data-calendar-ids`, which map to `/fs/calendar-manager/events.ics?calendar_ids[]=…` on the same
  site (the owner's call: include that rule). Some platforms answer a plain fetch with a browser
  check. Expected: roughly half of schools.
- **The scanner** (`lib/school/feeds/find/scan.ts`) is one linear pass over the HTML: quoted and
  unquoted attributes, entities, relative and protocol-relative links, `<base href>`; Google ids
  plain, encoded or base64 (newer embeds); Outlook `.html` → `.ics`; addresses in `onclick` and
  inline scripts. No scripts run, no new dependency.
- **The finder** (`find/finder.ts`) reads the page and up to 3 calendar-looking pages on the same
  site (an approximation of the registrable domain, checked after redirects), tries at most 8
  candidates on any https host (calendars often live on Google, Outlook or an athletics site), 12
  fetches and 30 seconds in all. A 403/429/503, a browser-check page (by its title) or a page that's
  nothing but a "turn on JavaScript" notice is reported as a site that only opens in a full
  browser, not as "nothing found"; such a page is still scanned, and a feed on it still counts
  (Fable's implementation review: a captcha form or a noscript footer on a normal page isn't one).
- **Safety:** every fetch, page or feed, goes through the Phase 18.5 guard (now parameterised for
  HTML or iCalendar). Found addresses never reach the browser in the clear: the list goes back
  sealed (`find/bundle.ts`, bound to the admin, the household and 15 minutes), so nothing is kept
  in server memory. One search at a time per household, under a database lock.
- **The guided setup** has no school step, so its last step ("All set") points to the finder when
  School is on and no calendar is added yet (the owner chose a link from setup).

## Phase 52 — Statement imports that work out their own columns

A CSV statement only worked with a few exact header names. Now the app works the columns out and
shows its guess on 5 rows before anything is saved (the owner's call: every CSV, every time).

- **Reading** (`lib/finance/statement-columns.ts`): UTF-8, else Windows-1252, UTF-16 by its mark;
  comma, semicolon, tab or pipe, by which splits the first lines most consistently; the header is
  the first row followed by data (account details above it are skipped), or none.
- **Guessing, names first and contents second:** the common names for each role, then each
  column's share of cells that read as a date, as money (a decimal mark or a sign; bare digits
  never), or as varied words. Fable's scope review against real exports added the decoys: a
  running balance (by name, or steps matching another money column), reference and card numbers,
  category and status columns; the posting date over the transaction date (the reconciler matches
  the feed on it); a second text column as the memo.
- **Dates and signs:** ISO, compact, numeric in either order, month names; the order from the
  file's own dates, else the household's setting (`Household.statementDateOrder`, the owner's call:
  automatic is the location's standard, month first in the US, and admins can change it). Comma
  decimals are worked out before any amount is read. A Type column signs an all-positive amount
  column, only for words it knows. A card file (80% or more positive) gets a suggestion to turn it
  around, never an automatic flip.
- **Check, then import** (`lib/finance/statement-import.ts`): the page keeps the File and sends it
  with each step, since a form post clears a file field (a scope-review blocker); nothing is kept
  on the server in between. The confirmed choices are remembered per account by a hash of the
  file's layout and the reader's version.
- **Undo and folding:** each import is a `FinImport`; rows carry `importId`, and **Remove this
  import** deletes them (asked first). A row another import already brought under a different id
  (an OFX and a CSV of the same month) is folded in by day, amount and words. A changed choice
  still makes new ids (the hash includes the amount and day), which the undo covers.
- Row ids are the same as Phase 25's CSV reader, so a file imported before adds nothing now.

## Phase 53 — Smaller setup fixes

Four things that sent an admin to a manual or a terminal.

- **A car from its VIN.** `lib/vin.ts` (shared, so the backup restore may use it) checks the
  shape, and the check digit only for North American VINs (first character 1 to 5).
  `lib/vehicles/vpic.ts` decodes with NHTSA's vPIC (`DecodeVinValues`, no key, a 4 s timeout, ten
  minutes without trying after a failure, never cached since the VIN is in the address, which
  Sentry treats as private). `ErrorCode` is read as a list: "0" alone is clean, a make with other
  codes is partial (said in words), no make is unreadable. The scanner reads Code 39, Code 128,
  Data Matrix and QR with the Groceries decoder, and takes a VIN read the same twice in a row; the
  camera helpers moved to `components/camera.ts` (the domain-boundary rule). `Vehicle.vin` is in
  backups and the vehicle CSV. Cars is grown-ups only on the server already (`lib/apps.ts`), so
  the scope's note that the Garage is open to kids was wrong: no extra rule was needed. NHTSA has
  no API for open recalls by VIN, so the recall card copies the VIN and links to NHTSA's page,
  whatever the by-model list says.
- **Bank feed.** SimpleFIN's `errlist` (protocol 2.0) is read beside the older `errors`, codes in
  words (`errlistWords`): `con.auth` says to sign in again at SimpleFIN Bridge. **Leave out** an
  account (`lib/finance/left-out.ts`, the owner's answer 2): `FinAccount.leftOut` (on the account,
  not the connection, so backups carry it; Fable's review) makes the sync skip it, both before
  the sync and again inside each account's transaction, under that row's lock, for one left out
  mid-sync. It stops counting as spending money, and its ACTIVE rows become IGNORED, a state
  every total already leaves out. Activity alone asks for IGNORED rows too (`activityWhere`'s
  `leftOut`) and marks them; the spreadsheet doesn't. Net worth and the "not in US dollars" counts
  leave the account out. A statement can't be imported into it (its rows would count). Its
  orders and grocery trips stay linked (only DUPLICATE and SUPERSEDED rows let an order go).
  **Bring it back** turns IGNORED rows back to ACTIVE (only this feature makes IGNORED) and
  syncs; Safe to spend stays off until it's ticked again, which the question says. Logged in the
  jar's history (`ACCOUNT_LEFT_OUT`). The connect card is three numbered steps with a link to
  SimpleFIN Bridge.
- **The alert mailbox in Settings** (the owner's answer 3): `Household.alertMailbox` wins,
  `ALERT_MAILBOX` is the fallback (`pickAlertMailbox`), and the page says so once. Set by an admin
  on their own sign-in, logged as a sign-in event (`ALERT_MAILBOX_SET`, Recent changes). Kept out
  of household backups: it's install wiring, like the env value, and a restore onto another
  tenant shouldn't send from the old mailbox. sendMail failures are told apart by Graph's error
  code (`MailError`): no mailbox, not ready yet, sign-in, Exchange access; setup problems aren't
  reported to Sentry. The page shows the Exchange PowerShell filled in (`lib/microsoft-admin.ts`;
  only GUIDs and a plain address go into it).
- **Entra link.** The Entra check keeps the app's enterprise app object id
  (`EntraCheck.servicePrincipalId`, a GUID only, written each run) so Settings → Sign-in links to
  the app's Users and groups page without calling Graph to draw it.

## Phase 56 — Tap the egg open, drag things around the room

The owner's call (2026-10-24): waiting five minutes for an egg was boring, and the Room panel's
lists didn't feel like decorating. Same rules as Phase 47 and 54.

- **Tap to hatch.** Five taps crack the egg open (`EGG_TAPS`), a little more of the crack drawn
  each time, with a wobble, shell crumbs and a line per tap. The screen counts the taps; the last
  one calls `crackEggOpen`, which hatches it on the server (`hatchNow` in `lib/pet/sim.ts`, the
  same step the clock uses) and the page comes back with the baby and its hatching reveal. The
  egg is a real button there, so Enter or Space taps it too. An egg left alone still hatches on
  its own after five minutes, so one picked at bedtime is a baby by morning. Skipping the taps
  by calling the action directly only skips four taps.
- **Surfaces, not slots.** The room's five one-thing slots became four surfaces (wall, shelf,
  windowsill, floor) that hold as many decorations as fit, each at its own spot (`PetItem.x`,
  and `y` for how far forward on the floor). `lib/pet/room.ts` says where each surface is, keeps
  the whole of a decoration on it (`standOn`), and picks where a drop lands: the nearest surface
  the item fits (`dropAt`), so a poster dropped on the floor still goes up on the wall. The
  migration turns the two floor slots into spots on the floor where they stood, and
  `readPlace` does the same for a backup from before. Backups carry the spot.
- **Drag and drop** (`use-room-drag.ts`). With **Room** open, decorations are dragged from the
  panel into the room and slid around in it; the surfaces they fit light up, and the decoration
  shows where it will land before it's let go. Dragged out of the room, it goes back in the toy
  box. Toys and hats can be dragged in too (out on the floor, worn). A move shows straight away
  (`useOptimistic`) and the saved page follows. A press that barely moves isn't a drag, and the
  click after a drag is swallowed, so taps still work. Without a pointer: each decoration's
  **Where** list, and in the room the arrow keys slide a focused decoration (up and down on the
  floor) and Delete puts it away.

## Phase 56.1 — Tighter hitboxes for decorating

The owner's call (2026-10-24), after "the hitboxes seem a bit off". Measured against the
drawings, the boxes were the right size; four other things made picking up feel off, all fixed:

- **What's drawn takes the press.** While decorating, the room's SVG decorations take the
  pointer themselves (`pointer-events: visiblePainted`), so empty space beside a plant's leaves
  or inside the fairy lights' band no longer picks anything up. The rectangles over them had
  been stacked in the order the items were found, not drawing order, so where two overlapped
  the one behind could be picked up; now what's drawn in front wins.
- **A band for small fingers.** Under every decoration, a copy drawn with a 20 screen-pixel
  stroke (`.pet-hit`, `vector-effect: non-scaling-stroke`) catches near misses, so a lamp or
  fishbowl (about 25px across on a phone) is about 45px to press. The bands sit under all the
  drawings, so they only take presses nothing drawn takes. Faintly visible, which also says
  "you can move these".
- **Held where it's held.** A drag keeps the gap between the pointer and where the decoration
  stands (`Grab` in `use-room-drag.ts`), so it no longer jumps to put its base under the
  pointer; one from the toy box is held by its middle (`heldByMiddle`), as its picture is.
- **Inside the border.** Drag positions are measured inside the room's 2px border, where the
  drawing is.

- **Night and mess don't get in the way.** The asleep room's dark layer, the lamp's glow and
  poop are drawn over the decorations; they no longer take a press, so decorating works after
  bedtime too. CI caught this, running after the pet's bedtime. A press that starts a drag also
  doesn't move focus or start selecting text.

The rectangles stay, for the keyboard and screen readers only. The browser test now drags a
plant from the toy box onto the shelf and, by the plant itself, down onto the floor; it passes
by day and by night (`TZ=UTC` puts its room after bedtime).

## Phase 57 — Dropdowns that look like the app

The app's 51 plain `<select>`s had the operating system's look. The owner chose the mixed approach
(2026-10-29): styled native dropdowns everywhere, the browser's styled list where it has one, and a
custom picker only for long lists (57.3).

- **57.1, one rule for every dropdown** (`app/globals.css`, `select:not([multiple], [size])`):
  `appearance: none`, the app's arrow drawn as two gradient halves in the muted text colour (a
  mask would clip the whole control; a select can't have `::before`/`::after`), room for it on the
  right, and a dimmed disabled look. It's unlayered, like the phone 16px rule, because Tailwind's
  utilities beat the base layer and `field`'s `px-3` would put the text under the arrow. So no
  class can undo the look; a list box (`multiple`, `size`) keeps the native one, and
  `lib/select-guard.test.ts` makes any new list box get listed with a reason.
- **57.2, the styled open list** inside `@supports (appearance: base-select)` and
  `@media (pointer: fine)`: the list as the app's card, the chosen option bold with a tick in
  `--brand-text`, the browser's `::picker-icon` in place of 57.1's arrow (turning when open,
  still under reduced motion). Chrome and Edge 135+ today; elsewhere the native list. Phones and
  iPads (which report a coarse pointer even with a trackpad) keep their own pickers.
- **Base-select's differences, handled (Fable's review):** it lays the box out as a flex row, so
  the rule keeps `inline-flex` (a `block` class would push the icon onto its own line); the
  chosen label stays on one line and clips instead of wrapping; a disabled select isn't dimmed
  twice (the browser already halves its text); the hovered and keyboard-focused rows get a
  visible tint and a ring. The box is sized to the chosen option, not the widest, so the four
  short dropdowns in a flex row (a grocery item's unit and container, the pet's care hours) have
  a min width. Focus moves onto the options while the list is open, so the grocery sheet's
  Escape handler ignores anything inside a select, not only the select itself.
- The browser test opens a list in both themes, runs axe on it, and checks a phone (Playwright's
  Pixel 7 device) gets the plain styled box, not the styled list. `E2E_SHOTS=<folder>` saves its
  screenshots for a person to look at.
- **57.3, the searchable picker** (`components/picker.tsx`, its logic in `lib/picker.ts`), for the
  owner's four lists: the household time zone (each zone with its offset now, worked out in the
  browser after load so the server's render matches), a receipt line's item ("On this trip",
  then the rest of the pantry), Merge into, and a charge's category (with its emoji). An ARIA 1.2
  combobox modelled on the grocery add box (which doesn't change): typing filters (case,
  accents and `_`/`/` ignored, every word must match, a label starting with the query first),
  arrows and Home/End move, Enter picks, Escape closes the list only (inside a sheet or dialog
  the sheet stays open), and it must end on an option. At most 50 rows are drawn, then "keep
  typing". Controlled (`value`/`onChange`) or in a form (`name`, `defaultValue`): a hidden input
  carries the value, `required` is enforced with `setCustomValidity` on the text box (a hidden
  input ignores it), and it returns to `defaultValue` on its form's `reset` (React resets a form
  after its action). The people and contact lists are next in line once Google Contacts sync
  makes them long.
- **Fable's review of 57.3, folded in:** focus keeps the choice in the box (selected, so typing
  replaces it) and the list always shows and highlights it, even past the 50-row cap (with no
  choice nothing is highlighted, so Enter only closes the list); result counts and "nothing
  matches" are announced in a polite live region, and the visible messages sit outside the
  listbox; the list opens upward when there's no room below (inside a sheet it would otherwise
  open into the sheet's scroll space) and keeps the highlighted row in view by scrolling itself,
  never the sheet; the listbox is named by the field's label; the receipt's list of lines no
  longer clips each line's picker (`overflow-hidden` removed). The browser test now also opens a
  charge's category inside its sheet (a native dialog) and checks Escape closes only the list.

## The mascot's art (2026-10-25)

The default mascot is a black and white dwarf rabbit drawn with PixelLab (a 64px character, from
a reference photo the owner chose), on the same 136px canvases as before, every pose's feet on
row 95.

- **Addresses carry a version.** The sprites are cached for a day and served stale for a week
  (`next.config.ts`), and their names never change, so every address comes from `mascotArt()`
  (`lib/bunson-art.ts`), which adds `?v=N`. Bump `MASCOT_ART_VERSION` whenever any file in
  `public/mascot` changes, or browsers keep the old look, even mixing old and new frames.
  `lib/bunson-art.test.ts` checks every named frame exists.
- **The chase hop** (`lib/bunson-loco.ts`, `bunson-loco-0..15`) is one side-on bunny hop drawn in
  place, starting and ending on the same crouch so hops chain. He moves only while airborne,
  gets a small arc on longer hops, and a ground shadow shrinks with his height (the art's own
  lift per frame is measured in `LOCO_FRAME_LIFT_PX`). Reversing turns him through a
  three-quarter view (`bunson-turn`); arriving, he sits side-on for a moment before facing you.
- **Life while sitting** (`lib/bunson-idle.ts`, `bunson-life-0..7`): an ear flick and head tilt
  every 4 to 8 seconds, only while he's sitting facing you, never under reduced motion.
- **Periscoping** (`lib/bunson-rise.ts`, `bunson-rise-0..8`, frame 0 being his sitting pose):
  speaking plays the rise in the 300 ms the old cross-fade took, looks around while the bubble
  shows, and sits back down in reverse. The character's own canvas had no room to stand, so
  this clip was animated from his sitting frame on a taller canvas.
- **His face** was redrawn by hand on every frame (small dark eyes with a sparkle, his pink
  nose, a soft blush): the generated eyes had a red glint that read as staring. New frames
  need the same treatment.

## Dev sign-in (temporary, remove before shipping)

`lib/dev-auth.ts` adds `POST /api/auth/dev/sign-in` for `dev-tester@familyos.test`, only with
`NODE_ENV=development` and `DEV_AUTH=1`, on localhost. The real boundary is that `npm run dev`
listens on 127.0.0.1 and `dev:lan` turns it off; `lib/auth.ts` refuses to start in production
with `DEV_AUTH` set (check builds with `DEV_AUTH= npm run build`). Everything is marked
`DEV-ONLY`.

## Data model notes

- `Person` is the universal entity: members and contacts (`isHouseholdMember`, a role, optional
  `authUserId` and `pinHash`).
- Better Auth owns its tables through the Prisma adapter; don't hand-edit them.
- Every domain table carries `householdId`, even with one household.

## Deviations worth knowing

- **Phase 4.5:** the role lock applies to anyone with a sign-in link; the points tally excludes
  ledger rows without an instance; `idToken` isn't covered by token encryption.
- **Phase 5:** `planInstances` takes `today`; deactivating a definition clears future PENDING
  instances.
- **Phase 6:** a no-date service log defaults to local midnight so "latest" and undo stay correct;
  undo doesn't revert an odometer bump (no pre-bump reading is stored), and the button says so.

## Phase 58 — Looks

A look belongs to a person and changes type, shape, art, motion and a little of the app's voice,
not only color. Scope in `docs/PLAN.md`.

### 58.1a — Everything a look changes became a variable

Sticker Book looks as it did. `ink`, `sun`, `paper`, the sticker colors and the three type faces
were fixed when Tailwind built; they now go through `--ink`, `--face-heading` and so on, on `:root`,
so a look can override them on `[data-app-root]`. `--on-brand`, `--on-chrome` and `--on-ink` replace
`text-white` on main buttons, the bar and ink panels. Code reads `var(--ink)`, never
`var(--color-ink)`, which would resolve once on `:root`; `lib/look-tokens-guard.test.ts` holds these
rules. Red, green and amber status colors were left alone (the scope's plan to tokenize them was
dropped once measured): they already have day and night shades, and every look has both.

### 58.1b — Names for a look's CSS to grab

`components/styles.ts` strings gain `ui-card`, `ui-btn`, `ui-chip`, `ui-field` and friends, which
style nothing themselves. Pages that spell out their own card or main button add the same name
rather than moving to the shared string as first scoped: their spacing differs, and moving them
would have shifted Sticker Book. `lib/look-tokens-guard.test.ts` checks new ones.

### 58.2 — A look per person, tried on over the real page

`Person.look`, `lookColor` and `lookPromptSeenAt`; `lib/looks.ts` lists the looks and their colors.
`AppRoot` (`components/look.tsx`) replaces the shell's root `div`: the server says what's worn, so
there's no flash and a shared tablet changes with the person, and trying one on is client state over
that. The sheet (`components/look-sheet.tsx`) is reached from the name menu and Settings and opens
over the page you're on, dropping the scope's hop to Home: that's the page you wanted to see. Only
Keep it saves. Sticker Book's eight colors are the first choices, with `null` following the family's
color. The welcome and the setup step wait for `LOOKS_TO_CHOOSE`, a second look. The browser's bar
color now reads `--chrome` from the root, and stays owned in the shell in every mode.
Waiting for the first look to need them (58.3): per-look CSS and its offline handling, and the demo
family's mix of looks; the contrast test here already runs over whatever `lib/looks.ts` lists.

### 58.3 — Neo-brutal, the first look

Tokens, type and shell in `app/looks/brut.css`, art in `public/looks/`, four colors. The real Home
has no banner (the mascot greets), so `components/look-scene.tsx` adds one for looks that want it.
With a second look to choose from, the setup step and the once-only welcome turned on.

All looks share one stylesheet rather than the scope's per-look files, once measured: selectors keep
them inert and browsers fetch a look's art and fonts only when used, so wearers pay for theirs, there's
no flash, try-on is instant and offline needs nothing new. `public/sw.js` caps saved fonts.

### 58.4 — Goth

A cathedral on Home by day (a woodcut on parchment) and by night (candlelit, with embers), framed
Home cards with a skull crest, coffin-shaped main buttons, four colors. Blackletter is for titles;
Big buttons swaps it for a plainer gothic, and a focused button squares off so its ring shows.

### 58.5 — Synthwave

A road, sun, palms and a wedge car on Home; a chrome script logo; a neon grid under every page;
slanted buttons; four colors. Night is neon on violet, day a sunset.

### 58.6 — Kawaii

A speech bubble with a bobbing cat on Home, die-cut stickers and washi tape on its cards, a scalloped
bar and pill nav, four colors. Home's cards tilt; lists and forms stay straight.

### 58.7 — Acanthus

A gilded bookplate with an engraved library on Home, on Morris-style wallpaper; a ribbon of the
wallpaper under the bar elsewhere, since other pages have words right on the page; a Roman-numeral
index for the nav; four colors.

### 58.8 — Vaporwave

Cards are windows with title bars, the nav is desktop icons, a marble bust and chrome sphere watch
over Home, four colors that also change the desktop. Windows are silver by day and dark at night,
unlike the prototype's silver in both, so status colors' day and night shades stay right. The real
top bar stays at the top (search, bell and name open downward), so there's no fake taskbar.

### 58.9 — The moment you finish something

Finishing a chore, taking a med or finishing a grocery trip gets the look's own mark: "DONE." slammed
on, a wax seal, a self-closing dialog. It lives on `AppRoot` because the finished card leaves the page
at once, and fires once the save worked. Decorative, takes no taps, ends itself, and just shows and
goes under reduced motion. It plays alongside the card's existing burst and the mascot, in every look;
Sticker Book has only those. No sound, the owner's call for now.

### 58.10 — Close

`scripts/looks-art.cjs` keeps the generator for the looks' art (not run by the build; its output is
compressed to WebP in `public/looks/`). The prototype's CSS is gone. Each look's browser test wears it
on seven pages in day and night and on a phone, with `axe`. Contrast over art can't be measured by
`axe`, so scenes are checked by eye in `E2E_SHOTS` screenshots.

First shipped with a narrower voice than scoped; see "Looks: voice" below. Kana kickers weren't built.

### Fonts from npm, after Phase 58

A build used to download every look's fonts from Google. `subsets: ["latin"]` only chooses what's
preloaded, so that meant 674 files, and a failed download could fail a build, which CI saw once.
`app/fonts.ts` now loads the same families with `next/font/local` from exactly pinned Fontsource
packages: 56 files and 1.5MB instead of 11MB, no Google at build, and the same fonts from the same
commit. Browsers never contacted Google, before or after. Latin Extended sits behind a unicode-range,
fetched only for a name that needs it; other alphabets, kana included, now use the device's font.
Nothing in the app uses kana today, so add those files if kana kickers get built. The fonts' OFL
notices ship in `public/licenses/fonts.txt`. To change a package, update that file too;
`lib/fonts-guard.test.ts` checks the license, the pin and that each file exists.

### Looks: checked in every color

Each look's browser test now runs `axe` on its other colors too, on Home and Chores, day and night,
and a test finishes a med and a shopping trip with a look on. Looking at those screenshots found what
`axe` can't: Kawaii's night tape read as caution tape, hatching behind Acanthus's house ended in a
hard box, and Vaporwave's palm showed only as fragments between windows, so it moved up beside the
bust. Goth's greeting no longer says "morrow" in the evening.

### Looks: voice

The rest of the scoped voice: a line above each app's page title, one under each Home card's title,
and one beside "Nothing due today." on Chores and Meds. They're in each look's `voice` in
`lib/looks.ts`, decoration beside the app's plain words: hidden from screen readers and in Big
buttons, and on an app's own page only, not deeper. Sticker Book has none. `lib/looks.test.ts` checks
every look has every line, and that a new app can't be left without one.

### Looks: review with full data

Two Fable reviews and every look on full demo data, phones included. Fixed: under reduced motion the
moment vanished at once (the global rule shortened its timer to nothing); Goth's error text and the
bell's badge failed contrast; the launcher's focus ring disappeared on Neo-brutal Banana; Vaporwave's
picked chip barely differed at night; Goth and Synthwave's `h2` sizes reached dialogs and sections,
so they're now Home only; small button and bar text no longer overrides Big buttons; Goth's Home
frames take less room on phones; Kawaii's name fits a phone; Neo-brutal's ticker no longer names apps
the family may have turned off; a stored color that's gone follows the family's; a trip another device
already finished gets no moment. The offline Shop copy now keeps all the fonts, about 1.5MB.

Tests added: error text and badge contrast in every look, the moment still showing after 300ms, the
name fitting a phone, and a form page. Accepted: opening the setup step marks the look prompt seen (a
write on a page load, but it only ever goes from unset to set). Not checked: a Big buttons pass per
look in the browser, and Windows high contrast.

### Forced colors and Big buttons, after Phase 58

Under forced colors (Windows contrast themes) `app/looks/shared.css` removes every look's background and
border art, gives buttons, chips and cards a real edge, and marks selected items with a Highlight
outline, since a fill or ring is what forced colors drop. Pet games' gradients stay (they are the
game). In Big buttons, Neo-brutal's phone bar uses its body face in normal case, because its wide
capitals ran together at Big's size. The look's browser test checks both.

### Usability pass, batch 1: words and reading

One word per action: **Done** for chores, **Taken** for doses, **Add** to create, **Save** to edit,
**Turn off/on** for what used to be Deactivate. Long paragraphs stop at 70 characters (`globals.css`).
The hand font is for large, decorative text, not data: its 1 reads as an I. Safe to spend's headline
rounds down (`roundEstimateCents`), while its workings keep the cents. On touch screens the corner mascot steps aside while the page
scrolls and whenever he'd sit on something tappable (`lib/bunson-cover.ts`).

### Usability pass, batch 2: Home and lists

Home leads with one **Today** card. It's above the grid, so it doesn't disturb the looks' nth-child
rhythm, and it opts out of their tilts and corner stickers. Outlook events stay in their own card:
they're streamed and cover the week. A finished item moves into the fold when the page refreshes;
that jump is accepted, including keyboard focus returning to the page's start. Skipped items leave Home. Each row and page shows one main action: the rest are behind `MoreMenu`, a native popover
(none on a browser too old to have one, so they lose those actions until updated). `PageMore` never
puts a single item behind a ⋯. Upcoming lists are folded, except someone's own short list in Big buttons on Chores; Chrome opens a fold
for find-in-page, Safari doesn't.

### Usability pass, batch 3: forms

New chore, medication and person forms start in their first field, with less-used fields under **More options** (`MoreOptions`), which is open
on edits and after an error. Nothing in it may be `required`: the browser can't point at a hidden
field, so the server checks the start date instead. Contacts have no type, so Prescriber and Pharmacy
list those already used in that role first. Pantry has one box: typing narrows the list, and a new name
offers **+ Add**. Enter searches; it no longer adds.

### Usability pass, batch 4: Calendar and Money

A week's rows carry their person's color, with filter chips as the legend, matched by first name, so two members sharing one share a color. Chips are for grown-ups: a kid's calendar is already their own. A
day's doses share one row. `?view=month` shows six weeks of what's happening; chores and doses stay on the
weeks, which also stops a month planning far ahead. Money: accounts are a compact list, categories one
select, and all-capitals bank names read as a person would write them (`tidyMerchantName`, display only).
Weekly and variable shops (the grocery run, a monthly Costco trip) keep counting in Safe to spend
(the owner's call): the figure stays cautious, and **Not a bill** takes out any one store. The card says so.

### Layout on every screen

Every page is centered, the same in every look and on any screen (the owner's call: uniform, never
pushed into a corner). The default, 72rem, is one rule in `app/globals.css` on
`main`'s child, in `@layer base` so a page's own `max-w-*` still wins. Settings' and Data's quiet
wrapper (`data-quiet`) stays full width and its page is centered inside it. Home, Calendar and a
person's page use 90rem. New and edit forms use `max-w-2xl`, with the form filling it. Narrower pages
already centered (Money, Store, Pet) keep their widths. The 70ch reading width had been catching
Home's banner, a `<p>`, so it's excluded. Synthwave's road stops growing past 42rem so it stays
under the words. Home's cards fit their content. Finish trip is a bar across the list, sticky on
every screen. The browser test checks the banner's width and that pages are centered on a 2200px screen.
Still placed against the screen rather than the page: the search box, the mascot and the
celebration toast.

A page whose content is narrower than 72rem takes that width itself (`max-w-2xl` to `max-w-5xl`), so its
header lines up with what's under it instead of the content sitting at the frame's left: School,
School calendars, Outlook calendars, Data, Garage supplies and Make it yours. Household's two small
forms sit side by side on a wide screen. A reward out of reach in the Store gets a dashed edge and a
faded picture rather than a faded card, whose words and grown-up's Buy were hard to read. By day the
red of Remove is darker in every look, to pass 4.5:1 on cream cards, the muted floor and the pink
panel a tapped Remove opens; the look test measures it, which found Vaporwave's bright blues needed
a lighter red at night.

### Whose row on Chores and Meds

The points pills and the person filter were two rows of the same people, and the pills overlapped
so every picture after the first was hidden. They're one row now (`PersonFilterRow`): Everyone,
then each member's picture, short name and total; tapping one filters the board as before. Chips
keep the members' order so nothing moves under a finger, and the leader's picture bobs. Names come
from `shortNames` in `lib/people.ts` (the owner's call): the first name alone, and where two people
share it, letters of the last name until they part ("Max P.", then "Max Pa.").

## Phase 59 — Quick status work

### 59.1a — One status language

`lib/work-items` turns a chore, a piece of homework or a school form into one `WorkItem`: the
shared words (Due today, Overdue, To do, Done, Turned in, Graded 18/20, Skipped, Missed, Missing),
a tone, and what the viewer may change it to. Adapters run on the server and work out the pill for
every status the item can reach, so the browser switches looks optimistically without deciding a
day in its own zone. `StatusPill` draws it, as a label or, with options, a `MoreMenu` whose face is
the pill. Who-may-do-what moved out of the actions into `lib/school/permissions.ts` and
`lib/tasks/permissions.ts`, which the actions, the chore card and the adapters all call. School's
rows are client components now (`school/rows.tsx`): the tick box and the pill change status at
once and put it back if the save fails; Edit and Remove sit under ⋯, and Remove opens
`ConfirmAction` already asking (`initiallyAsking`), in the row, because `MoreMenu` closes on any tap
inside it; Cancel hands focus back to the ⋯ (`triggerRef`). Chores' cards show the pill outside Big
buttons, in the action cluster, and Skip moves from the ⋯ into it; Meds and Home pass none, so their
⋯ keeps Skip. The pill's menu waits while a change is saving, so Undo can't run before the
completion it undoes. `isAdult` moved to `lib/roles.ts` (re-exported by `lib/authz.ts`), so these
pure modules never pull Prisma into a client bundle.

### 59.1b — Homework, tests, quizzes and projects

`SchoolAssignment.kind` (`AssignmentKind`, default `HOMEWORK`, so every existing row is homework). The
add and edit forms have a Type select; School's rows tag tests, quizzes and projects (homework, the
usual, carries no tag); the homework card's heading counts tests and quizzes still to sit from today
through the next six days. The export gains a Type column. The backup carries it without a format
version bump: `kind` defaults to homework, so a file from before it restores as it always did.

### 59.1c — A history of changes

`WorkItemEvent`: one table for chores, schoolwork and forms, keyed by `itemType` and `itemId` (no
foreign key, since it points into three tables). `recordEvent` writes inside the transaction of
the change it records: done, undo, skip, unskip, give to, mark older missed; an assignment's
status, edits, grade; a form's done and reopen. Values are a stored status ("DONE") or display text
(first names, YYYY-MM-DD), capped at 200 characters, and a note only ever says it changed. Deletes
clean up in code: turning a chore off, removing homework or a form, the zone move's dropped
duplicates (raw SQL), the restore wipe and the demo seed; `lib/work-items/events-guard.test.ts`
finds every delete of those tables in `app/`, `lib/` and `prisma/` and fails on one without
cleanup nearby (Meds' doses are listed: they have no history). Reassigning now pins the assignee
it read, so a give-to racing another records the right "from". The backup is v9: events follow
their items through restore's new ids (school tasks and assignments gained id maps for it); one
whose item isn't in the file is dropped, and an actor who isn't becomes nobody.
Fable's review of 59.1c: an assignment's status change is pinned to the status it checked, and
ticking off done work again writes nothing (so `doneAt` keeps when it was finished, as forms
already did). The full edit only saves over the row it read (`updatedAt`); an edit that landed in
between gets "Someone changed this one just now", so the history's "from" is always true. The
restore preview lists the history it removes and restores.

### 59.2a — School, changed in place

Tapping a homework row's words opens `AssignmentDetailsForm` in the row (title, class, type, due
date; `setAssignmentDetails`), and the ⋯ has Grade it (`GradeForm`, `gradeAssignment`). Both save
only over the row they read (`updatedAt`) and record what changed. A kid may change their own work
that isn't missing or graded (`canEditAssignmentDetails`, the owner's call): it applies at once and
sets `SchoolAssignment.kidChangedAt`; grown-ups see "Changed by …" with Approve (clears it) and Put
back (`putBackValues`: each field's value from before the kid's first change since the last
review, read from the history). A grown-up's own edit or grade clears it with an APPROVE event.
Forms get `updateTask` (the add form reused in the row, with defaults) and `claimTask` ("I've got
it"), both recorded. `kidChangedAt` rides in the backup (defaulting to null for older files).
Fable's review of 59.2a: Approve and Put back act only on the change the grown-up saw (the page
sends its `kidChangedAt`, and Put back also pins `updatedAt`), and refuse with "refresh" if the kid
changed it again. History reads break ties by id, since one save's events share a moment. Put back
asks first, never clears a due date from an unreadable value, and closing an inline edit hands
focus back to what opened it. The owner's calls, made in the build and open to change: grading To do
work marks it done, and Done recently opens when it holds a change to check. The words a kid or
grown-up can tap get a dotted line and a pencil, so the edit isn't found only by hovering.

### 59.2b — Moving a chore

`lib/tasks/move.ts`: Move to tomorrow (due today or overdue), Move to today (overdue), Move back,
grown-ups only, never a daily chore, and only onto a day that chore has no instance on (one a day,
`@@unique([definitionId, dueDate])`). `moveChoices` decides what the ⋯ offers from the days the
board's chores already have today and tomorrow; `moveChore` checks it all again under the
stored-days lock and records a MOVE. `TaskInstance.movedFrom` keeps the original day (a second
move keeps the first; Move back clears it): `planInstances` treats it as taken, or a chore moved
off today would be made again; it moves with the zone (`DAY_COLUMNS`, a plain shift, and the
zone move's counts now add up per table); backups carry it. Turning a chore off still deletes its
pending days, a moved one included.
Fable's review of 59.2b: a refused move (the day taken meanwhile, the chore changed) says so on
the card and refreshes the board; the page also checks the day a moved chore would go back to.
Move back is offered only while that day is inside the overdue window, so it can't drop a chore into
"older, never marked" (a call made in the build, open to change). Known: a round-robin chore moved
past the next one's day can give the next turn to the same person once, since "most recent" is by
due day; it corrects itself the turn after.

### 59.3 — Pick several, act once

The chore and school actions' rules moved into cores that take a transaction and say why they
refused instead of throwing (`lib/tasks/chore-cores.ts`, `lib/school/cores.ts`, and `moveChoreIn` in
`lib/tasks/move.ts`); the single actions and the bulk ones (`bulkChores`, `bulkSchool`) both call
them, so a tap and a bulk change can't differ. Bulk input is checked in `lib/work-items/bulk.ts`
(1 to 30 ids, no repeats, a known action); everything runs in one transaction (Chores' under the
stored-days lock, for Move to tomorrow), and the result counts what was done and why the rest was
skipped. On a bulk Done each completion's milestone is counted inside the transaction, and the
highest is celebrated once. `components/selection.tsx` holds the page's selection (a provider keyed
by the person or student, so it resets), the Select toggle, the rows' tick boxes and the sticky bar.
The presets are the bulk action with a list the page works out: Sick day (asks first) and Hand off.
Grown-ups only, never in Big buttons.
Fable's review of 59.3: a kid on a sibling's homework hears "not found" again, as before the cores;
a form from elsewhere counts as gone, not "already that way"; a hand-off of a chore that's already
theirs is counted as skipped. A rule's refusal is counted, but a database error fails the whole
batch and nothing is kept; bulk transactions get 15 seconds (`BULK_TIMEOUT_MS`). The presets' lists
are `lib/tasks/presets.ts`, tested. While selecting, each row's and card's own buttons step aside, so
a stray tap can't finish something mid-selection. `bulk.ts` no longer imports zod (the check is
`bulk-schema.ts`), so the client bar doesn't ship it.

### 59.4a — Everyone, the list view and the side panel

`?kid=all` on School (grown-ups, more than one student) is `school/everyone.tsx`: every open
assignment and form (`getEveryoneOpen`), each homework row saying whose it is. Both views build their
rows from `school/row-items.tsx`, so they offer the same quick changes. Chores gets `BoardView`: Cards or
List, per person on the device (`useSyncExternalStore`, cards on the server so hydration agrees); the
list row (`ItemListRow`) is the shared pill (`ItemStatus`, through `setWorkItemStatus`, which only
picks the domain's own action), the title, who, when and stickers. Filter chips are links that keep
the page's other params: Chores' Overdue, Today, Mine (`person=<self>`), Anyone's
(`person=anyone`, `getBoardInstances`' `unassignedOnly`); School's Overdue, This week, Tests, Missing
(`matchesShow`). `?item=TYPE:id` opens the side panel (`item-panel.tsx`, `lib/work-items/panel.ts`):
the pill, a few facts, the row's own edit forms, and the history in words (`describeEvent`), shown
only to whoever can see the item. Escape or the close link drops the param. School's homework stays a
list of rows, so its Cards / List switch wasn't built; the panel opens from Details & history.
Fable's review of 59.4a: a selection resets with the filter too (its provider's key includes it),
so a bulk action can't reach rows no longer shown. The panel offers Skip as the board does (today
and overdue, not what's to come) and shows a chore's notes to grown-ups only, since the card never
showed them. A form's owner change reads "handed it to Mom", not a chore's "gave it to". The list's
and panel's pill report a milestone; Escape with a menu open closes the menu first; closing the
panel replaces its history entry, so Back doesn't reopen it; history times use the household's
zone; filtered boards say when nothing matches; Anyone's isn't shown alongside Everyone; a
bookmarked Anyone's in Big buttons is no filter; Everyone has Export like a student's page.

### 59.4b — People

The People list shows badges for household members (`lib/work-items/badges.ts`): overdue by each
board's own rule (chores inside the overdue window, homework unbounded), missing, and the soonest
test or quiz this week; one grouped chores query and one assignments read, only for apps that are
on, a kid's own only. A person's record replaces the chores summary with **Open items**: their
chores for seven days, their open homework (`personOpenSchoolwork`, for whoever can see it) and the
forms they're handling (grown-ups), as list rows with pills and the side panel (`?item=`); the
meds summary and the links to the boards stay. `lib/work-items` is the shared layer across Chores and
School, outside the eslint domain zones like Home, so People reads schoolwork through it.
Fable's review of 59.4b: the record page handed the whole person row to the homework rows, which
would have shipped their notes and contacts to the browser; the adapters now build `who` from the
id and first name alone, whatever they're given, and a test checks the keys. Big buttons keeps the
person page's plain summary (no rows, menus or panel). A kid sees a brother's or sister's chores as
plain text, not a link to a panel they can't open. A paused app's items don't open in the panel.
`lib/work-items` joins `FINANCE_AGGREGATOR_GUARD` in eslint, like Home: it can never read the money
jars. Badges are read only when a household member is on the list, and named in the household's zone.

## Phase 60 — The fix-it batch

Small corrections from the review of 2026-11-07. **Money:** a pending feed row the feed stopped
reporting is superseded when it's older than 14 days (`STALE_PENDING_DAYS`), wherever the sync
window starts, except when the feed sent no rows at all for the account (an account error, where a
wrong mark would stick). `paidCheck` spends a shared charge (a check, or one from nothing regular):
one bill takes it, the nearest in amount still unused, while a bill's own merchant pays it as
before; answers are remembered per bill and due day, so the bills page asking twice gets one answer.
A refund nothing else would file goes where the merchant's latest charge went (`refundCategories`
in `lib/finance/organize.ts`, any source, never keyless rows), as AUTO, so re-filing the charge moves
it. Keywords: `max` only as a whole key or "hbo max", gas stations rather than any "gas", natural
gas to Bills, health insurance and healthcare to Health. **Meds:** `canTakeYet` refuses a dose
before its day, and Upcoming's cards pass `notYet` so they offer no Taken. **Cars:** a never-logged
item is `UNKNOWN` ("Not logged yet") instead of OVERDUE, so a new car's starter items aren't red
and Home's overdue list stays true. **Alerts:** the bell marks read only what it showed (`markRead`,
the recipient's own) and keeps counting the rest; the Notifications page marks what it showed from
a client effect, not during render. **People:** search needs every word to match a name, email or
phone; school contacts join prescribers and pharmacies off "Haven't talked in a while", and a
check-in of 0 means never. **Calendar:** chips, colours and `?who=` go by person id
(`AgendaItem.whoId`), with short names when first names clash. **School:** a fee's amount uses
`parseMoneyInput`, with the old $100,000 cap.
Fable's review of 60: "UNITEDHEALTHCARE" as one word is Health too; a fee over the cap says so
instead of asking for "12.50"; the Notifications page and its mark-read action share one page size.
Accepted: on the bills page, Coming up and Safe to spend each ask their own `paidCheck` (the
forecast asks found bills first), so in a rare month a check a found bill took can show a hand-added
bill paid in one and due in the other; and a refund follows a re-guessed charge one sync later.

## Phase 61 — The server safety net

### 61a — Jobs that can't take each other down, and System

`lib/background.ts` runs each job (zone, money, purges, Entra, cleanup) in its own try/catch
(`runTick`), so a bank feed that's down no longer skips the Entra check that ends access; a
failure goes to `captureError` and a log line with the real (scrubbed) reason. Each job upserts its
`SystemHeartbeat` row (ok or failed, kept apart), and a heartbeat that can't be written is only a
log line. `HEALTHCHECK_PING_URL` is called after the tick, `/fail` appended when a job failed,
never throwing. The cleanup job (`lib/retention.ts`) deletes sessions a day past expiry and
notifications read 90 days ago, in batches; sign-in events stay append-only, rate-limit rows are
Better Auth's, and change history is kept. `lib/observability/log.ts` writes one JSON line per event
(fields typed to plain values, strings scrubbed and clipped), `describeError` keeps Prisma errors
to class and code as Sentry's scrubbing does, and `captureError` logs as well, falling back to the
console in the browser. The server's `console.*` lines moved to it, except the proxy (which must
stay free of Sentry and Prisma) and `lib/crypto.ts`'s key hint. Data & backups shows **System** to
admins: each job's and the nightly backup's last good run, late after three missed ticks or 36
hours, and the short reason when failing. Bunson loads through `next/dynamic` (`bunson-lazy.tsx`),
so his code is fetched only when he's chatty. The static CSP's stale comment and README's line
about backups not leaving the machine are fixed.
Fable's review of 61a: `docs/PLAN.md` had been mangled by a `String.replace` whose replacement held
`$` and a backtick (a special pattern: "everything before the match"); it was rebuilt, and plan
edits now use split and join. The Entra check swallowed its own errors and only logged an
unfinished check, so it could never show as failing; it now throws to the tick (a fixed
`Entra check: <outcome>` after its notices). `captureError` takes an event name and fields, so each
error is one log line with its context, not two.

### 61b — Encrypted backups in three places

`scripts/backup-prod.sh` encrypts each checked dump with `age` to the public keys in
`BACKUP_AGE_RECIPIENTS` (default `/etc/familyos/backup-recipients.txt`) and keeps only the
`.dump.age` (its header is checked); without the file it refuses, before dumping anything. The
private key is the owner's, in the password manager. It copies to the NAS as before and to
`BACKUP_RCLONE_REMOTE` (`rclone copyto`, then `rclone check --one-way` on that run's files, and
`rclone delete --min-age` for the keep-days). Each run upserts the `backup` row of
`system_heartbeat` through psql (size and where it was kept, or the step it failed at; a database
without the table is only a log line) and calls `BACKUP_PING_URL`. `scripts/restore-drill.sh`
decrypts a `.dump.age` into its own 700 temp folder with `AGE_IDENTITY_FILE` or a pasted key, and
restores with `--no-privileges` (a dump names the app's database role, which a fresh drill database
doesn't have). CI's container test installs `age`, checks a backup without a key is refused and
leaves nothing, backs up with a throwaway key and drills with it; `container.yml`'s filter now
includes the backup scripts. The admin guide covers the key, OneDrive and disk encryption.
Fable's review of 61b: a plain dump left by a run killed outright (power cut) is removed at the
next start; the README and guide restores use `--no-owner --no-privileges` like the drill; the drill
says to set `AGE_IDENTITY_FILE` when there's no terminal, and asks for the one key line; the
heartbeat says why it couldn't be written and writes UTC times; OneDrive keeps the same nights as
the server.

### 61c — A database login that can only touch data

The app connects as `DATABASE_URL`, its own login (`familyos_app` in production, `familycrm_app` in
development and CI), with SELECT, INSERT, UPDATE and DELETE on the tables, USAGE and SELECT on
sequences, and read-only `_prisma_migrations` (the app's backup file records the last migration).
`MIGRATE_DATABASE_URL` is the owner, read by `prisma.config.ts` first, so migrations, seeds and
`prisma migrate dev` run as it. `scripts/migrate.mjs` (the migrate image's command now, CI's migrate
step, `npm run db:migrate`, the browser tests' fresh database and the auth tests' scratch ones) runs
`prisma migrate deploy`, then the SQL `scripts/app-role.mjs` builds through `prisma db execute
--stdin`: the role made if missing, its password set from `DATABASE_URL` (percent-decoded, quotes
doubled, the name checked), grants reset to exactly those, and default privileges for the owner's
later tables. Both URLs naming one login skips it, so an install not yet split keeps working.
`e2e/serve.mjs` makes the e2e database as the owner and runs the app as `DATABASE_URL`'s login against
it; the drill restores with `--no-privileges`. Every database test file passed running as the app's
login against a scratch database, and `lib/app-role.db.test.ts` checks it can't create, drop,
truncate or alter tables, or delete migration history.
Fable's review of 61c: the app's container no longer sees the owner's URL (compose blanks
`MIGRATE_DATABASE_URL` for it, and the e2e server passes it to the migrate step only); the password
goes in its own statement, apart from the grants, since Postgres logs a failing statement whole; the
seeds use the owner's URL as the docs say; the two URLs are compared by host, port and database,
named in the error; and the role test checks each refusal is for rights, not some other error.

### 61d — Guard tests for what was convention

`lib/action-guard.test.ts` reads every `"use server"` file: each exported action's first await must be
a core check (`requireActiveProfile`, `requireAdult`, `requireAdmin`, `requireJar`, `moneyViewer`),
a helper in the same file that leads to one (up to three deep: `managingAdmin` → `signedInAdmin` →
`requireActiveProfile`), or another action of the file; nine named exceptions (setup, invite, the
profile picker, the dev preview, and the work-item router whose targets check) each say why. Every
action in a switchable app's folder must call `assertAppOn` (new in `lib/app-guard.ts`: it sends the tab to the app's
"turned off" note, as its pages do) with its own app, directly after its check (91
actions, added by a script) or in the helper it starts with (Money's `moneyViewer`, the pet's
`petProfile`, whose redirect it replaces, and Calendar's two). A tab left open on an app the family
turned off can no longer change its data. The browser tests gain a kid's profile: Ivy gets a PIN in
Settings → Household, Dad hands over, Money, Data, Cars and the Garage send her Home, a grown-up
download answers 403, and back on Dad's PIN five wrong guesses lock her tile, even to the right PIN.
Fable's review of 61d: `assertAppOn` redirects rather than throwing (the house rule: Next hides a
thrown action's message in production, so a form would have shown "Something went wrong"), and
lives in `lib/app-guard.ts` beside `requireAppOn`, away from the module background jobs import; a
person's Money download answers 404 while Money is off, like the jar export; the guard test reads
`$` in an awaited name and refuses `export const … = async` actions it couldn't see; Calendar's
helpers check the app after the admin check, as the others do.

## Phase 62 — Reminders

### 62a — The engine, preferences, and four kinds

`lib/reminders`: pure planners (`plan.ts`) for a missed dose (a timed, PENDING dose of an active
medication 90 minutes to a day past its time; to the person it's for and every grown-up; through
quiet hours), a medicine running low (`supply.ts`'s days of supply, a week or less, or the refill
count), a school form, fee or to-do due today or tomorrow (its grown-up owner, else every
grown-up), and a birthday or anniversary within a week (every grown-up but the person). `run.ts`
is the `reminders` job on the tick: per household, it first makes today's doses
(`ensureInstancesGenerated`, otherwise only run when a page opens), plans each kind in its own
try/catch for apps that are on, drops what a person switched off or is in their quiet hours for
(not claimed, so the next tick after sends it), then claims a `ReminderSent` row with the bell row
in one transaction (once per person and key) and delivers in a new `"reminders"` channel mode:
push always, Teams and email by `ReminderPrefs`' own switches, with a card per kind. Kids get the
bell only. Keys name the occurrence: `dose:<definition>:<time>` (an edit re-makes the instance),
`school:<task>:<day>`, `date:<date>:<day>`, `med:<medication>`, cleared when the medicine is no
longer low. History is kept 400 days. Settings → My notifications gains **Reminders**: a switch per
kind whose app is on, Teams and email where they work for that person, and quiet hours. Neither
table is in the backup file (`lib/backup/schema.ts`).
Fable's review of 62a: a Feb 29 birthday falls on Feb 28 in other years and a date entered for a
year still to come waits for it, as Home and the calendar show them; what already went is read
once per household, so a steady tick doesn't open and roll back a transaction per reminder; the
dose key is the day and clock time (a zone move shifts the stored instant); a stopped medicine is
forgotten like a restocked one. Known: a reminder that fails to reach Teams, email or a phone is
recorded on `AlertPrefs`' last-error fields, which the admins' Alerts page reads.

### 62b — Cars and recalls

`planCars` reminds every grown-up about car work overdue (once per service cycle: the key carries
the last service) or due within a week by date or by miles, the miles turned into days at the
car's usual rate (`lib/vehicles/mileage.ts`: the last 90 days of fill-ups, services and the car's own
reading, at least two 14 days apart); never-logged items are left out. `recallReminders` asks
NHTSA (`checkRecalls`) at most once a day per car with a year, make and model
(`Vehicle.recallsCheckedAt`, since Next's fetch cache doesn't apply outside a request), keeps
`VehicleRecallSeen`, and on a car's first check only records what's listed; a campaign seen later
reminds, unless it's already marked handled, and one that says not to drive comes through quiet
hours. An unavailable check is retried next tick. A car's page shows "about N miles a day". The
two kinds join Settings → My notifications while Cars is on.
Fable's review of 62b: recall reminders are planned from `VehicleRecallSeen` rows (found in the
last 30 days, not the baseline, not handled), not from the tick that found them, so quiet hours
defer a recall instead of losing it; the baseline is a car's first *good* check
(`recallsBaselinedAt`), so a model NHTSA didn't know until it was corrected doesn't flood. Due soon
and overdue are two reminders in a cycle, and a changed interval starts a new cycle. More than
1,000 miles a day is taken as an odometer typo (no estimate). A recall's title uses the first part
of NHTSA's component path. Known: by miles, an item can be "due in about 7 days" while the Cars
page still calls it OK (its band is 500 miles).

### 62c — The morning summary and days left

`lib/reminders/digest.ts` sends each grown-up who opted in (`digestEmail`, `digestTeams`) one message a
day from 7:00 household time, the first tick after, outside their quiet hours: today's chores and
doses (theirs and the household's count), and the school, car and date titles this tick's
planners found (dates not about themselves). It's claimed first (`digestLastOn` by an
`updateMany`, so two app instances can't both send), and nothing to say sends nothing. Email
carries the lines in its body (`emailPayload`'s new `lines`), Teams as a block each on the card
(`teamsActivity`'s `lines`). My notifications gains **Morning summary**, by Teams and by email where
each works. Grown-ups see "about N days left" under each dose on Meds and beside the count on
Manage (`daysLeftLabel`, from the same days of supply as the reminder).
Fable's review of 62c: today's chores are made before they're counted (like doses); an empty
bottle shows its count and the Low badge, not "less than a day left". Known: the summary is sent
at most once a day, so a failed send isn't retried until tomorrow, and its failures go to the log
and Sentry, not to the per-channel "last error" fields.

## Phase 63 — Data flowing between apps

### 63a — Restock from a trip

A list item remembers what put it there: `ShoppingListItem.medicationId` or `vehicleSupplyId`, set
by the meds refill hook and the Garage's low-supply hook through `requestItemByName`'s `source` (an
item already on the list gains it if it had none; `consumeForService` now returns the supply's id
too). A grown-up's Finish in the Shop view asks `tripRestockQuestions` first: for each done item
with a counted stock, "Picked up X: how many?" with the count on hand and the supply's unit, empty
by default (the list counts containers, stock counts pills or quarts). `completeTrip(restock)` takes
each row off the list with `done` checked inside its transaction and buys and restocks only the rows
it actually took, so a double tap or a second phone does nothing twice; the stock update lives in
the list's kernel (`restockFromTrip` in `lib/shopping-list.ts`), since Groceries may not import Meds
or the Garage, and is rounded in SQL, household-scoped and skips an uncounted stock. A kid's Finish
saves the trip as before. The Groceries page's own Finish doesn't ask. Backups (v10) carry the two
ids, remapped on restore. The trip's `PurchaseItem`s don't carry them (nothing reads them there; the
scope's line was dropped).
Fable's review of 63a: an answer over 10,000 is refused, not dropped (the client says so, the
server throws); the answers wait for any unsynced ticks; rows are claimed in id order, so two
phones can't deadlock; a supply no longer active isn't restocked.

### 63b — School fees per jar, bills on the calendar, car charges into Cars

**School fees:** `MoneyJar.countSchoolFees` (off by default; any member switches it on the Bills
page, and it rides in the money backups) makes open FEE school tasks with an amount and a due day
(`lib/finance/school-fees.ts`, read straight from Prisma since Money can't import School) count in
that jar's Coming up (🎒, on their own day even late, gone once done in School or a check of about
their size is paid) and Safe to spend (`schoolFeesAsBills`, a late one due today). Never in the bill
alerts: School's own reminders cover them. Due days come from local midnight, as School stores
them. **Bills on the calendar:** `lib/finance/calendar-bills.ts` `billDays(from, until)` asks
`moneyViewer` itself and gives `{ day, name }` for the viewer's own jars: regular found bills
(monthly and slower, not hidden, not stood for by a hand-added one) stepped by their cadence, and
hand-added bills' due days, from the same rows the Bills page reads (`recurringRows`, new in
`lib/finance/bill-rows.ts`, with surprises hidden). The calendar page asks only for a grown-up on
their own sign-in with Money on and adds them as a `bill` kind (💸, after dates, not a to-do or a
person's), linking to `/finances`. eslint lets that one page import that one module
(`CALENDAR_BILLS_EXCEPTION`). Not in the Outlook write-back. **Car charges:** a money-out charge
under Gas & car (or a category that absorbed it) offers ⛽ Fill-up and 🔧 Service per active car,
linking to `/vehicles/<id>?fuel|service=<cents>&on=<day>`; the car page validates it
(`parseChargePrefill`) and opens the fuel form, or fills each item's service form, with the cost
and day. Nothing links back.
Fable's review of 63b: found bills step by whole months on the calendar, as `findRecurring` dates
them (they drifted by stepping 30 days); a late school fee a check already paid leaves Safe to spend
as well as Coming up; jars load in parallel; the stepping is a pure `billDaysOf` with its own tests;
a fee in Coming up links to School.

### 63c — Who's connected, and search that lands on the thing

A contact's page shows grown-ups **Connected to**: the medicines they prescribe or fill (with whose
they are, linking to the medicine) while Meds is on, and the students they're a school contact for
(their role, linking to that student's School) while School is on (`personConnections` in
`lib/people.ts`, a kernel, since People can't import Meds or School). Search opens a school to-do in
School's side panel (`?item=SCHOOL_TASK:<id>`), and finds school calendar events in the next 60
days (a kid only their own feeds and the family's) and items on the shopping list.
Fable's review of 63c: an event's day follows the calendar's rules (all-day events are UTC
midnights of their date, timed ones in the household's zone), and it links to School when Calendar
is off; homework opens in the side panel too; the tests cover a pharmacy, a stopped medicine, a
stopped feed, events past 60 days and a list item.

## Phase 64 — Daily friction

### 64a — Home and the calendar

Home gains **Happening today** above the cards: the agenda's events for today
(`getAgendaWeek` with `days: 1, eventsOnly`, Home's own turned-off apps, so a kid's scoping holds)
plus today's Outlook events from the Calendar card's own fetch, now one promise shared by both,
each inside its own Suspense (the strip's fallback is the app's own items). `todayStrip` orders
all-day first, then by time, and caps at eight; today's Outlook items come from that week's fetch
(25 at most), so a very full week can miss some. Upcoming dates says how far off each is
(`dateWhen`) and the age a birthday turns (`turnsAge`), shows six with a link to the calendar, and
Feb 29 is Feb 28 in other years (`nextOccurrence`, as the agenda does). Big buttons Home gains
**Happening today**: school events today (`getUpcomingSchoolEvents` with `days: 0`, their own and the
family's) and household members' birthdays this week. The Outlook auto-sync also starts from the
Calendar page and Big buttons Home, behind the same gate Home uses (the owner on their own
Microsoft sign-in).
Fable's review of 64a: the agenda, members and auto-sync now load alongside everything else (no
extra waits on Home, Big buttons Home or the Calendar); the strip carries each person's colour;
skipped items are muted like done ones; "See all" opens the month.

### 64b — Add an event to Outlook

A grown-up on their own Microsoft sign-in who has granted calendar write access
(`calendarWriteGranted`) gets **+ Add event** on the Calendar (`add-event.tsx`, `useActionState`,
`SubmitButton`). `addCalendarEvent` re-checks all of that and Calendar being on, takes "who it's for"
only from household members, and builds the body with `lib/calendar/new-event.ts`: all-day is
midnight to the next midnight in the household's zone, timed is a wall-clock time in it (an hour
when there's no end, kept on its day), and a `transactionId` made when the page was drawn, so a retry
after a timeout doesn't add it twice. `addEventToHomeCalendar` (`lib/graph/calendar.ts`) writes it to
the calendar that person's Home and Calendar read (their pick, else the family calendar by name, else
their own), never the sync's app-made calendar, which Disconnect deletes whole, and with no app tag,
so the sync (which only diffs the events it made) never touches it. Graph's answers become fixed
text. An admin without write access sees where to grant it.
Fable's review of 64b: a 404 forgets the remembered calendar id (as reads do) and says which
setting to change; a refused name lookup or an expired sign-in say so; "who it's for" uses the same
short name the picker shows.

### 64c — Groceries: add from the Shop view, and notes

The Shop view has the Groceries add box at its top. The box knows when the browser is offline
(`useOnline`, a `useSyncExternalStore` on online and offline events): it then says adding waits for
signal (ticks still queue as before), and a failed search or add says to try again instead of
failing quietly; a new row reaches the Shop list through the action's own revalidation. A list
item gains `note` (200 characters), set in its sheet with its own form (`setItemNote`, per list item
like who it's for, anyone who can use the list), shown on the list row and in the Shop view, to
everyone who sees the list. Backups move to v11 with the note; the accepted versions now include 9
and 10, which the list had skipped.
Fable's review of 64c: offline, the box stays on screen but disabled (what was typed and focus
stay), naming a new barcode catches a failure too, a network failure says to check signal and
anything else to reload, and the tests carry a note through backup and restore and accept v9 and v10.

### 64d — Money: new since you last looked

`MoneyJarMember.lastSeenAt` marks each member's last look. Above the month on a jar's Activity page,
**New since you last looked (N)** (`lib/finance/new-since.ts`) lists rows created after it (a first look
counts the last 30 days), or holds that posted after it on their own row (the feed kept the id:
sync sets the new `FinTransaction.postedAt`), active, not pending, not a surprise hidden from them, newest 100, each with a native category select. **Save all**
(`fileNewSince`) re-reads the ids against the same query (this jar, still new to this member, at most
100), re-checks each category against the jar (another jar's leaves the row alone), and files with
`filingFor`: a change or an unchanged guess (AUTO) becomes the member's pick (PERSON); an unchanged
rule's or person's row is left, so it stays tied to its rule. It logs one `NEW_FILED` jar event with
the count. **Mark all seen** (`markNewSeen`) only moves the mark. Both set `lastSeenAt` to when the
page was read (sent back with the form, never later than now), so a charge that arrived while the
page was open stays new. `lastSeenAt` isn't in money backups: after a restore the 30-day first look
applies again.
Fable's review of 64d: a hold the bank posts under the same id kept its old `createdAt` and never
showed as new, hence `postedAt`; the mark only moves forward (a tab left open for days can't undo a
later look); **Save all** files and marks seen in one transaction; the guide says where the list
sits; the event's wording has a test.

## Phase 65 — New capabilities

The last phase from the review of 2026-11-07 (scope in docs/PLAN.md, with the owner's answers).

### 65a — Medicines: as needed, and dose history

`FrequencyType.AS_NEEDED` makes no scheduled doses (`firstOccurrenceOnOrAfter` returns none; "As
needed" in `describeRecurrence`); the medicine form drops times for it and offers
`Medication.minGapHours` (0.5–72) and `maxPerDay` (1–24). Chores still reject it. **Take a dose**
(`takeAsNeeded`) locks the definition's row, reads the doses of the last day (or the gap) inside the
transaction and decides with `nextAllowed` (`lib/meds/as-needed.ts`: the gap from the last dose; the
maximum over any 24 hours, from the dose that must age out), then makes a DONE instance due and
done now, with stock, stickers and the refill item as for a scheduled dose (low also at 5 doses
left). `undoAsNeeded` deletes the dose rather than putting it back to waiting. The board, the
calendar, missed-dose reminders and "mark older missed" leave AS_NEEDED out. `AsNeededRow`
(`components/meds/as-needed-row.tsx`, from `getAsNeeded`) shows on Meds, in Home's Today card (a
grown-up everyone's, a kid their own) and on Big buttons Home. Days left and the low reminder say
doses. `/meds/[id]/history` and `/print/meds/[id]/history` (`lib/meds/history.ts`) list 90 days of
doses for grown-ups and the medicine's own person. Backups v12 carry the limits.
Fable's review of 65a: switching a medicine to As needed drops every waiting dose (overdue ones
would otherwise linger where nothing clears them); the scheduled take and undo refuse as-needed
doses; a zone move leaves as-needed doses alone (their dueDate is an instant) and the history
orders them by when they were taken; `components/meds` joins the meds lint zone; the take and undo
buttons name their medicine for screen readers; Manage drops a stray separator and refreshes after
a dose; the last-dose lookup is bounded to 90 days ("Not taken lately" past that); dates past a
week say the date; the form has bounds; the restore test round-trips an AS_NEEDED medicine.

### 65b — Cars: paperwork and repairs

Both reuse car work rather than new models (car work already reaches due status, reminders, Home,
the Today strip, search, activity, export and print). `VehicleMaintenanceItem.kind`: SERVICE
(default), PAPERWORK, REPAIRS. Paperwork has `intervalMonths` (1–60) and a `nextDueAt` (a stored
day, in `DAY_COLUMNS`) that alone decides its due status; **Renewed** is the item's log action,
which in the same transaction moves `nextDueAt` on by `intervalMonths` from the old due day
(`addMonths`), and undo moves it back. A repair is a `VehicleServiceLog` with its own `title` on the
car's one hidden REPAIRS item (made on the first repair): the history, export and activity show the
log's title, and costs count it as service; miles default to the car's current, and higher miles
move the odometer. The queries, search, export, reminders, Manage and the item edit page leave the
REPAIRS item out; the log and undo actions refuse it; `deleteRepair` (asks first) only deletes
repair logs. Paperwork reminds 14 days ahead (car work stays 7), keyed by its due day. Backups v13
carry the kind, due day and repair titles.
Fable's review of 65b: a renewal remembers the due day before it (`VehicleServiceLog.dueAtBefore`)
and undo puts that back, since subtracting months doesn't undo month-end clamping (Jan 31 + 1
month is Feb 28; back is Jan 28); the renewal locks the item's row and the first repair locks the
car's, so taps at once can't move a due day twice or make two Repairs items; paperwork cards say
"Renewed …" or "Not renewed yet"; the reminders line in the guide names paperwork's two weeks; the
placeholder receipt no longer names a real chain.

### 65c — Groceries: running low on Home

One heuristic, not two: `computePantrySuggestions` weighs by quantity (history rows now carry it).
Each purchase day sums what was bought; the days each one lasted (the gap after a trip over what
that trip bought) give a median, and the last trip's amount times it is how long the last purchase
lasts (with one each time, exactly the old median gap). A new `aheadDays` also takes what runs out
within that many days; `daysLeft` says how long. Groceries' chips keep `aheadDays: 0`. Home's
**Probably running low** (`getRunningLow`: three days ahead, at most 6, soonest first, nothing on
the list) is loaded only for grown-ups with Groceries on, and shows only when there's something;
**+ Add** is Groceries' own `addItem`, which now also refreshes Home.
Fable's review of 65c: the field is `lastsDays` now (how long the last purchase lasts), and the
chip's hint says "Should last about N days"; a list item's name also excludes old history rows keyed
by description (their Pantry item deleted), on Home and Groceries, so **+ Add** always clears it;
Home sorts by the unrounded days left.

### 65d — Groceries: a light meal plan

`Meal` (a name), `MealIngredient` (a Pantry item and an amount, one per meal and item) and
`MealPlanDay` (a stored day, in `DAY_COLUMNS`; a meal or a note; one per household and day).
`/groceries/meals` (a **🍽️ Meals** button on Groceries) shows the week Sunday to Saturday like the
calendar (`?week=`, ten years either way). Grown-ups save the whole week in one form (each meal
checked against the household; a day with neither is cleared), save meals with ingredients typed one
per line (`parseIngredients`: a number first is how many; same items fold), each found or made as a
Pantry item with a section guess, and **Add what's missing** (`weekShopping`: each item once,
summed, skipping what's on the list unticked). Deleting a meal (asks first) writes its name into
the days that had it. Kids see the week read-only. Today's dinner joins Home's Today strip (a
`meal` agenda kind) when Groceries is on. Backups v14 carry the three; a restore folds ingredients
whose Pantry items fold.
Fable's review of 65d: a count needs a space after it, so "2% milk", "7-Up" and "1/2 onion" stay
whole names, a weight or volume ("12 oz pasta") is one of the rest, and a saved meal reads back the
same on a re-save ("1 x 7-Up"); Pantry items are found or made before the meal's one write, outside
a transaction, so their race path works; meal names are once per household; deleting a meal keeps
its name ahead of a day's note, and a day shows both ("Tacos · early") on Home and to kids; a meal
deleted mid-save says so instead of failing; `?week=` refuses days that don't exist; the restore
preview counts planned dinners.

## Phase 66 — The second fix-it batch

The first phase from the review of 2026-11-08 (scope in docs/PLAN.md).

### 66a — Meds, chores and the calendar

**Kids and medicines:** a kid's Meds page is always their own (`personFilter` is `profile.id`, no
person row), a person's Meds summary shows only to grown-ups and the person, Home's Today card
passes the kid's id, the calendar's `loadTaskInstances` takes `dosesFor` (chores untouched), and
search finds only a kid's own medicines. `lib/meds/kid-scope-guard.test.ts` reads all five.
**Stock:** `lib/meds/stock.ts` (`takeStock`, `addToStock`) does the arithmetic in SQL like the
Garage: locked row, clamped at zero, rounded to three places, the amount taken worked out from the
locked value. A dose keeps its PENDING guard first, then takes stock, then records what it took as
`quantityConsumed`, so Undo gives that back; a scheduled dose reads the count and dose amount in
the transaction. `restockFromTrip` already rounded and stays in the list kernel (lint keeps it out
of `lib/meds`). **Low:** `isMedLow` moved to `lib/reminders/supply.ts`; taking a dose asks for a
refill on it (a week of supply, the refill count, or 5 as-needed doses), and Manage's Low badge
uses it; `isLowStock` is gone. **Chore edit:** `scheduleChanged` (`lib/tasks/edit.ts`) compares
schedule, times, rotation and people; when they change, waiting days from today on, not moved by
hand, go in the edit's transaction and the planner makes new ones (hand reassignments go with
them; a title or points edit keeps everything). **Calendar:** `eventItems` spreads a timed event to
the day of its last minute in the household's zone: its start time on the first day, all day
after, "until Sun 2:00 PM · place", keys `key:day`, days outside the window dropped; one ending at
midnight stays one day. **Errors:** both boundaries use Next 16's `retry()`.
Fable's review of 66a: Home's Today card, the calendar and search still showed a kid every dose
(fixed, and in the guard); a scheduled dose read its stock from the page's snapshot (now inside the
transaction); tests now check the chore edit really saved, cover as-needed stock and its undo, a
dose that leaves plenty, and a kid's calendar doses; the refill comments say isMedLow. Left as is:
an event from 11:50 pm to 12:10 am shows on both days.

### 66b — Two phones on the list, and failures in words

**Steps:** the list's −/+ call `stepQuantity(itemId, ±1)`, applied in SQL to the amount as it is
(capped at 999), with the zero-delete in the same transaction; `setQuantity` is gone. **Gone rows:**
`toggleItem`, `setRequestedBy` and `setItemNote` use household-scoped `updateMany`, so a row
another phone took off does nothing; `assertOwnedItem` is gone. **One row per item:** `lockList`
(`lib/shopping-list.ts`) takes `SELECT … FOR UPDATE` on the household's one list row; every path
that adds a row or un-ticks one takes it first and then looks: `addProductToList`,
`requestItemByName` (now in a transaction, its Pantry item found first since that one recovers
from a unique-key race), `putRowBack`, `addWeekToList`, Pantry merge, and `untickRow`, which
folds a ticked row into an unchecked twin added meanwhile (amount added; note, who it's for and a
medicine or car source kept when the twin has none). Toggling and the Shop view's `applyChecks`
(now given the list id) both un-tick through it. Paths that only remove or tick rows (finishing a
trip, taking a row off) don't need the lock, so writes after a lookup go by id with
`updateMany`/`deleteMany`. **Sync from Microsoft** returns `{ error }` and
`SyncFromMicrosoftButton` (`useActionState`) shows it in place. Home's Called/Texted stay plain
forms: no typed input, so nothing to say.
Fable's review of 66b: no lock cycle (every locking path takes the list first); un-tick and add no
longer crash when a lock-free removal beats them; the step and its zero-delete share a transaction
(Postgres can't update and delete one row in a single statement); Pantry merge takes the lock; the
fold keeps the note and who it's for.

### 66c — Money

**Pending picks:** right after a sync marks pending rows SUPERSEDED (same transaction, after the
posted rows are in), `carryPendingPicks` (`lib/finance/pending-match.ts`) hands a person's
category, a grocery trip link (with `purchaseLinkedBy`) and a matched order email to the posted
row each became. The matcher, `postedRowFor`, is the one surprise marks used (same account and
feed, 0–10 days later, same sign, amount within 25%, same merchant), now shared with
`gifts.ts`; candidates are only rows that can take something and haven't taken from another
pending row in that sync. It runs once, at that moment. **Feed amounts:** `feedAmountToCents`
(`lib/money.ts`) rounds a third decimal and beyond to the cent, half away from zero, in string
arithmetic; typed money still refuses it. **Pending days:** `parseAccounts` reads a pending row's
`transacted_at` (or now) as a day in the household's zone, which the server keeps; posted rows
keep the bank's UTC date. The stored and parsed days are both plain strings, so a pending row is
rewritten once after the change and then stays put.
Fable's review of 66c: the carry could pick a posted row that couldn't take the pick, or one another
pending charge had just filled, and drop it (candidates now exclude both); order emails move too.
Left as is: `feedAmountToCents` refuses ".5" like `decimalToCents`.

## Phase 67 — The security and ops safety net

The second phase from the review of 2026-11-08 (scope in docs/PLAN.md).

### 67a — Where you're signed in, and a fuller sign-in log

**Settings → Where I'm signed in** (`/settings/devices`, a hub tile on any own sign-in):
`lib/my-sessions.ts` lists the signed-in user's unexpired sessions with `deviceLabel`
(`lib/device-label.ts`, a rough pure parser of the sign-in's User-Agent) and when each signed in
(sessions are never refreshed, so there's no "last active"). **Sign out** deletes one of your
other session rows and **Sign out everywhere else** all but the current one (known by id from
`getServerSession`), each in a transaction with a `SIGNED_OUT_ELSEWHERE` entry; a PIN-switched
profile sees a note. It takes effect at that device's next request (`cookieCache` stays off).
**Admins:** `signOutEverywhere` (`lib/sign-ins.ts`, through `managing`) deletes a passkey or OIDC
person's sessions with a `SIGNED_OUT_EVERYWHERE` entry and notices (the person, other admins).
**Routes off:** `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`
join `disabledPaths`; `lib/auth-routes-guard.test.ts` names them with the token and passkey ones.
**The log:** `PIN_SET` (an admin's `setMemberPin`, a person's own set or clear), `PIN_LOCKED`
(written in the lockout's own transaction under its advisory lock, the actor being whose sign-in
the device was on; every admin is told, the actor and the locked person included) and
`MEMBER_REMOVED`, each in a transaction with its change (migration `20261201120000_sign_in_log_more`).
Fable's review of 67a: no must-fix. A lockout now reaches the admin whose device or tile it was even
with their switch for others' sign-ins off, and an admin's own tile says "Your profile locked";
the lockout's notices come back from its transaction instead of a closure write; "everywhere
else" skips expired rows; tests cover every new entry's wording, a PIN-switched profile refused at
the action, and someone else's session left alone. Left as is (dev sign-in only): the hub tile
follows `isOwnSignIn`, so the DEV_AUTH user sees it and then the page's note.

### 67b — Hearing when something stopped, and calls that can't hang

**System reminder:** `REMINDER_SYSTEM` (migration `20261201130000_system_reminder`). `planSystem`
(`lib/reminders/plan.ts`) reads every heartbeat each tick and, with the System card's rules
(`heartbeatState`, now in the database-free `lib/heartbeat-state.ts`), plans one per job that's
failing or late and for the backup when failing or 36 hours late, to the admins (`loadPeople`
carries the role). Key `system:<job>:<state>:<lastOkAt or never>`: the last failure moves every
tick, the last good run doesn't, so it reminds once per problem. Never-run heartbeats don't
remind. Not urgent; Teams card "⚙️ The app"; listed in My notifications for admins only
(`listedKinds(isOn, admin)`); the morning summary adds "Something stopped: …". **Job timeout:**
`withTimeout` gives each job `JOB_TIMEOUT_MS` (10 minutes); past it the tick records "timed out"
and moves on, and the run's late answer is dropped (its rejection is swallowed). Money and the
Entra check hold leases, reminders claim per key, the rest are idempotent. **RxTerms:** 5-second
timeout, 60 characters. **Cleanup:** unread notifications older than 180 days go too. JOBS now
lists reminders before cleanup, the order they run.
Fable's review of 67b: the reminders job is left out of the plan (the reminder runs inside it, and
right after an outage it and the jobs after it would have looked late), and cleanup now runs before
reminders; a failing job is keyed on the day of its last good run, so a job that keeps failing and
recovering reminds once a day, not every hour; a run that timed out and hasn't ended stops the same
job starting again ("still running from an earlier tick"), so a job that hangs every tick can't
pile up runs holding connections; the morning summary's line follows the reminder's switch; tests
count by title (a dev database can hold stale heartbeats) and cover the dropped late answer. Left
as is: the unread-notification cleanup has no index leading on readAt (family-sized table).

### 67c — Backups that outlast a bad fortnight, keys that can change, scans, logs

**Backups:** `backup-prod.sh` also keeps Sunday's dump in `weekly/` (`BACKUP_KEEP_WEEKS`, 8) and
the 1st's in `monthly/` (`BACKUP_KEEP_MONTHS`, 12), with its `.counts`, in each place; folders
that exist are expired every night (`find -mtime`). Off site the nightly prune is `--max-depth 1`
(rclone filters match at any depth, so it would have eaten weekly/ and monthly/), each folder has
its own, and `BACKUP_RCLONE_PRUNE=0` deletes nothing there. `BACKUP_TIERS` stands in for the date
in `container-test.sh`, which checks both copies. Empty-array loops are written for old bash.
**Keys:** `INTEGRATION_ENCRYPTION_KEY_PREVIOUS` (validated at start, never equal to the current
key) is tried when the current key fails (`openSealed`; GCM fails cleanly with the wrong key).
The new `keys` job (after `zone`) opens a sealed check value (`ServerSecret` "key-check",
`lib/key-check.ts`) every tick and fails with `WrongKeyError` when no key does; while a previous
key is set it re-seals the server secrets, bank and card connections (`lib/finance/reseal.ts`, with
a fresh Privacy.com fingerprint) and school feed addresses (`lib/school/feeds/reseal.ts`), each
update matched on the old IV so a secret saved meanwhile isn't overwritten. The `keyVersion`
columns stay unused; Undo and finder seals just expire. A backup's money section opens with
either key. README has the runbook, `BETTER_AUTH_SECRETS` included. **Scans:** the supply-chain
workflow runs `npm audit --omit=dev --audit-level=high`, and weekly (and by hand) a Trivy scan of
`ghcr.io/<owner>/familyos:main` from Trivy's image pinned by digest. zod went to 4.6.7 for
GHSA-mrhx-c7xc-m3w5, the one high advisory in what ships. **Logs:** every compose service uses the
`local` driver (5 × 10 MB); `deploy/logrotate/familyos` rotates the host logs weekly with
`copytruncate`.
Fable's review of 67c: the off-site `rclone check` saw tonight's copy in the local weekly/ and
monthly/ folders too and would have failed every Sunday and 1st (now `--max-depth 1`); the tier
prunes run only on folders that are there, without hiding real errors; a pre-67c database restored
onto a server with other keys gets no key check sealed with the wrong key (it's made only when the
key opens the server's other secrets), and a malformed check row says so rather than "wrong key";
the profile-switch cookie is keyed from the newest `BETTER_AUTH_SECRETS` entry while rotating;
Trivy comes from its GHCR copy while signed in; the System card says when a weekly or monthly copy
was made; logrotate names its `su`. Monthly copies are kept 12 × 31 days.

## Phase 68 — Reminders ahead of time

The third phase from the review of 2026-11-08 (scope in docs/PLAN.md, with the owner's answers).

### 68a — Doses on time, and courses that end

**A dose is due:** `REMINDER_DOSE_DUE` (migration `20261202120000_dose_due_and_course_end`).
`doseReminders` loads PENDING doses up to 15 minutes ahead and feeds `planDoses` and
`planDosesDue`: a timed dose from 15 minutes before to 90 after; a grown-up's own dose to them, a
kid's or nobody's to the grown-ups who opted in plus the kid (bell). Key `dose-due:<def>:<day>:<hhmm>`.
Not urgent: quiet hours that outlast the window mean it isn't sent (the missed one still is).
**Opt-in:** `ReminderPrefs.optIn`; `REMINDER_KINDS` entries can be `optIn`; `kindOff` decides
in the run (an opt-in kind only if switched on, others unless switched off); `nextOptIn` saves it
keeping hidden kinds; My notifications ticks opt-in kinds from `optIn`. `listedKinds` knows
"chores". **Course end:** `TaskDefinition.endDate` (a stored day column, in `DAY_COLUMNS`);
`courseEnd` (`lib/meds/form.ts`) turns "after N days" (start + N − 1) or "on a date" into it;
`planInstances` plans nothing after it; `endFinishedCourses` (after the dose planners each tick)
switches a medicine off once its last day plus the missed-dose grace has passed, deleting nothing.
Meds and Manage say "Last day". Backups v15 carry `endDate` (none in older files).
Fable's review of 68a: turning a finished course back on takes its past end day off (the next
tick would have switched it off again), as the guide now says; switching courses off is its own
step in the tick, so a failure there can't lose the dose plans; whose dose is a grown-up's own goes
by role, so an adult whose Entra access ended isn't treated as a kid; "Last day" shows only for
scheduled medicines and says the year when it isn't this one; tests cover the window's edge, both
doses on the last day, a course ending today, and turning one back on. Left as is: with Meds off,
ended courses stay active until it's on again (nothing is planned past the end meanwhile).

### 68b — Homework, chores, and a fuller morning

`REMINDER_HOMEWORK` and `REMINDER_CHORES` (migration `20261202130000_homework_chores_reminders`).
**Homework:** `homeworkReminders` loads kids' TODO assignments due tomorrow (local-midnight due
days, kids' profiles only) from 3 pm; `planHomework` sends to the kid (bell) and the grown-ups,
key `homework:<id>:<day>`, "Max has a quiz due tomorrow: Fractions", linking to the kid's School.
**Chores:** from the first tick at or after 18:00, `choreReminders` makes today's chores and counts
each kid's own PENDING ones (not "Anyone", not grown-ups'); `planChores` gives each kid a bell
("2 chores still to do today", `chores:<kid>:<day>`) and the grown-ups one line ("Still to do
today: Ivy 2, Max 1", `chores:all:<day>`). Both listed in My notifications with their apps.
**Summary:** `morningExtras` adds today's events from every active school feed (`loadSchoolEvents`
as a grown-up sees them, so all-day and timed rows use the calendar's cutoffs), kids' schoolwork
due today and tonight's dinner (`getTodaysDinner`), each with its app on. Outlook stays out (the
tick has no Microsoft token).
Fable's review of 68b: dinner rides along only when the summary has something else to say (a
planned meal alone sent everyone a one-line summary); long homework and event lists end "and N
more"; a kid's own homework bell says "You have a quiz due tomorrow" (the grown-ups' has the name,
under its own key); the zone comes from `processZone`; tests show a grown-up's own class and an
"Anyone" chore aren't counted. Noted: `plannedRows` takes today from the clock, not the caller.

### 68c — Phone notifications that keep working

**Renewal:** `public/sw.js` handles `pushsubscriptionchange`: with the old subscription it
subscribes again (the new one the event gives, or with the old key, or the key from
`GET /api/push/key`, signed-in only) and posts old and new to `POST /api/push/renew`
(`lib/alerts/renew-request.ts`: a same-origin JSON fetch from its own origin, someone signed in,
the subscription checked with the shared `subscriptionSchema`, now in `lib/alerts/subscription.ts`);
`renewDevice` moves the household's row to the new endpoint, keeping its person (or drops the old
when the new is already saved; never another household's). Without the old subscription there's
nothing to move: the 410 path removes it as before. **Tag and badge:** `deliverNotifications` reads
each note's kind and `pushTag` (kind and link, 64 characters) rides in the payload; the service
worker passes `tag` and `badge: /notification-badge.png` (96 × 96, white on transparent, made
by a small script). **App badge:** the bell sets `navigator.setAppBadge(unread)` where it exists.
Fable's review of 68c: the tag was the kind and link, so two kids' 8:00 doses (same kind, same link)
replaced each other silently; it's now the kind and a hash of the link and words, with `renotify` so
a genuine replacement still sounds; test pushes share one tag. The renew route reads its body as
text with an 8 KB cap (a body without a length was unbounded). A renewal onto an address already
saved refreshes that row's keys and count. The app badge clears when the bell goes away. Tests
cover the route's answers, the given and fetched-key paths, and the saved-address case. Left as is:
a renewal while the phone's sign-in or Access has lapsed isn't retried (the 410 path and turning
alerts on again cover it, as admin.md says).

## Phase 69 — Everyday friction

The fourth phase from the review of 2026-11-08 (scope in docs/PLAN.md, with the owner's answers).

### 69a — Fresh pages, a sturdier Home, and the app's frame

**Refresh on return:** `components/refresh-on-return.tsx` (`shouldRefresh`, tested) calls
`router.refresh()` when the page is shown again after a minute away or on a new day, and online;
on Home (both views), Chores and Meds; an `everyMs` timer for the Shop view (69b). **Home's cards:**
each card's own loads go through `safe(part, load, fallback)`: a failure is captured
(`home.card_failed`), the card gets its empty value, and a status line names what couldn't load.
Settings, members and the apps that are on still fail the page; Big buttons Home is unchanged.
**iPhone:** `viewportFit: "cover"`; `--bottom-bar-h` adds
`env(safe-area-inset-bottom)` and the bar pads by it; the body keeps clear of a landscape notch;
the dev shell matches. **Form errors:** every rendered action error has `role="alert"` (22 were
plain), and `lib/form-error-guard.test.ts` covers `x.error && …` and `if (state.error) return <…>`.
Fable's review of 69a: the link hint was dropped (`app/(app)/loading.tsx` already covers the detail
pages, so the links are prefetched to it and the hint could never show, and a fixed bar inside a
tilted card would have drawn inside it); the guard now catches any `error &&` (two more fixed); the
bottom bar keeps clear of a landscape notch; a page shown again while offline refreshes once it's
back online; the plan says Home names failed parts in one line at the top (as built).

### 69b — Groceries and cars

**Staples:** `Product.alwaysHave` ("We always have it" on the Pantry item's sheet) and
`weekShopping` skips it; `addWeekToList` counts days from `max(week start, today)` and treats any
row on the list (ticked too) as there. **Still have some:** `Product.lowSnoozedAt`; `stillHaveSome`
sets it from Home's card and the Groceries chips (`×`); `getPantrySuggestions`, which both read,
leaves an item out for one usual gap from then unless it was bought since (`stillSnoozed`, pure).
Migration `20261203120000_product_staples_snooze`; backups v16 carry `alwaysHave`;
`lowSnoozedAt` is passing state, left out (coverage test says so). **Shop view:**
`RefreshOnReturn everyMs={60_000}`, `paused` while taps are still syncing (a refresh begun before
a check-off commits could show it unticked for a moment). **Good until:** the Renewed form for
paperwork has a date box, its default (`goodUntilDefault`, server-side) a cycle on from the due day,
moved on while not after today; the action saves it under the item's row lock with `dueAtBefore`
for Undo, refusing one not after the renewal; empty keeps the cycle rule.
Fable's review of 69b: "bought since the snooze" compares days (purchases are known by the day),
so a purchase that day or later ends it; Good until and the cycle rule apply only to the latest
renewal (a catch-up entry for an older one leaves the due day alone); Undo puts back an empty due
day too; "That week is over" for a past week; the Good until box says what it's for; the snooze
query is skipped when nothing could be snoozed; tests cover a same-day purchase, a past day's meal,
a backdated renewal and paperwork without a due day. Left as is: kids can say "Still have some" on
the Groceries chips (the list is everyone's).

### 69c — Money, search and the calendar

**Every-branch rules:** `CategoryRule.matchPrefix` (migration `20261203130000_rule_prefix_bill_paid`).
`lib/finance/rules.ts`: `ruleResolver` (an exact rule, else the longest prefix rule the key starts
with at a word), `ruleCovers`, `branchKey` (the key without its last word, when that leaves three
letters or more). `organizeJar` and the refund pairing use the resolver; `setCategory` takes a
`branches` scope; `forgetRule` deletes whichever rule covers the charge; the picker offers
**Always for every …**. **Paid by hand:** `ManualBill.paidDueOn`; `nextDueOn` treats that day and
earlier as paid, so Coming up, Safe to spend and bill alerts all see it; `markManualBillPaid`
accepts only one of the bill's due days in the window Coming up shows. The sealed money backup goes
to v4 (`matchPrefix`, `paidDueOn`; v3 still restores). **Search:** meals by name or ingredient
(`lib/search.ts`, Groceries on); money from `lib/finance/search.ts` (`searchMoney`: an adult household
member on their own sign-in with Money on, their jars only, `visibleToWhere` for surprises, names,
jar and day, no amounts; a charge opens its jar's month, a bill opens Bills), read only by the search
page through a new lint exception like the calendar's bills one. **Dinners on the calendar:**
`loadMeals` and `mealItems`, only with Groceries on and not for events-only reads (the month, Home's
strip, which adds today's dinner itself).
Fable's review of 69c: stopping "always" removes only the rule that files that charge (a branch's
own rule, else the every-branch one), not both; "Paid" has an Undo on the bill, and editing a bill's
due day or cadence clears an old paid mark; a charge without a merchant shows as "A charge" in
search (raw bank text can carry the amount); a search link never asks for a future month; history
says "at any branch". Dropped: counting how many charges an every-branch rule covers (the answer
names the store; the rule's effect is visible in Activity). Left as is: a hand-added bill marked
paid still shows on the calendar's due day, as found bills do.

## Phase 70 — New capabilities

The last phase from the review of 2026-11-08. Scope and Fable's scope review: docs/PLAN.md
"Phase 70".

### 70a — Outlook calendars for everyone

**The copy:** `OutlookCalendar` (kind PERSON or FAMILY, the calendar's person, the mailbox, an
optional Graph calendar id, lease, last success, fixed-text last error, a 429 wait) and
`OutlookEvent` (immutable Graph id, iCalUId, title, place, start, end, all day, private), migration
`20261204120000_outlook_copy` with a partial unique index for one FAMILY per household. The reader,
`lib/graph/app-calendar.ts`, uses the app-only token (`getAppGraphToken`) that Exchange RBAC for
Applications scopes to a mail-enabled security group (`Application Calendars.Read`, README
"Outlook calendars"): calendarView a week back to 60 days ahead, `Prefer: IdType="ImmutableId"`,
`sensitivity` (private and confidential keep no title or place), the write-back's extended property
(now `lib/graph/source-property.ts`) so the app's own events are dropped, Graph's pages followed to
1,000 events. `lib/outlook-copy/` holds the copy (not under `lib/calendar`, so Settings may use it
under the domain rules): `copy.ts` claims stale calendars (15 minutes) under a lease, replaces the
events on a success and keeps the last copy on a failure; `dropEndedCalendars` removes someone's own
copy when the Entra check ends their access or they leave the household, and switches off a family
calendar in their mailbox. The `outlook` background job runs after `entra`; Home, Big Home and
Calendar also refresh on a visit (`scheduleOutlookRefresh`, `after()`).
**Who sees what** (`view.ts`, the owner's call): grown-ups every copied calendar, kids the family's
and their own (in the query and again in `canSeeCalendar`); a private event shows "Busy", or
"Private" to its calendar's person (the family calendar's is its mailbox's person), checked against
the active profile, never the session. One meeting in several copied calendars (same iCalUId, start
and all-day) shows once: the family's if it's there, else with the names joined ("Dad & Mom"),
whose `whoId` is then null, so the person filter shows it to everyone (70f's `whoIds` can narrow
it). **Copy or live:** once a household copies any calendar (`hasOutlookCopy`, people still here),
Home's week card and Today strip, Big Home's today list and the Calendar page read only the copy,
for every viewer; the live per-session read stays for households without one. Settings → Calendar on
Home says so, and its choice still picks where **+ Add event** writes. Outlook items on the agenda
now carry `who`/`whoId`, and "outlook" counts as a person kind for colors and the filter.
**Settings → Outlook calendars** (admins; a tile under Connect): the family calendar (whose mailbox,
then which calendar, listed with the app token) and **Copy their calendar** per person. The mailbox
is worked out on the server from a person id, never typed: a Microsoft sign-in's account id (the
Entra object id, newest account first), else the email on their People page (the page links there
to add one; no address box, a deviation from the scope's "typed" address that keeps addresses out of
forms and URLs). **Check access and copy now** copies every calendar except one Outlook asked to wait
on. The copy is integration state, out of backups.
Fable's review of 70a: an admin's copy now takes the calendar's lease itself (or says it's already
being copied), and every copy releases only the lease it wrote; a last page that runs past 1,000
events counts as truncated, and so does a view that hits its read limit; "very large; only part
shown" no longer reads as a failure on the page or the Settings tile; wording says a calendar is
refreshed once it's 15 minutes old (on a visit or the half-hourly run), not "every 15 minutes";
Big Home's list goes through the agenda's day rules with names; `hasOutlookCopy` agrees with the
view about people whose access ended; per-row states are statuses, not alerts; Check access skips a
calendar Outlook asked to wait on. Left as is: a folded meeting from two people's own calendars
shows in every person's filter until 70f.

### 70b — Who's driving

`EventDriver` (calendar, immutable Graph id, driver, who set it, the event's end), unique on
(calendar, Graph id), migration `20261204130000_event_driver`. `lib/outlook-copy/drivers.ts`:
`getDriveTarget` (a grown-up, a timed event in this household's active copy whose person is still
here) and `setEventDriver` (a grown-up of the household who's still here, or nobody). A successful
copy moves each driver's end with its event and drops one whose event is missing and ended before
the copy's window, so a read that briefly misses an event loses nothing; `dropEndedCalendars` also
drops a cut-off person's drives, and the view hides them at once. `getCopiedEvents` attaches the
driver's name (names among the household's members, since a driver needn't own a copied
calendar). A driver is set on every copy of the meeting (same iCalUId, start, timed) in the household,
and in a fold the family copy's link wins, so whoever can see any copy sees it. There's no household
column: the calendar carries it. Grown-ups get `driveHref` on timed events
(`/calendar/drive?c=&g=`, the ids aren't personal); `outlookItems` puts "Driving: Dad" in the
note and links there. Home's week card and Big Home's list show it too.
Fable's review of 70b: a driver set from someone's own copy of a family meeting didn't reach the
family copy (kids missed it, and a second driver could be set): now it goes on every copy, and the
family copy's link wins; names come from household members only (a contact sharing a first name
no longer renames anyone); an event that turns all-day drops its driver; Big Home adds only the
driver, not every event's place; a driver who's no longer a grown-up stops showing and is dropped;
kids opening the page go back to the calendar; the backup notes say drivers are left out.

### 70c — Chore checks and swaps

**A grown-up checks it:** `TaskDefinition.needsCheck` and `TaskInstance.awaitingCheck` (migration
`20261205120000_chore_checks_swaps`; household backup v17 carries both, older files have them off).
`completeChore` on such a chore by a kid sets DONE with `completedById` and `awaitingCheck`, leaving
`completedAt` null and paying nothing, so pet presents, Activity, milestones and the ledger (all keyed
on `completedAt` or the ledger row) wait. `checkChore` (grown-ups, never who ticked it): **OK** is
a guarded update (still DONE and waiting, same ticker) that sets `completedAt` and pays through the
same `pay` helper a normal Done uses; **Not yet** returns it to PENDING. Undo pins
`awaitingCheck` and `completedById` too (a waiting tick has no `completedAt` to pin). A waiting chore
still counts as done on the chart, Home's finished fold and the day's progress, with "waiting for a
grown-up's check" on its card. `lib/chores/checks.ts` feeds **Waiting for a check** on Chores and
Home's count. **Swaps:** `ChoreSwap` (instance and its day, from, to, optional chore given back and
its day, status PENDING / ACCEPTED / DECLINED / CANCELLED / LAPSED), cascading with either instance,
so a chore edit's dropped days take their requests along. `lib/chores/swaps.ts`: kids only, to
another kid of the household (no pool check, as a grown-up's Give to has none); one open request
per chore. Accepting claims the request first (so two taps can't both run it), then moves each chore
with a guarded update (still pending, whose it was, on the day recorded); if either fails the
transaction rolls back and the request is LAPSED. Open requests are re-checked when shown (done,
moved, given away, past) and lapsed. Grown-ups see "swapped from Ivy" on a moved chore
(`swappedFrom`). Least-assigned rotation counts a swapped chore for its new kid, as a Give to does.
Fable's review of 70c: open swaps keep matching after a change of zone (their days join the stored
days that move); a kid's tick that waits isn't celebrated as paid and says "Waiting for a grown-up's
check" at once; grown-ups see the kids' open requests (**Swaps asked**, read only, the owner's "see
the swap"); "swapped from" ends when a grown-up gives the chore back; each row's buttons are named
for their chore; history says "marked it done, for a grown-up to check" and "checked it: OK" or "not
yet", and the export says WAITING FOR CHECK; an answer to a request that's gone says so rather than
"lapsed". Deal, No thanks and Cancel aren't destructive (nothing is deleted, a request can be asked
again), so they don't ask first. Left as is: two asks at the same moment can both be recorded (the
second one's accept lapses on the guards); a request that lapsed just drops off the asker's list.

### 70d — Gift ideas and the pet's no-school days

**Gift ideas:** `GiftIdea` (household, person, text, added by, given), migration
`20261205130000_gift_ideas_no_school`; `lib/gift-ideas.ts`. Grown-ups only, never the person they're
for (`canSeeGiftIdeas`; marking and removing also refuse the viewer's own by id). The person page's
card adds, marks **Given** (kept, crossed off) and removes (asks first). The birthday reminder adds
"· 2 gift ideas saved" (`planDates` takes counts from `openGiftIdeaCounts`): a deviation from the
scope's "lists up to three", because the title is what Teams and email carry; the ideas are a tap
away on the page it links to. **Backups v18:** `giftIdeas`, leaving out the ones for whoever takes
the file (`BackupHooks.takenBy`, set by the download and restore routes); a restore replaces them
except the restorer's own, which no file they take can hold. The accepted versions now list every
one up to the current (70c's bump had dropped 16; a test checks the run). **No-school days:**
`lib/pet/no-school.ts` (`isNoSchoolTitle`: whole words, and a title naming an event at school, like
"Holiday Concert" or "Spring Break book fair", isn't a day off; `noSchoolDays` spreads all-day
events over their days, at most a month each). `getCareHours(householdId, personId)` reads cached
all-day events from the family's feeds and the pet's kid's (45 days back, for a long catch-up) when
`Household.petNoSchoolDays` is on (default); `localTime` now gives the local day, and `isCareMinute`,
`careMinutes` and `careHoursToday` treat those days as weekends. The switch sits under Settings →
Apps → Pet care hours, and is in backups.
Fable's review of 70d: the no-school check now leaves school days alone when a title names the
return, the last or first day, a short day or an event ("Return from Winter Break", "Holiday Spirit
Week", "Early Release"), and knows more days off (public holidays by name, recess, snow days, staff
development, "No Students", district closed); a break over a month is left out rather than cut off
partway. The restore preview counts the gift ideas it replaces and says why the file-taker's own
can't come back; the feed read is cached per request and day, skipped on Settings, and `getMyPet`
passes its `now` through; idea counts are scoped to the household; `GiftIdea` gets a household
index (migration `20261205140000_gift_idea_household_index`). Tests: a restore by someone keeps
theirs without doubling, and the realistic titles both ways.

### 70e — Money

**Search every month:** `ActivityFilters.q` (`searchTerm`, 2 to 80 letters); with one, `activityWhere`
drops the month and matches merchant name, the bank's words, payee, merchant key or memo
(`matchWhere`), surprises hidden as ever; the page's search form keeps the account and category,
hides the month steps and says "every month". **Running ahead:** `runningAhead` (pure, in
`budget.ts`): this month, a budget with carry, past half and more than 15 points ahead of the share
of the month gone, not over; a line's status AHEAD (yellow badge and bar). Money's home shows each
jar's lines running ahead or over (`jarBudgetFlags`, the Budget page's way with carry). **The year:**
`lib/finance/year.ts` (`yearSummary` sums Trends' months, so it agrees with Budget; `yearCsv`, a row
per category with its months) and `year-load.ts`; Trends → **The year by category**
(`/finances/[jar]/trends/year?year=`) and its spreadsheet route, posted from the page like the jar's
other one and noted in the jar's history (`EXPORTED` with `year`). **Merging:**
`mergeStatementAccount` (`lib/finance/merge-accounts.ts`), one transaction: a MANUAL account into a
SIMPLEFIN one in the same jar, same currency, neither left out; a row the feed account already
holds under the same id becomes its DUPLICATE (renamed so the move doesn't collide); rows, imports
and questions move across, import layouts join, balance days go, the account is deleted, then the
duplicate check runs. Jar history `ACCOUNTS_MERGED` (migration `20261206120000_accounts_merged`).
**Faster syncs:** `dedupeAccount` takes `since` (a sync's window start, an import's first new row)
and compares rows from five days before it; `categorizeJar` takes `since` too and files only rows
from then on plus any not filed yet, while refund pairing still looks back over the whole jar. A rule
change, a category edit, the page's tidy-up and a merge still work over everything.
Fable's review of 70e: a search ANDs the surprise filter instead of spreading over it (both were
ORs, so the search's replaced it and a member could find a surprise hidden from them; tests now
check the filter is there and that a search finds nothing hidden); a merge's clashing row carries
what a person set to the row it folds into, and finds clashes in one lookup; a sync files from its
window's first day, not its first instant; the month's spreadsheet button hides during a search;
the year's empty note counts surprises and its download notes rows, not lines; the merge list shows
only accounts with a feed account in their currency. Tests for the duplicate check's window, a
merge clash and a surprise in the year. Left as is: Money's page reads each jar's month (a family
has a jar or three).

### 70f — School feeds

**Several kids:** `SchoolFeed.forFamily` and `SchoolFeedKid` (feed, person), migration
`20261206130000_school_feed_kids`, which moves each feed's old kid into the join table (no kid: the
family's) and drops `kidPersonId`. Family is explicit, so a feed whose last kid is deleted (the join
rows cascade) shows to grown-ups only, "Nobody's yet", and never widens. `lib/school/feeds/scope.ts`:
`feedScope(studentId)` (the family's or the ones they're on; grown-ups looking at everyone, all),
`FEED_WHO`, `feedKids`, `feedForWords`; used by the calendar's `loadSchoolEvents`, School's
`getUpcomingSchoolEvents`, search and the pet's no-school days (written out there, Pet can't import
School). Adding a calendar that's already there for another kid joins that kid to it; **Who it's for**
on the feeds page sets the family or any kids. **The fold:** `foldFeedEvents` (same title ignoring
case and spacing, start, end and all-day flag; a family feed's copy makes it the family's), on both
loaders. Agenda items carry `whoIds`; `itemsForPerson` shows an item for several people to each
of them, and `studentId` (link, colour) is set only when there's exactly one. School shows
"Ivy & Max", or the feed's name for the family's. Feeds stay out of backups.
Fable's review of 70f: the fold takes a family feed's copy first whatever order the rows come in,
so a shared event is labelled by the family's calendar; someone who left the household drops off a
calendar's kids (their rows stay, for coming back) and an item still for one kid stays theirs in the
filter; a calendar is only ever for kids (or someone with school details), as School lists them;
kids ticked with "Whole family" are kept; adding a calendar again for a kid already on it says so;
search folds too. Tests for the actions' household scoping and the join.

### After Phase 70: Undo that stays, and menus that close

On Overdue and Upcoming (Chores and Meds) a done card leaves the list, and on Home it folds under
"✓ done", the moment the save lands, so its own Undo flashed for an instant. The board's
`MilestoneToastBoard` now also holds an Undo bar (`useReportUndo`): the card hands over its title
and undo, and the bar stays ten seconds, held while the pointer or focus is on it. Meds gets the
wrapper too. `MoreMenu` (the status pill, every ⋯): tapping its own button again closes it; before,
the menu's blur closed it first and the same tap opened it again.

### After Phase 70: a polish sweep (menus and feedback)

The owner asked for more fixes like the Undo bar: small things that make the app feel finished.
Three read-only sweeps (feedback that vanishes, menus, forms after a submit) found them; this
batch takes the first two. The forms batch (errors that wipe what was typed) follows on its own.

- **One Escape, one layer.** The bell, profile menu and app launcher listen for Escape in the
  capture phase and mark it handled, so an item panel or look sheet underneath stays open. The look
  sheet marks its own Escape handled and the item panel waits while it's open (`[data-look-sheet]`).
- **Undo bar for more than Done.** `UndoReport` takes a `verb`: **Missed** on an overdue card
  ("marked missed") and **Move to tomorrow** ("moved to tomorrow", undone by Move back) hand the
  bar their undo. A refused Move back shows "Couldn't undo that".
- **Say what happened when a row leaves.** A grown-up's OK / Not yet and a kid's Deal / No thanks
  redirect with `?check=` / `?swap=taken|declined`, and the page says so; the check note shows even
  with nothing left to check.
- **Status pill keeps focus while saving.** `MoreMenu` and `StatusPill` take `busy`: the button
  stays (aria-disabled, no popover) instead of turning into a plain label, which dropped keyboard
  focus to the page.
- **Picker:** a second tap on an open list closes it (a tap that focuses the box still opens it).
- **Bell:** a fresh "Loading…" each time it opens, not last time's list, and a failed load says so
  in the panel instead of reaching the error page.
- **Bulk bar:** a failed bulk change keeps the ticks, so its message used to show nowhere; it shows
  in the bar now.
- **Smaller ones:** cancelling Sick day puts focus back on its menu button; a long ⋯ menu scrolls
  inside itself on a phone; a failed sign-out says so; a kid's picture tile says when its add failed;
  the grocery list's Undo bar stays ten seconds like the chores one (was six); the odometer's
  "Saved ✓" stays four seconds and is announced, and fuel and contact-log notes stay four seconds.
### After Phase 70: a polish sweep (forms)

The second batch of the polish sweep: what forms do after a submit.

- **A refused save keeps what was typed.** React resets an uncontrolled form after every action
  that doesn't throw, and an action that returns `{ error }` doesn't, so a duplicate meal name
  wiped twelve ingredient lines, a bad cost at the pump cleared the odometer and gallons, and "Take
  some back" flipped to "Give" on the next Save. `useKeptActionState` (`components/keep-typed.ts`)
  wraps `useActionState` and cancels the reset (a cancellable event) after a refusal; a success
  still clears. The Picker skips a cancelled reset. On the meal, fuel, repair, chore, person,
  contact log (new and edit), gift idea, Add event and sticker forms. AGENTS.md "Forms" says to use
  it for new ones.
- **The grocery box keeps a name it can't file** ("🥚" alone) and says why, instead of clearing
  and adding nothing. `addTypedItem` returns the reason; `addItem` stays a plain form action.
- **Number pads.** Every `type="number"` input says `inputMode` (numeric, or decimal where it
  takes fractions), so a phone shows the number pad. A chore's "every how many" and stickers have
  a floor.
- **Add rows keep focus.** After **+ Add** (the lists in Settings, gift ideas) focus goes back to
  the name box, so a phone keeps its keyboard for the next one.
- **Smaller ones:** a PIN box opened again doesn't say "PIN saved." from last time; **Sync now** and
  **Send a test** say when they fail instead of taking the page to the error screen.
