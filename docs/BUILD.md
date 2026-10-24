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
