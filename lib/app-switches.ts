import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { cleanDisabledApps, isAppOn, isSwitchableApp, switchApp, type SwitchableAppId } from "@/lib/apps";
import { getHouseholdRow } from "@/lib/household-settings";

/**
 * Phase 36: reading and saving a family's app switches (Settings → Apps). The rules are pure,
 * in lib/apps.ts; this is the database side. A kernel: any domain may ask whether it's on,
 * and this imports no domain back (eslint.config.mjs).
 *
 * Where the switch is checked: the (app) layout's nav, the first line of every page of a
 * switchable app (lib/app-guard.ts, which sends you to the friendly "turned off" page), Home,
 * search, the calendar week, Bunson, the bell, exports, and every piece of work an app starts
 * on its own (bank syncs, alerts, feeds, the Outlook sync, recall lookups), which checks here
 * where it starts, whoever or whatever started it.
 *
 * The column is NOT NULL with an empty default, so `householdWithAppOn` below never drops a
 * family by a NULL comparison.
 */

/** The household's turned-off apps, cleaned. Once per request. */
export const getDisabledApps = cache(async (householdId: string): Promise<SwitchableAppId[]> => {
  // The same per-request read of the household row as its settings and look (Phase 39).
  const row = await getHouseholdRow(householdId);
  return cleanDisabledApps(row?.disabledApps);
});

/** Whether app `id` is on for this household (Garage follows Cars). */
export async function appOn(householdId: string, id: string): Promise<boolean> {
  return isAppOn(await getDisabledApps(householdId), id);
}

/**
 * A Prisma `where` on Household for background work: only families with this app on. Through
 * a relation, e.g. `{ household: householdWithAppOn("money") }`.
 */
export function householdWithAppOn(id: SwitchableAppId): Prisma.HouseholdWhereInput {
  return { NOT: { disabledApps: { has: id } } };
}

/** The apps whose items the Outlook calendar sync writes; switching one changes what it should hold. */
const CALENDAR_SOURCES: readonly SwitchableAppId[] = ["chores", "meds", "school", "cars"];

export type SetAppResult = { ok: true; disabled: SwitchableAppId[] } | { ok: false; error: string };

/**
 * Turns one app on or off. `appId` comes from the browser, so it's checked against the
 * switchable list (Home, People, Data, Settings and Garage have no switch). The row is
 * locked so two admins flipping different apps at once can't undo each other. When the
 * Outlook sync's sources change, its options are marked changed so the next sync (Home's,
 * within minutes) adds or takes away those events instead of waiting out its half hour.
 */
export async function setAppOn(householdId: string, appId: unknown, on: unknown): Promise<SetAppResult> {
  if (typeof appId !== "string" || !isSwitchableApp(appId)) return { ok: false, error: "That app can't be turned off." };
  if (typeof on !== "boolean") return { ok: false, error: "Pick on or off." };
  const disabled = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "household" WHERE "id" = ${householdId} FOR UPDATE`;
    const row = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { disabledApps: true } });
    const before = cleanDisabledApps(row.disabledApps);
    const next = switchApp(before, appId, on);
    if (next.length === before.length && next.every((id, i) => id === before[i])) return before;
    await tx.household.update({ where: { id: householdId }, data: { disabledApps: next } });
    if (CALENDAR_SOURCES.includes(appId)) {
      await tx.calendarSync.updateMany({ where: { householdId }, data: { optionsChangedAt: new Date() } });
    }
    return next;
  });
  return { ok: true, disabled };
}
