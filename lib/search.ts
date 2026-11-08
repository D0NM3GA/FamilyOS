import { prisma } from "@/lib/prisma";
import { itemParam } from "@/lib/work-items/history";
import { listPeople, fullName } from "@/lib/people";
import { searchProductsLocal } from "@/lib/groceries/queries";
import { formatMonthDay, toISODate, formatEventWhen } from "@/lib/format";
import { isAppOn } from "@/lib/apps";
import { getRewardWords } from "@/lib/household-settings";

export type SearchResultItem = { id: string; label: string; sublabel?: string; href: string };
export type SearchGroup = { title: string; items: SearchResultItem[] };

const RESULTS_PER_GROUP = 10;

/**
 * Household-scoped search across every domain, composing each domain's own existing
 * queries (lib/people.ts's listPeople, lib/groceries/queries.ts's searchProductsLocal)
 * rather than duplicating their filters. Deliberately NOT registered as a domain in
 * eslint.config.mjs's `domains` map — like lib/tasks/ ("tasksKernel"), this is a
 * cross-cutting kernel aggregator that every domain's data flows into, not a domain of
 * its own, so it's exempt from the "may not import another feature module" boundary rule.
 *
 * `viewerIsAdult` controls whether Chores/Meds/Vehicles results link to their edit page or
 * their board — kids can't reach the edit routes (see each domain's own inline "Only
 * adults can…" gate), so a kid's search result has to land somewhere they can actually use.
 */
export async function searchHousehold(
  householdId: string,
  query: string,
  /** Phase 36: `disabledApps` (the family's turned-off apps) aren't searched at all. */
  opts: { viewerIsAdult: boolean; disabledApps: readonly string[]; viewerId?: string; now?: Date },
): Promise<SearchGroup[]> {
  const term = query.trim();
  if (!term) return [];
  const on = (app: string) => isAppOn(opts.disabledApps, app);

  const [people, chores, meds, products, vehicles, maintenanceItems, schoolWork, rewards, dates, notes, schoolTasks] = await Promise.all([
    listPeople(householdId, { query: term }),
    on("chores")
      ? prisma.taskDefinition.findMany({
          where: {
            householdId,
            domain: "CHORE",
            active: true,
            title: { contains: term, mode: "insensitive" },
          },
          take: RESULTS_PER_GROUP,
          orderBy: { title: "asc" },
        })
      : [],
    on("meds")
      ? prisma.taskDefinition.findMany({
          where: {
            householdId,
            domain: "MED",
            active: true,
            title: { contains: term, mode: "insensitive" },
            // Phase 66a: a kid finds only their own medicines (none without an id to go by).
            ...(opts.viewerIsAdult ? {} : { assignees: { some: { id: opts.viewerId ?? "" } } }),
          },
          take: RESULTS_PER_GROUP,
          orderBy: { title: "asc" },
        })
      : [],
    on("groceries") ? searchProductsLocal(householdId, term, RESULTS_PER_GROUP) : [],
    on("cars")
      ? prisma.vehicle.findMany({
          where: {
            householdId,
            active: true,
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { make: { contains: term, mode: "insensitive" } },
              { model: { contains: term, mode: "insensitive" } },
            ],
          },
          take: RESULTS_PER_GROUP,
          orderBy: { name: "asc" },
        })
      : [],
    on("cars")
      ? prisma.vehicleMaintenanceItem.findMany({
          where: {
            vehicle: { householdId, active: true },
            active: true,
            kind: { not: "REPAIRS" },
            title: { contains: term, mode: "insensitive" },
          },
          include: { vehicle: { select: { id: true, name: true } } },
          take: RESULTS_PER_GROUP,
          orderBy: { title: "asc" },
        })
      : [],
    // Adults only: search has no per-viewer scoping, and a kid sees only their own school tab.
    opts.viewerIsAdult && on("school")
      ? prisma.schoolAssignment.findMany({
          where: {
            profile: { person: { householdId } },
            OR: [{ title: { contains: term, mode: "insensitive" } }, { className: { contains: term, mode: "insensitive" } }],
          },
          select: { id: true, title: true, className: true, profile: { select: { personId: true, person: { select: { firstName: true } } } } },
          take: RESULTS_PER_GROUP,
          orderBy: { createdAt: "desc" },
        })
      : [],
    on("store")
      ? prisma.reward.findMany({
          where: { householdId, active: true, title: { contains: term, mode: "insensitive" } },
          select: { id: true, title: true, emoji: true, pointCost: true },
          take: RESULTS_PER_GROUP,
          orderBy: { title: "asc" },
        })
      : [],
    // "Anniversary", "Gotcha day": a date's own label. Birthdays come up under the person.
    prisma.importantDate.findMany({
      where: { person: { householdId }, label: { contains: term, mode: "insensitive" } },
      select: { id: true, label: true, month: true, day: true, person: { select: { id: true, firstName: true, lastName: true } } },
      take: RESULTS_PER_GROUP,
    }),
    // What was said on a call or visit: grown-ups' notes, so grown-ups only (same as school).
    opts.viewerIsAdult
      ? prisma.interactionLog.findMany({
          where: { person: { householdId }, note: { contains: term, mode: "insensitive" } },
          select: { id: true, note: true, occurredAt: true, person: { select: { id: true, firstName: true, lastName: true } } },
          take: RESULTS_PER_GROUP,
          orderBy: { occurredAt: "desc" },
        })
      : [],
    opts.viewerIsAdult && on("school")
      ? prisma.schoolTask.findMany({
          where: { householdId, title: { contains: term, mode: "insensitive" } },
          select: { id: true, title: true, status: true, kidPersonId: true, kid: { select: { firstName: true } } },
          take: RESULTS_PER_GROUP,
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);

  const groups: SearchGroup[] = [];
  const { viewerIsAdult } = opts;

  if (people.length > 0) {
    groups.push({
      title: "People",
      items: people.slice(0, RESULTS_PER_GROUP).map((p) => ({
        id: p.id,
        label: fullName(p),
        sublabel: p.email ?? undefined,
        href: `/people/${p.id}`,
      })),
    });
  }

  if (chores.length > 0) {
    groups.push({
      title: "Chores",
      items: chores.map((c) => ({
        id: c.id,
        label: c.title,
        href: viewerIsAdult ? `/chores/${c.id}/edit` : "/chores",
      })),
    });
  }

  if (meds.length > 0) {
    groups.push({
      title: "Meds",
      items: meds.map((m) => ({
        id: m.id,
        label: m.title,
        href: viewerIsAdult ? `/meds/${m.id}/edit` : "/meds",
      })),
    });
  }

  if (products.length > 0) {
    groups.push({
      title: "Groceries",
      items: products.map((p) => ({
        id: p.id,
        label: p.name,
        sublabel: p.brand ?? undefined,
        href: `/groceries/pantry?item=${p.id}`,
      })),
    });
  }

  if (vehicles.length > 0) {
    groups.push({
      title: "Vehicles",
      items: vehicles.map((v) => ({
        id: v.id,
        label: v.name,
        sublabel: [v.year, v.make, v.model].filter(Boolean).join(" ") || undefined,
        // The detail page, which links on to Edit. Kids never get here: Cars is off for them.
        href: `/vehicles/${v.id}`,
      })),
    });
  }

  if (maintenanceItems.length > 0) {
    groups.push({
      title: "Vehicle maintenance",
      items: maintenanceItems.map((m) => ({
        id: m.id,
        label: m.title,
        sublabel: m.vehicle.name,
        href: viewerIsAdult ? `/vehicles/${m.vehicle.id}/items/${m.id}/edit` : `/vehicles/${m.vehicle.id}`,
      })),
    });
  }

  if (schoolWork.length > 0) {
    groups.push({
      title: "School",
      items: schoolWork.map((a) => ({
        id: a.id,
        label: `${a.className}: ${a.title}`,
        sublabel: a.profile.person.firstName,
        // Phase 63c: in School's side panel, like a to-do.
        href: `/school?kid=${encodeURIComponent(a.profile.personId)}&item=${encodeURIComponent(itemParam("ASSIGNMENT", a.id))}`,
      })),
    });
  }

  if (schoolTasks.length > 0) {
    groups.push({
      title: "School forms & to-dos",
      items: schoolTasks.map((t) => ({
        id: t.id,
        label: t.title,
        sublabel: [t.kid?.firstName, t.status === "DONE" ? "done" : null].filter(Boolean).join(" · ") || undefined,
        // Phase 63c: straight to the to-do in School's side panel.
        href: `/school?${t.kidPersonId ? `kid=${encodeURIComponent(t.kidPersonId)}&` : ""}item=${encodeURIComponent(itemParam("SCHOOL_TASK", t.id))}`,
      })),
    });
  }

  if (rewards.length > 0) {
    groups.push({
      title: (await getRewardWords(householdId)).store,
      items: rewards.map((r) => ({
        id: r.id,
        label: `${r.emoji ?? "🎁"} ${r.title}`,
        sublabel: `${r.pointCost} ⭐`,
        href: "/points",
      })),
    });
  }

  if (dates.length > 0) {
    groups.push({
      title: "Important dates",
      items: dates.map((d) => ({
        id: d.id,
        label: `${d.label} · ${fullName(d.person)}`,
        sublabel: formatMonthDay(d.month, d.day),
        href: `/people/${d.person.id}`,
      })),
    });
  }

  // Phase 63c: school calendar events coming up (a kid sees their own feeds and the family's), and
  // what's on the shopping list now.
  const now = opts.now ?? new Date();
  const [schoolEvents, listItems] = await Promise.all([
    on("school")
      ? prisma.schoolFeedEvent.findMany({
          where: {
            title: { contains: term, mode: "insensitive" },
            startsAt: { lt: new Date(now.getTime() + 60 * 86_400_000) },
            endsAt: { gte: new Date(now.getTime() - 86_400_000) },
            feed: {
              householdId,
              active: true,
              ...(viewerIsAdult ? {} : { OR: [{ kidPersonId: null }, ...(opts.viewerId ? [{ kidPersonId: opts.viewerId }] : [])] }),
            },
          },
          select: { feedId: true, occurrenceKey: true, title: true, startsAt: true, endsAt: true, allDay: true, feed: { select: { kidPersonId: true, kid: { select: { firstName: true } } } } },
          orderBy: { startsAt: "asc" },
          take: RESULTS_PER_GROUP,
        })
      : [],
    on("groceries")
      ? prisma.shoppingListItem.findMany({
          where: { list: { householdId }, product: { name: { contains: term, mode: "insensitive" } } },
          select: { id: true, done: true, product: { select: { name: true } } },
          orderBy: { product: { name: "asc" } },
          take: RESULTS_PER_GROUP,
        })
      : [],
  ]);
  if (schoolEvents.length > 0) {
    groups.push({
      title: "School calendar",
      items: schoolEvents.map((e) => {
        // All-day events are stored as UTC midnight of their date; timed ones are instants read in
        // the household's zone, which the server keeps (lib/household-zone.ts), as the calendar does.
        const day = e.allDay ? toISODate(e.startsAt, "UTC") : toISODate(e.startsAt);
        return {
          id: `${e.feedId}:${e.occurrenceKey}`,
          label: e.title,
          sublabel: [formatEventWhen(e, Intl.DateTimeFormat().resolvedOptions().timeZone), e.feed.kid?.firstName].filter(Boolean).join(" · "),
          // To the week on the calendar, or to School when Calendar is off.
          href: on("calendar") ? `/calendar?week=${day}` : e.feed.kidPersonId ? `/school?kid=${encodeURIComponent(e.feed.kidPersonId)}` : "/school",
        };
      }),
    });
  }
  if (listItems.length > 0) {
    groups.push({
      title: "On the shopping list",
      items: listItems.map((i) => ({ id: i.id, label: i.product.name, sublabel: i.done ? "in the cart" : undefined, href: "/groceries" })),
    });
  }

  if (notes.length > 0) {
    groups.push({
      title: "Notes from calls and visits",
      items: notes.map((n) => ({
        id: n.id,
        label: n.note ?? "",
        sublabel: fullName(n.person),
        href: `/people/${n.person.id}`,
      })),
    });
  }

  return groups;
}
