/**
 * Phase 19: the app catalog behind the nine-dot launcher, the nav rail and the
 * phone bottom bar (no per-person pins since 2026-10-09: one fixed order for everyone). Pure and client-safe on purpose — it must not import lib/authz.ts
 * (which pulls in next/headers), so callers pass `isAdult` in.
 *
 * Hiding an app here is cosmetic only. Every page still does its own authorization.
 * Phase 36's on/off switches live here too (pure); lib/app-switches.ts reads and saves them.
 */
export type AppGroup = "everyday" | "home";

export type AppDef = {
  id: string;
  label: string;
  emoji: string;
  href: string;
  group: AppGroup;
  /** Hidden from kids' launcher, rail and bottom bar. */
  adultOnly: boolean;
  /** Tile background (light tint behind the emoji). */
  tint: string;
};

/**
 * In the order they're listed everywhere (rail, launcher, phone bar), top to bottom. Fixed on
 * purpose (owner's call, 2026-10-09): the day's plan and the people first, admin last, and nothing
 * moves around. Microsoft 365 admin center style: the rail shows the first few, "Show more"
 * unfolds the rest in place, and the launcher has them all.
 */
export const APPS: readonly AppDef[] = [
  { id: "home", label: "Home", emoji: "🏡", href: "/", group: "everyday", adultOnly: false, tint: "#FFF6D6" },
  { id: "people", label: "People", emoji: "👥", href: "/people", group: "everyday", adultOnly: false, tint: "#FDE2E8" },
  { id: "calendar", label: "Calendar", emoji: "📅", href: "/calendar", group: "everyday", adultOnly: false, tint: "#F0EBFF" },
  { id: "chores", label: "Chores", emoji: "🧹", href: "/chores", group: "everyday", adultOnly: false, tint: "#FFF1C2" },
  { id: "meds", label: "Meds", emoji: "💊", href: "/meds", group: "everyday", adultOnly: false, tint: "#FFE3DE" },
  { id: "groceries", label: "Groceries", emoji: "🛒", href: "/groceries", group: "everyday", adultOnly: false, tint: "#EAF6DA" },
  { id: "school", label: "School", emoji: "🎒", href: "/school", group: "everyday", adultOnly: false, tint: "#FFE9D6" },
  { id: "money", label: "Money", emoji: "💰", href: "/finances", group: "everyday", adultOnly: true, tint: "#EAF6DA" },
  { id: "store", label: "Store", emoji: "🛍️", href: "/points", group: "everyday", adultOnly: false, tint: "#E6F4FF" },
  { id: "pet", label: "Pet", emoji: "🥚", href: "/pet", group: "everyday", adultOnly: false, tint: "#F3E8FF" },
  { id: "cars", label: "Cars", emoji: "🚐", href: "/vehicles", group: "home", adultOnly: true, tint: "#E6F4FF" },
  { id: "garage", label: "Garage", emoji: "🔧", href: "/vehicles/supplies", group: "home", adultOnly: true, tint: "#F1EADB" },
  { id: "data", label: "Data", emoji: "💾", href: "/data", group: "home", adultOnly: true, tint: "#EEF1F4" },
  { id: "settings", label: "Settings", emoji: "⚙️", href: "/settings", group: "home", adultOnly: true, tint: "#FFFFFF" },
];

export const APP_GROUPS: { id: AppGroup; label: string }[] = [
  { id: "everyday", label: "Everyday" },
  { id: "home", label: "House & settings" },
];

/**
 * Phase 36: the apps a family can turn off (Settings → Apps), in the fixed order. Home,
 * People, Data and Settings are always on: the app is unusable without them. Garage has no
 * switch of its own, it's part of Cars (APP_FOLLOWS). Turning one off hides it everywhere and
 * pauses its background work; nothing is deleted, and turning it back on brings it all back.
 */
export const SWITCHABLE_APPS = ["calendar", "chores", "meds", "groceries", "school", "money", "store", "pet", "cars"] as const;
export type SwitchableAppId = (typeof SWITCHABLE_APPS)[number];

/** Apps that go wherever another app goes. */
export const APP_FOLLOWS: Readonly<Record<string, SwitchableAppId>> = { garage: "cars" };

export function isSwitchableApp(id: string): id is SwitchableAppId {
  return (SWITCHABLE_APPS as readonly string[]).includes(id);
}

/**
 * What a household's stored `disabledApps` means: switchable ids only (an unknown or
 * always-on id, say from an older backup or a hand edit, is ignored), each once, in the
 * fixed order.
 */
export function cleanDisabledApps(raw: readonly string[] | null | undefined): SwitchableAppId[] {
  const set = new Set(raw ?? []);
  return SWITCHABLE_APPS.filter((id) => set.has(id));
}

/** Whether app `id` is on for a family with these apps turned off. Garage follows Cars. */
export function isAppOn(disabled: readonly string[], id: string): boolean {
  const owner = APP_FOLLOWS[id] ?? id;
  return !isSwitchableApp(owner) || !disabled.includes(owner);
}

/** The turned-off list after switching one app on or off (cleaned, so it never grows junk). */
export function switchApp(disabled: readonly string[], id: SwitchableAppId, on: boolean): SwitchableAppId[] {
  return cleanDisabledApps(on ? disabled.filter((x) => x !== id) : [...disabled, id]);
}

/** Whether app `id` is for grown-ups only: lib/app-guard.ts turns a kid away from its pages. */
export function isAdultOnlyApp(id: string): boolean {
  return APPS.some((a) => a.id === id && a.adultOnly);
}

/**
 * What's off for this viewer: the family's turned-off apps, and for a kid the grown-up apps
 * too. For pages that mix apps (Home, search, Bunson's facts), so a kid is never shown a card
 * or link the app guard would turn away.
 */
export function appsOffFor(isAdult: boolean, disabled: readonly string[]): string[] {
  if (isAdult) return [...disabled];
  return [...new Set([...disabled, ...APPS.filter((a) => a.adultOnly).map((a) => APP_FOLLOWS[a.id] ?? a.id)])];
}

/** The rail, launcher and phone bar: grown-up apps only for grown-ups, turned-off apps for no one. */
export function visibleApps(isAdult: boolean, disabled: readonly string[]): AppDef[] {
  return APPS.filter((a) => (isAdult || !a.adultOnly) && isAppOn(disabled, a.id));
}

/** How many apps the rail shows before "Show more", and up to how many it just shows them all. */
export const RAIL_FIRST = 6;
// Nine since Phase 47, so a kid (who has nine apps with Pet) still sees every one without "Show more".
const RAIL_ALL_UP_TO = 9;
/** The phone's bottom bar: the first few, then "All apps". */
export const BOTTOM_BAR_COUNT = 4;

/**
 * The rail, in the fixed order: the first RAIL_FIRST apps, and the rest behind "Show more"
 * (a short list, like a kid's, is just shown whole). Folded, the app you're in still shows
 * under the divider so its highlight never disappears.
 */
export function railApps(apps: readonly AppDef[], current: string | null, open: boolean): { first: AppDef[]; more: AppDef[]; folded: boolean } {
  if (apps.length <= RAIL_ALL_UP_TO) return { first: [...apps], more: [], folded: false };
  const first = apps.slice(0, RAIL_FIRST);
  const rest = apps.slice(RAIL_FIRST);
  return { first, more: open ? rest : rest.filter((a) => a.id === current), folded: true };
}

/** The app the current path belongs to: longest href match on a segment boundary. */
export function activeAppId(pathname: string): string | null {
  let best: AppDef | null = null;
  for (const app of APPS) {
    const hit =
      app.href === "/"
        ? pathname === "/"
        : pathname === app.href || pathname.startsWith(app.href + "/");
    if (hit && (!best || app.href.length > best.href.length)) best = app;
  }
  return best?.id ?? null;
}

/**
 * Whether a link inside the app leads somewhere that's on: the app its path belongs to, by
 * the same rule as the rail's highlight. Links outside every app (search, notifications) are
 * always on. For feeds that mix apps (Home's recent activity).
 */
export function isLinkOn(disabled: readonly string[], href: string): boolean {
  const id = activeAppId(href.split(/[?#]/)[0]);
  return id === null || isAppOn(disabled, id);
}

/**
 * isLinkOn as prefixes a database can match: an href is off when it is one of these paths
 * or continues one with "/", "?" or "#". The same answer for every app's links, since the
 * only app nested in another (Garage, under Cars) goes wherever Cars goes.
 */
export function offLinkPrefixes(disabled: readonly string[]): { exact: string[]; startsWith: string[] } {
  const paths = APPS.filter((a) => a.href !== "/" && !isAppOn(disabled, a.id)).map((a) => a.href);
  return { exact: paths, startsWith: paths.flatMap((p) => [`${p}/`, `${p}?`, `${p}#`]) };
}

