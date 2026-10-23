import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { RelationshipType } from "@/app/generated/prisma/enums";

/**
 * Lives here (not in the "use server" app/(app)/people/[id]/actions.ts that uses it) so it's
 * unit-testable — a "use server" file may only export async functions, not a schema object.
 */
export const relationshipInputSchema = z
  .object({
    otherPersonId: z.string().trim().min(1, "Choose a person"),
    type: z.enum(["SPOUSE", "PARENT", "CHILD", "SIBLING", "OTHER"]),
    label: z.string().trim().optional(),
  })
  .refine((data) => data.type !== "OTHER" || Boolean(data.label), {
    message: "Label is required for \"Other\"",
    path: ["label"],
  });

const DAY_MS = 24 * 60 * 60 * 1000;

export function fullName(p: { firstName: string; lastName?: string | null }) {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

export type PeopleFilter = "all" | "member" | "contact";

export async function listPeople(
  householdId: string,
  opts: { query?: string; filter?: PeopleFilter } = {},
) {
  const { query, filter = "all" } = opts;

  return prisma.person.findMany({
    where: {
      householdId,
      ...(filter === "member" ? { isHouseholdMember: true } : {}),
      ...(filter === "contact" ? { isHouseholdMember: false } : {}),
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    omit: { photo: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
}

/** A kid never receives grown-ups-only calls (`adultsOnly`), so pass `viewerIsAdult` honestly. */
export async function getPersonWithDetails(id: string, householdId: string, opts: { viewerIsAdult: boolean }) {
  return prisma.person.findFirst({
    where: { id, householdId },
    omit: { photo: true },
    include: {
      importantDates: { orderBy: [{ month: "asc" }, { day: "asc" }] },
      interactions: {
        ...(opts.viewerIsAdult ? {} : { where: { adultsOnly: false } }),
        orderBy: { occurredAt: "desc" },
        take: 25,
        // Explicit, not relying solely on the global omit (lib/prisma.ts) cascading into
        // nested includes — this is the one spot in the codebase that was pulling full
        // logger Person rows (photo bytes, pinHash) via a bare `loggedBy: true`.
        include: { loggedBy: { omit: { photo: true, pinHash: true } } },
      },
    },
  });
}

export async function getHouseholdMembers(householdId: string, excludeId?: string) {
  return prisma.person.findMany({
    where: {
      householdId,
      isHouseholdMember: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    omit: { photo: true },
    orderBy: { firstName: "asc" },
  });
}

/** The next calendar occurrence of a month/day, ignoring year (rolls to next year if already passed). */
export function nextOccurrence(date: { month: number; day: number }, from = new Date()): Date {
  const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let candidate = new Date(from.getFullYear(), date.month - 1, date.day);
  if (candidate < todayMidnight) {
    candidate = new Date(from.getFullYear() + 1, date.month - 1, date.day);
  }
  return candidate;
}

/** An instant's calendar day ("YYYY-MM-DD") in the family's time zone (the server may run in UTC). */
export function dayInZone(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Midday of a calendar day in a time zone, as an instant. */
function middayInZone(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (wall - guess));
}

/**
 * When a logged call or visit happened, from the form's day ("YYYY-MM-DD" in the family's time
 * zone): blank or today means right now; an earlier day means midday that day, so it sorts
 * sensibly among the day's other logs. Null for the future, impossible days or before 1900.
 */
export function interactionTime(day: string | null, now: Date, timeZone: string): Date | null {
  if (!day || day === dayInZone(now, timeZone)) return now;
  const [y, m, d] = day.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || y < 1900) return null;
  const at = middayInZone(y, m, d, timeZone);
  return at > now ? null : at;
}

/**
 * Once per request: Home's cards and Bunson's bubble (the layout) both read these, each
 * with its own window or limit, so the rows are fetched once and filtered per caller.
 */
const householdImportantDates = cache((householdId: string) =>
  prisma.importantDate.findMany({
    where: { person: { householdId } },
    include: { person: { omit: { photo: true } } },
  }),
);

export async function upcomingImportantDates(householdId: string, withinDays = 30) {
  const dates = await householdImportantDates(householdId);

  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  return dates
    .map((d) => ({ ...d, next: nextOccurrence(d, now) }))
    .filter((d) => d.next <= horizon)
    .sort((a, b) => a.next.getTime() - b.next.getTime());
}

/** Default "nag after N days of silence" cadence for a contact with no per-person override. */
export const DEFAULT_CONTACT_CADENCE_DAYS = 21;

type StaleCandidate = {
  id: string;
  lastContactedAt: Date | null;
  createdAt: Date;
  contactCadenceDays: number | null;
  isHouseholdMember: boolean;
};

/**
 * Pure filtering/ranking logic for "who's overdue for a check-in" — no Prisma, so it's
 * testable the same way lib/tasks/queries.ts's bucketInstances is.
 *
 * A household member (someone you live with) is excluded entirely by default: nothing logs
 * `lastContactedAt` for people you live with, so without this a kid or spouse would
 * permanently read as "never contacted" — not this card's intent. Setting an explicit
 * `contactCadenceDays` opts a household member back in (e.g. a kid away at college).
 *
 * Everyone who reaches this point (every external contact, plus any opted-in household
 * member) anchors on `createdAt` when never contacted — a contact you've simply never
 * logged is exactly this card's core case, not an edge case to suppress. The only group
 * this deliberately never surfaces via `createdAt` is an un-opted-in household member,
 * already filtered out above.
 */
export function pickStaleContacts<T extends StaleCandidate>(
  people: readonly T[],
  now: Date,
  opts: { excludeId?: string; limit?: number } = {},
): (T & { daysSinceContact: number })[] {
  const { excludeId, limit = 5 } = opts;

  const overdue: { item: T; daysSinceContact: number; overdueBy: number }[] = [];

  for (const p of people) {
    if (p.id === excludeId) continue;
    if (p.isHouseholdMember && p.contactCadenceDays == null) continue;

    const cadence = p.contactCadenceDays ?? DEFAULT_CONTACT_CADENCE_DAYS;
    const anchor = p.lastContactedAt ?? p.createdAt;
    const daysSinceContact = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
    if (daysSinceContact < cadence) continue;

    overdue.push({ item: p, daysSinceContact, overdueBy: daysSinceContact - cadence });
  }

  // .sort() is stable (guaranteed since ES2019), so ties in overdueBy keep the input array's
  // own order — which is why the query below carries a real orderBy instead of none, so
  // that tie-break is deterministic across reloads rather than following Postgres heap order.
  return overdue
    .sort((a, b) => b.overdueBy - a.overdueBy)
    .slice(0, limit)
    .map((row) => ({ ...row.item, daysSinceContact: row.daysSinceContact }));
}

const staleCandidates = cache((householdId: string) =>
  prisma.person.findMany({
    where: {
      householdId,
      // A med's prescriber/pharmacy (see prisma/schema.prisma's Medication model) is a
      // working reference, not a relationship to nag about — without this, three weeks
      // after linking "CVS Pharmacy" this card (and Bunson's bubble) would ask "haven't
      // heard from CVS in a while," the same class of bug Phase 8's own choices caused
      // for never-contacted external contacts generally.
      prescribedMedications: { none: {} },
      pharmacyMedications: { none: {} },
    },
    omit: { photo: true },
    orderBy: [{ lastContactedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  }),
);

/** People overdue for a check-in, most-overdue first — see pickStaleContacts for the rule. */
export async function staleContacts(householdId: string, opts: { excludeId?: string; limit?: number } = {}) {
  return pickStaleContacts(await staleCandidates(householdId), new Date(), opts);
}

/** `type` describes what `to` is TO `from` — e.g. `{from: Alex, to: Kid, type: PARENT}` reads
 * "Alex is Kid's parent." INVERSE_RELATIONSHIP translates that for whichever side didn't
 * originate the row (Kid's own page needs to show "Alex — Parent", not re-show "Parent"). */
export const INVERSE_RELATIONSHIP: Record<RelationshipType, RelationshipType> = {
  SPOUSE: "SPOUSE",
  PARENT: "CHILD",
  CHILD: "PARENT",
  SIBLING: "SIBLING",
  OTHER: "OTHER",
};

export type PersonRelationshipView = {
  id: string;
  otherPerson: { id: string; firstName: string; lastName: string | null };
  type: RelationshipType;
  label: string | null;
};

type RelationshipRow = {
  id: string;
  fromId: string;
  type: RelationshipType;
  label: string | null;
  from: { id: string; firstName: string; lastName: string | null };
  to: { id: string; firstName: string; lastName: string | null };
};

/**
 * Pure per-row projection, given which person's page is viewing it — no Prisma, so it's
 * testable independent of getPersonRelationships' query. See INVERSE_RELATIONSHIP for the
 * direction convention.
 *
 * `label` is only ever collected for `OTHER` (enforced at the app layer where the row is
 * created) and describes the relationship as `from` sees it (e.g. "Godmother"). On the
 * `to` side that exact word is backwards, so it's rendered instead as "Other (Godmother of
 * {from.firstName})" rather than the misleading word alone.
 */
export function viewRelationship(row: RelationshipRow, viewerId: string): PersonRelationshipView {
  const isFrom = row.fromId === viewerId;
  if (isFrom) {
    return { id: row.id, otherPerson: row.to, type: row.type, label: row.label };
  }
  return {
    id: row.id,
    otherPerson: row.from,
    type: INVERSE_RELATIONSHIP[row.type],
    label: row.type === "OTHER" && row.label ? `${row.label} of ${row.from.firstName}` : row.label,
  };
}

/**
 * A person's relationships from BOTH directions a PersonRelationship row can name them in —
 * a row is stored once (see INVERSE_RELATIONSHIP for what `type` means), and the side that
 * didn't originate it sees it translated via viewRelationship instead of a second stored row.
 */
export async function getPersonRelationships(
  personId: string,
  householdId: string,
): Promise<PersonRelationshipView[]> {
  const rows = await prisma.personRelationship.findMany({
    where: { OR: [{ fromId: personId }, { toId: personId }], from: { householdId } },
    include: {
      from: { select: { id: true, firstName: true, lastName: true } },
      to: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => viewRelationship(r, personId));
}

/**
 * Whether a `{fromId, toId, type}` relationship (or its exact reverse-direction equivalent —
 * `{from: Jordan, to: Alex, type: SPOUSE}` is the same fact as `{from: Alex, to: Jordan, type:
 * SPOUSE}`) already exists — checked before create so adding "Jordan is my spouse" from
 * Alex's page and "Alex is my spouse" from Jordan's page don't produce two rows that both
 * pages then list twice. The `@@unique([fromId, toId, type])` constraint alone only blocks
 * the exact same direction.
 */
export async function findEquivalentRelationship(fromId: string, toId: string, type: RelationshipType) {
  return prisma.personRelationship.findFirst({
    where: {
      OR: [
        { fromId, toId, type },
        { fromId: toId, toId: fromId, type: INVERSE_RELATIONSHIP[type] },
      ],
    },
  });
}

/**
 * Whether a person can be deleted outright: a plain contact who never had a place in the
 * household. Someone removed in Settings → Household keeps isHouseholdMember false but still
 * has their sticker ledger, store orders, chores, school record, money jars or sign-in;
 * deleting them would cascade all of that away, so they're refused.
 */
export async function isDeletableContact(personId: string, householdId: string): Promise<boolean> {
  const person = await prisma.person.findFirst({
    where: { id: personId, householdId },
    select: {
      isHouseholdMember: true,
      authUserId: true,
      role: true,
      schoolProfile: { select: { id: true } },
      _count: { select: { pointsLedger: true, rewardOrders: true, assignedInstances: true, completedInstances: true, moneyJars: true, pushSubscriptions: true } },
    },
  });
  if (!person || person.isHouseholdMember || person.authUserId || person.role || person.schoolProfile) return false;
  return Object.values(person._count).every((n) => n === 0);
}
