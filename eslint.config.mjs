import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Domain boundaries: each feature module (chores, groceries, people) owns its
// own lib/ + app/(app)/ tree and must not reach into another module's. Shared
// primitives (auth, authz, crypto, session, prisma, lib/people.ts, lib/graph,
// format, utils) stay import-from-anywhere because they're the kernel, not a
// domain. Register each new domain (meds, vehicle, school, finances, ...)
// here the same commit it's created — before it accumulates cross-imports.
// Cross-domain aggregators (lib/search.ts, lib/activity.ts, lib/bunson-facts.ts,
// app/(app)/search/**) are deliberately NOT registered as a domain here — unlike
// tasksKernel below, which IS registered so the boundary rule can stop it importing
// any single domain, these exist specifically to import every domain, so registering
// them the same way would forbid the imports they're built to make. The asymmetric
// half of that trade — no domain may import an aggregator back — is enforced instead
// by AGGREGATOR_IMPORT_PATTERNS below, appended to every domain's own restricted list.
// `files` is the domain's own zone (what the rule applies to). `restrict` is
// what that domain exposes to lint against — kept separate from `files`
// because `lib/people.ts` is a single shared kernel file, not a `lib/people/`
// folder, so the "people" domain has no lib zone to wall off.
const domains = {
  chores: {
    // The domain-agnostic pieces (recurrence, assignment, instance generation, board
    // queries) live in lib/tasks/, a shared kernel like lib/people.ts, so meds/vehicle can
    // use them too. lib/chores/ itself came back in Phase 11 for logic that genuinely IS
    // Chores-only (the weather-flag rule) — every other domain already has its own lib/
    // folder; Chores just hadn't needed one again until now.
    files: ["./lib/chores/**/*.{ts,tsx}", "./app/(app)/chores/**/*.{ts,tsx}", "./app/print/chores/**/*.{ts,tsx}"],
    restrict: [
      "@/lib/chores/*",
      "@/lib/chores",
      "@/app/(app)/chores/*",
      "@/app/(app)/chores",
      "@/app/print/chores/*",
      "@/app/print/chores",
    ],
  },
  meds: {
    files: ["./lib/meds/**/*.{ts,tsx}", "./app/(app)/meds/**/*.{ts,tsx}", "./app/print/meds/**/*.{ts,tsx}"],
    restrict: [
      "@/lib/meds/*",
      "@/lib/meds",
      "@/app/(app)/meds/*",
      "@/app/(app)/meds",
      "@/app/print/meds/*",
      "@/app/print/meds",
    ],
  },
  school: {
    files: ["./lib/school/**/*.{ts,tsx}", "./app/(app)/school/**/*.{ts,tsx}", "./app/print/school/**/*.{ts,tsx}"],
    restrict: [
      "@/lib/school/*",
      "@/lib/school",
      "@/app/(app)/school/*",
      "@/app/(app)/school",
      "@/app/print/school/*",
      "@/app/print/school",
    ],
  },
  vehicles: {
    // Every app/print/<domain> page lives outside (app) on purpose (see
    // components/print/print-shell.tsx) but is still its domain's own zone — an
    // unregistered file gets no boundary rule at all.
    files: [
      "./lib/vehicles/**/*.{ts,tsx}",
      "./app/(app)/vehicles/**/*.{ts,tsx}",
      "./app/print/vehicles/**/*.{ts,tsx}",
      "./components/vehicles/**/*.{ts,tsx}",
    ],
    restrict: [
      "@/lib/vehicles/*",
      "@/lib/vehicles",
      "@/app/(app)/vehicles/*",
      "@/app/(app)/vehicles",
      "@/app/print/vehicles/*",
      "@/app/print/vehicles",
      "@/components/vehicles/*",
      "@/components/vehicles",
    ],
  },
  groceries: {
    files: ["./lib/groceries/**/*.{ts,tsx}", "./app/(app)/groceries/**/*.{ts,tsx}", "./app/print/groceries/**/*.{ts,tsx}"],
    restrict: [
      "@/lib/groceries/*",
      "@/lib/groceries",
      "@/app/(app)/groceries/*",
      "@/app/(app)/groceries",
      "@/app/print/groceries/*",
      "@/app/print/groceries",
    ],
  },
  people: {
    files: ["./app/(app)/people/**/*.{ts,tsx}", "./app/print/people/**/*.{ts,tsx}"],
    restrict: ["@/app/(app)/people/*", "@/app/(app)/people", "@/app/print/people/*", "@/app/print/people"],
  },
  settings: {
    files: ["./app/(app)/settings/**/*.{ts,tsx}"],
    restrict: ["@/app/(app)/settings/*", "@/app/(app)/settings"],
  },
  // The task-engine kernel (lib/tasks/, components/tasks/) is importable by every domain
  // (`restrict: []` — nothing here is walled off from the others), but it must not import
  // any single domain's own code: that's exactly the bug an earlier draft of
  // components/tasks/task-instance-card.tsx had (importing app/(app)/chores/actions
  // directly), which would have made the shared Meds board silently call Chores' server
  // actions. This entry gives the kernel's own zone the same cross-domain rule everyone
  // else gets, so that mistake fails lint instead of shipping quietly.
  tasksKernel: {
    files: ["./lib/tasks/**/*.{ts,tsx}", "./components/tasks/**/*.{ts,tsx}"],
    restrict: [],
  },
  // Same reasoning as tasksKernel — getOrCreateActiveList/requestItemByName live here
  // (not in lib/groceries/) specifically so Meds' refill hook can call them without
  // reaching into the groceries domain, which only works if this file is itself barred
  // from reaching into any domain (including groceries) too.
  shoppingListKernel: {
    files: ["./lib/shopping-list.ts"],
    restrict: [],
  },
  // Same shape again — the National Weather Service client is a plain kernel file with no
  // domain of its own (weather isn't "owned" by Chores; lib/chores/weather-flag.ts is the
  // Chores-specific rule built ON TOP of this).
  weatherKernel: {
    files: ["./lib/weather.ts"],
    restrict: [],
  },
  // Phase 45.1: where home is (the ZIP code table, the admin actions that save it and the
  // picker). Settings, the guided setup and Chores all use it, so it's a kernel like weather.
  homeLocationKernel: {
    files: ["./lib/zip/**/*.{ts,tsx}", "./lib/home-location/**/*.{ts,tsx}", "./components/home-location.tsx"],
    restrict: [],
  },
  // Shared print chrome (Phase 13) — presentational only, no data fetching and no actions,
  // so `restrict: []` like weatherKernel; the zone exists so the print kernel itself can
  // never import a domain (every /print/<domain> page imports it, not the other way round).
  printKernel: {
    files: ["./components/print/**/*.{ts,tsx}"],
    restrict: [],
  },
  // The whole-household backup (Phase 16) reads every table through Prisma directly, not
  // through any domain's code, so it's a kernel zone: barred from importing a domain.
  backupKernel: {
    files: ["./lib/backup/**/*.{ts,tsx}"],
    restrict: [],
  },
  // Sentry (Phase 15): the ONLY zone allowed to import @sentry/* (see SENTRY_IMPORT_PATTERNS
  // below). Everything that reports to Sentry goes through lib/observability, so the
  // scrubbing config there can't be bypassed. The root instrumentation/sentry.*.config
  // files aren't in any zone and import the SDK directly to initialize it.
  observabilityKernel: {
    files: ["./lib/observability/**/*.{ts,tsx}"],
    restrict: [],
  },
  // Phase 20: the Sticker Store (route stays /points), replacing Phase 11's pointsKernel —
  // two entries covering the same files would silently override each other. Points/rewards
  // read across Chores AND Meds through lib/tasks (kernel), so the store imports no domain.
  // `restrict` is non-empty on purpose: domains link to /points rather than calling its
  // actions. Home (app/(app)/page.tsx) and the (app) layout are unzoned aggregators, like
  // /search, so they may read lib/store/queries for the orders card and BigHome's goal.
  store: {
    files: ["./lib/store/**/*.{ts,tsx}", "./app/(app)/points/**/*.{ts,tsx}"],
    restrict: ["@/lib/store/*", "@/lib/store", "@/app/(app)/points/*", "@/app/(app)/points"],
  },
  notificationsKernel: {
    files: ["./lib/notifications.ts"],
    restrict: [],
  },
  // Phase 21: alert delivery (Teams, email). Kernel-only imports (prisma, crypto, the
  // graph app token, observability), so the store and later features can call it.
  alertsKernel: {
    files: ["./lib/alerts/**/*.{ts,tsx}"],
    restrict: [],
  },
  // Phase 24: the document reader (Azure AI Document Intelligence). Receipts today, bills or
  // other paperwork later, so it's a kernel any domain can use and it can't reach into one.
  documentsKernel: {
    files: ["./lib/documents/**/*.{ts,tsx}"],
    restrict: [],
  },
  // Phase 36: the app switches (Settings → Apps). Every domain asks whether it's on, and every
  // page of a switchable app starts with its guard, so, like the other kernels, none of these
  // may import a domain back.
  appSwitchesKernel: {
    files: ["./lib/app-switches.ts", "./lib/app-guard.ts", "./components/app-off.tsx", "./components/app-tile.tsx"],
    restrict: [],
  },
  // Phase 25: money jars. Jar-scoped and members-only (lib/finance/access.ts), so nothing
  // else may import it; see FINANCE_AGGREGATOR_GUARD for the cross-domain surfaces.
  finances: {
    files: ["./lib/finance/**/*.{ts,tsx}", "./app/(app)/finances/**/*.{ts,tsx}"],
    restrict: ["@/lib/finance/*", "@/lib/finance", "@/app/(app)/finances/*", "@/app/(app)/finances"],
  },
};

const otherDomainPatterns = (owner) =>
  Object.entries(domains)
    .filter(([name]) => name !== owner)
    .flatMap(([, domain]) => domain.restrict);

// A single domain importing one of these back in would reintroduce exactly the
// cross-domain coupling the boundary rule exists to prevent (e.g. chores/actions.ts
// pulling in lib/search.ts, which itself reads groceries/vehicles/meds). A domain
// page that wants search or activity data renders it from a shared surface (Home,
// the /search route) instead of importing the aggregator directly.
// lib/background (Phase 27) runs every domain's background jobs, so it's one too.
const AGGREGATOR_IMPORT_PATTERNS = ["@/lib/search", "@/lib/activity", "@/lib/bunson-facts", "@/app/(app)/data/catalog", "@/lib/calendar", "@/lib/calendar/*", "@/lib/calendar-sync", "@/lib/calendar-sync/*", "@/lib/background"];

// Only observabilityKernel may import the Sentry SDK: a direct import elsewhere could send
// data without going through lib/observability's scrubbers.
const SENTRY_IMPORT_PATTERNS = ["@sentry/*"];

const domainBoundaryRules = Object.keys(domains).map((owner) => ({
  files: domains[owner].files,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: otherDomainPatterns(owner),
            message:
              `Domain boundary: ${owner} may not import from another feature module. ` +
              "Share code via lib/ kernel modules (lib/people.ts, lib/graph, auth, session, prisma) instead.",
          },
          {
            group: AGGREGATOR_IMPORT_PATTERNS,
            message:
              `Domain boundary: ${owner} may not import a cross-domain aggregator ` +
              "(lib/search, lib/activity, lib/bunson-facts, the /data export catalog) — those read across every " +
              "domain on purpose, so importing one back into a single domain would " +
              "reintroduce the coupling this rule exists to prevent.",
          },
          ...(owner === "observabilityKernel"
            ? []
            : [
                {
                  group: SENTRY_IMPORT_PATTERNS,
                  message:
                    "Import Sentry helpers from @/lib/observability, not @sentry/* directly, so " +
                    "every event goes through the privacy scrubbers there.",
                },
              ]),
        ],
      },
    ],
  },
}));

// The Sentry restriction for every file that ISN'T in a domain zone (lib/session.ts,
// lib/graph, app/api, components/, ...). Fable's implementation review caught that the
// zone rules alone left 45 files free to import @sentry/* directly. It must come BEFORE the
// zone rules: in flat config a later no-restricted-imports for the same file replaces an
// earlier one, and the zone rules already carry this same pattern.
const globalSentryRestriction = {
  files: ["**/*.{ts,tsx,mjs}"],
  ignores: [
    "lib/observability/**",
    "instrumentation.ts",
    "instrumentation-client.ts",
    "sentry.server.config.ts",
    "sentry.edge.config.ts",
    "next.config.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: SENTRY_IMPORT_PATTERNS,
            message:
              "Import Sentry helpers from @/lib/observability, not @sentry/* directly, so " +
              "every event goes through the privacy scrubbers there.",
          },
        ],
      },
    ],
  },
};

// Phase 25: the cross-domain surfaces (search, activity, Bunson's facts, exports, Home and
// the app shell) read every domain on purpose, but must never read money: a jar is
// members-only, and these show data to whoever is looking. Comes after the Sentry rule
// because a later no-restricted-imports for the same file replaces the earlier one.
const FINANCE_AGGREGATOR_GUARD = {
  files: ["lib/search.ts", "lib/activity.ts", "lib/bunson-facts.ts", "app/(app)/data/**/*.{ts,tsx}", "app/(app)/page.tsx", "app/(app)/layout.tsx", "app/(app)/search/**/*.{ts,tsx}", "lib/calendar/**/*.{ts,tsx}", "lib/calendar-sync/**/*.{ts,tsx}", "app/(app)/calendar/**/*.{ts,tsx}"],
  // lib/backup is a zone of its own, whose domain rule already forbids lib/finance. Phase 28:
  // the one sanctioned meeting point is app/api/backup/* (unzoned), which hands lib/backup
  // lib/finance/backup.ts's sealMoney so the household file carries jars sealed, never
  // readable (owner's call).
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["@/lib/finance", "@/lib/finance/*", "@/app/(app)/finances", "@/app/(app)/finances/*"], message: "Money jars are members-only: shared surfaces (search, activity, Home, exports, backups) must not read them." },
          { group: SENTRY_IMPORT_PATTERNS, message: "Import Sentry helpers from @/lib/observability, not @sentry/* directly." },
        ],
      },
    ],
  },
};

// Past trips (Groceries) shows which jar paid for a trip (owner's call, 2026-10-09). The one money read
// allowed outside Money is lib/finance/trip-links.ts, which applies the money gate itself
// (own sign-in, jar members only, surprises hidden). This replaces the groceries zone rule for
// that one page: everything else stays forbidden, money included.
const TRIP_LINKS_EXCEPTION = {
  files: ["app/(app)/groceries/trips/page.tsx"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: otherDomainPatterns("groceries").filter((p) => !p.includes("finance")),
            message: "Domain boundary: groceries may not import from another feature module.",
          },
          {
            regex: "^@/(lib/finance(?!/trip-links$)|app/\\(app\\)/finances)",
            message: "Only @/lib/finance/trip-links may be read from Groceries; money stays members-only.",
          },
          { group: AGGREGATOR_IMPORT_PATTERNS, message: "Domain boundary: groceries may not import a cross-domain aggregator." },
          { group: SENTRY_IMPORT_PATTERNS, message: "Import Sentry helpers from @/lib/observability, not @sentry/* directly." },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalSentryRestriction,
  ...domainBoundaryRules,
  FINANCE_AGGREGATOR_GUARD,
  TRIP_LINKS_EXCEPTION,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code's side sessions keep their own checkouts here (git-ignored); each lints itself.
    ".claude/**",
  ]),
]);

export default eslintConfig;
