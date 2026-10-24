import { createHash, randomUUID } from "node:crypto";
import { canonicalizeTimeZone } from "@/lib/household-settings";
import { APP_NAME_MAX, appNameLength, cleanAppName } from "@/lib/app-name";
import { cleanDisabledApps } from "@/lib/apps";
import { SETUP_REVIEWABLE } from "@/lib/setup-checklist";
import { cleanMascotName } from "@/lib/family-look";
import { checkRewardWords } from "@/lib/reward-words";
import { isThemeColorId } from "@/lib/theme-colors";
import { backupSchema, type Backup } from "./schema";
import { productNameKey } from "@/lib/product-name";
import { readCareHours, readPetState } from "@/lib/pet/stored";
import { DEFAULT_CARE_HOURS, type CareHours } from "@/lib/pet/care-hours";

/**
 * Restore planning (Phase 16.5): everything that can be decided WITHOUT the database, as
 * pure functions, so every rejection happens before a single row is deleted and is
 * unit-tested. lib/backup/restore.ts runs the plan inside one transaction.
 *
 * Error messages never contain file content: a restore error can reach logs or Sentry, and
 * the file holds meds, contacts and notes. Problems are reported as fixed text and counts,
 * never as the offending ids, names or emails.
 */

export type Rejection = { ok: false; errors: string[] };

const MAX_ISSUES = 20;

/** Parse + validate. Node's JSON.parse error text quotes the input, so it's replaced. */
export function parseBackupFile(text: string): { ok: true; backup: Backup } | Rejection {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The file isn't valid JSON. Is it a backup downloaded from this app?"] };
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    // Path + code only: zod 4's messages for this schema don't embed input, but a future
    // refine with a templated message could, so they're not passed through.
    const errors = parsed.error.issues.slice(0, MAX_ISSUES).map((i) => `${i.path.join(".") || "(file)"}: ${i.code}`);
    if (parsed.error.issues.length > MAX_ISSUES) errors.push(`…and ${parsed.error.issues.length - MAX_ISSUES} more problems`);
    return { ok: false, errors: ["This isn't a backup file this app can read.", ...errors] };
  }
  return { ok: true, backup: parsed.data };
}

type Ids = Set<string>;
const idsOf = (rows: { id: string }[]): Ids => new Set(rows.map((r) => r.id));

/**
 * Every reference in the file points at a row in the file, and ids are unique per table.
 * Guarantees the inserts can't hit a foreign-key violation halfway through.
 */
export function checkReferences(b: Backup): string[] {
  const problems: string[] = [];
  const people = idsOf(b.people);
  const defs = idsOf(b.taskDefinitions);
  const instances = idsOf(b.taskInstances);
  const vehicles = idsOf(b.vehicles);
  const items = idsOf(b.maintenanceItems);
  const stores = idsOf(b.stores);
  const groups = idsOf(b.productGroups);
  const products = idsOf(b.products);
  const purchases = idsOf(b.purchases);
  const logs = idsOf(b.serviceLogs);
  const supplies = idsOf(b.vehicleSupplies);
  const schoolProfiles = idsOf(b.schoolProfiles);
  const rewards = idsOf(b.rewards);
  const buckets = idsOf(b.rewardBuckets);
  const orders = idsOf(b.rewardOrders);

  for (const [table, rows] of Object.entries(tables(b))) {
    if (idsOf(rows).size !== rows.length) problems.push(`${table}: duplicate ids`);
  }

  const check = (label: string, refs: (string | null)[], target: Ids) => {
    const broken = refs.filter((r): r is string => r != null && !target.has(r)).length;
    if (broken > 0) problems.push(`${label}: ${broken} reference(s) to missing rows`);
  };
  check("importantDates.personId", b.importantDates.map((r) => r.personId), people);
  check("interactions.personId", b.interactions.map((r) => r.personId), people);
  check("interactions.loggedById", b.interactions.map((r) => r.loggedById), people);
  check("relationships.fromId", b.relationships.map((r) => r.fromId), people);
  check("relationships.toId", b.relationships.map((r) => r.toId), people);
  check("taskDefinitions.assigneeIds", b.taskDefinitions.flatMap((r) => r.assigneeIds), people);
  check("taskInstances.definitionId", b.taskInstances.map((r) => r.definitionId), defs);
  check("taskInstances.assignedToId", b.taskInstances.map((r) => r.assignedToId), people);
  check("taskInstances.completedById", b.taskInstances.map((r) => r.completedById), people);
  check("pointsLedger.personId", b.pointsLedger.map((r) => r.personId), people);
  check("pointsLedger.instanceId", b.pointsLedger.map((r) => r.instanceId), instances);
  check("pointsLedger.orderId", b.pointsLedger.map((r) => r.orderId), orders);
  check("rewards.bucketId", b.rewards.map((r) => r.bucketId), buckets);
  check("rewardOrders.rewardId", b.rewardOrders.map((r) => r.rewardId), rewards);
  check("rewardOrders.personId", b.rewardOrders.map((r) => r.personId), people);
  check("rewardOrders.placedById", b.rewardOrders.map((r) => r.placedById), people);
  check("rewardOrders.decidedById", b.rewardOrders.map((r) => r.decidedById), people);
  check("rewardOrders.closedById", b.rewardOrders.map((r) => r.closedById), people);
  check("medications.taskDefinitionId", b.medications.map((r) => r.taskDefinitionId), defs);
  check("medications.prescriberId", b.medications.map((r) => r.prescriberId), people);
  check("medications.pharmacyId", b.medications.map((r) => r.pharmacyId), people);
  check("maintenanceItems.vehicleId", b.maintenanceItems.map((r) => r.vehicleId), vehicles);
  check("serviceLogs.itemId", b.serviceLogs.map((r) => r.itemId), items);
  check("serviceLogs.loggedById", b.serviceLogs.map((r) => r.loggedById), people);
  check("fuelLogs.vehicleId", b.fuelLogs.map((r) => r.vehicleId), vehicles);
  check("fuelLogs.loggedById", b.fuelLogs.map((r) => r.loggedById), people);
  check("recallAcks.vehicleId", b.recallAcks.map((r) => r.vehicleId), vehicles);
  check("recallAcks.acknowledgedById", b.recallAcks.map((r) => r.acknowledgedById), people);
  check("vehicleItemSupplies.itemId", b.vehicleItemSupplies.map((r) => r.itemId), items);
  check("vehicleItemSupplies.supplyId", b.vehicleItemSupplies.map((r) => r.supplyId), supplies);
  check("vehicleServiceSupplyUses.logId", b.vehicleServiceSupplyUses.map((r) => r.logId), logs);
  check("vehicleServiceSupplyUses.supplyId", b.vehicleServiceSupplyUses.map((r) => r.supplyId), supplies);
  check("schoolProfiles.personId", b.schoolProfiles.map((r) => r.personId), people);
  check("schoolContacts.profileId", b.schoolContacts.map((r) => r.profileId), schoolProfiles);
  check("schoolContacts.personId", b.schoolContacts.map((r) => r.personId), people);
  check("schoolTasks.kidPersonId", b.schoolTasks.map((r) => r.kidPersonId), people);
  check("schoolTasks.ownerPersonId", b.schoolTasks.map((r) => r.ownerPersonId), people);
  check("schoolAssignments.profileId", b.schoolAssignments.map((r) => r.profileId), schoolProfiles);
  check("products.defaultStoreId", b.products.map((r) => r.defaultStoreId), stores);
  check("products.groupId", b.products.map((r) => r.groupId), groups);
  check("shoppingListItems.productId", b.shoppingListItems.map((r) => r.productId), products);
  check("shoppingListItems.addedById", b.shoppingListItems.map((r) => r.addedById), people);
  check("shoppingListItems.requestedById", b.shoppingListItems.map((r) => r.requestedById), people);
  check("purchases.purchasedById", b.purchases.map((r) => r.purchasedById), people);
  check("purchaseItems.purchaseId", b.purchaseItems.map((r) => r.purchaseId), purchases);
  check("purchaseItems.productId", b.purchaseItems.map((r) => r.productId), products);
  check("purchaseItems.requestedById", b.purchaseItems.map((r) => r.requestedById), people);
  check("itemPrices.productId", b.itemPrices.map((r) => r.productId), products);
  check("itemPrices.storeId", b.itemPrices.map((r) => r.storeId), stores);
  check("receiptAliases.productId", b.receiptAliases.map((r) => r.productId), products);
  check("pets.personId", b.pets.map((r) => r.personId), people);
  check("petItems.personId", b.petItems.map((r) => r.personId), people);
  check("petPlays.personId", b.petPlays.map((r) => r.personId), people);
  check("petMemorials.personId", b.petMemorials.map((r) => r.personId), people);
  check("petGifts.personId", b.petGifts.map((r) => r.personId), people);
  check("petDiscoveries.personId", b.petDiscoveries.map((r) => r.personId), people);
  // petGifts.instanceId isn't checked: a present whose chore isn't in the file keeps its
  // place in the daily cap with no chore (remapBackup nulls it, like the database's SET NULL).
  return problems;
}

function tables(b: Backup): Record<string, { id: string }[]> {
  return {
    people: b.people,
    importantDates: b.importantDates,
    interactions: b.interactions,
    relationships: b.relationships,
    taskDefinitions: b.taskDefinitions,
    taskInstances: b.taskInstances,
    pointsLedger: b.pointsLedger,
    rewards: b.rewards,
    rewardBuckets: b.rewardBuckets,
    rewardOrders: b.rewardOrders,
    medications: b.medications,
    vehicles: b.vehicles,
    maintenanceItems: b.maintenanceItems,
    serviceLogs: b.serviceLogs,
    fuelLogs: b.fuelLogs,
    recallAcks: b.recallAcks,
    vehicleSupplies: b.vehicleSupplies,
    schoolProfiles: b.schoolProfiles,
    schoolTasks: b.schoolTasks,
    schoolAssignments: b.schoolAssignments,
    stores: b.stores,
    productGroups: b.productGroups,
    products: b.products,
    shoppingListItems: b.shoppingListItems,
    purchases: b.purchases,
    purchaseItems: b.purchaseItems,
    itemPrices: b.itemPrices,
    receiptAliases: b.receiptAliases,
    pets: b.pets,
    petItems: b.petItems,
    petMemorials: b.petMemorials,
    petGifts: b.petGifts,
  };
}

/**
 * The database's unique constraints, checked inside the file. Only linked people survive
 * the delete step (their one unique, authUserId, isn't in a backup), so a file that passes
 * this can't collide with anything that remains.
 */
export function checkUniques(b: Backup): string[] {
  const problems: string[] = [];
  const dupes = (label: string, keys: (string | null)[]) => {
    const present = keys.filter((k): k is string => k != null);
    const count = present.length - new Set(present).size;
    if (count > 0) problems.push(`${label}: ${count} duplicate(s)`);
  };
  dupes("relationships (person, related person, type)", b.relationships.map((r) => `${r.fromId}|${r.toId}|${r.type}`));
  dupes("taskInstances (chore/med, due date)", b.taskInstances.map((r) => `${r.definitionId}|${Date.parse(r.dueDate)}`));
  dupes("medications per med", b.medications.map((r) => r.taskDefinitionId));
  dupes("rewards (title)", b.rewards.map((r) => r.title));
  dupes("rewardBuckets (name)", b.rewardBuckets.map((r) => r.name));
  dupes("vehicles (name)", b.vehicles.map((r) => r.name));
  dupes("recallAcks (vehicle, campaign)", b.recallAcks.map((r) => `${r.vehicleId}|${r.campaignNumber}`));
  dupes("vehicleSupplies (name)", b.vehicleSupplies.map((r) => r.name));
  dupes("schoolProfiles (one per student)", b.schoolProfiles.map((r) => r.personId));
  dupes("schoolContacts (student, contact)", b.schoolContacts.map((r) => `${r.profileId}|${r.personId}`));
  // The two join tables have composite primary keys and no id, so their "duplicate ids"
  // check is this.
  dupes("vehicleItemSupplies (item, supply)", b.vehicleItemSupplies.map((r) => `${r.itemId}|${r.supplyId}`));
  dupes("vehicleServiceSupplyUses (service, supply)", b.vehicleServiceSupplyUses.map((r) => `${r.logId}|${r.supplyId}`));
  dupes("stores (name)", b.stores.map((r) => r.name));
  dupes("productGroups (name)", b.productGroups.map((r) => r.name));
  dupes("productGroups (starting section)", b.productGroups.map((r) => r.starterKey));
  dupes("products (barcode)", b.products.map((r) => r.barcode));
  dupes("receiptAliases (text)", b.receiptAliases.map((r) => r.textKey));
  dupes("pets (one per person)", b.pets.map((r) => r.personId));
  dupes("petPlays (person, game)", b.petPlays.map((r) => `${r.personId}|${r.game}`));
  dupes("petGifts (one per chore)", b.petGifts.map((r) => r.instanceId));
  // Composite primary key and no id, so this is its "duplicate ids" check too.
  dupes("petDiscoveries (person, species, stage, form)", b.petDiscoveries.map((r) => `${r.personId}|${r.species}|${r.stage}|${r.form}`));
  return problems;
}

export type LinkedPerson = {
  id: string;
  firstName: string;
  email: string | null;
  /** The Better Auth user's email: always set, unlike Person.email right after sign-in. */
  authEmail: string | null;
  isHouseholdMember: boolean;
  /** Phase 28.5: the live role (Entra-owned); a money restore keeps only adult members. */
  role?: "ADULT" | "KID" | "ADMIN" | null;
};

export type PeoplePlan = {
  /** backup person id -> surviving linked person id */
  matches: Map<string, string>;
  keptLinked: LinkedPerson[];
  newMembers: number;
  newContacts: number;
  /** Linked people matched while removed from the household: they stay removed. */
  matchedButRemoved: number;
};

const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

/**
 * Matches backup household MEMBERS (never contacts: a contact card can share an adult's
 * email) to this household's people with their own sign-in, by trimmed, case-insensitive email
 * against either Person.email or the sign-in email. The match must be one-to-one both ways;
 * anything ambiguous rejects the file rather than guessing.
 */
export function planPeople(b: Backup, linked: LinkedPerson[]): { ok: true; plan: PeoplePlan } | Rejection {
  const errors: string[] = [];
  const members = b.people.filter((p) => p.isHouseholdMember);

  const memberEmails = members.map((p) => normEmail(p.email)).filter((e): e is string => e != null);
  const dupes = memberEmails.length - new Set(memberEmails).size;
  if (dupes > 0) errors.push(`${dupes} household member(s) in the file share an email address with another member.`);

  const matches = new Map<string, string>();
  const claimed = new Map<string, string>();
  let ambiguous = 0;
  let doubleClaimed = 0;
  for (const member of members) {
    const email = normEmail(member.email);
    if (!email) continue;
    const candidates = linked.filter((l) => normEmail(l.email) === email || normEmail(l.authEmail) === email);
    if (candidates.length > 1) {
      ambiguous++;
      continue;
    }
    if (candidates.length === 1) {
      const target = candidates[0].id;
      if (claimed.has(target)) doubleClaimed++;
      claimed.set(target, member.id);
      matches.set(member.id, target);
    }
  }
  if (ambiguous > 0) errors.push(`${ambiguous} member(s) in the file match more than one signed-in person here.`);
  if (doubleClaimed > 0) errors.push(`${doubleClaimed} signed-in person(s) here match more than one member in the file.`);
  if (errors.length > 0) return { ok: false, errors };

  const matchedIds = new Set(matches.values());
  return {
    ok: true,
    plan: {
      matches,
      keptLinked: linked.filter((l) => !matchedIds.has(l.id)),
      newMembers: members.filter((m) => !matches.has(m.id)).length,
      newContacts: b.people.filter((p) => !p.isHouseholdMember).length,
      matchedButRemoved: linked.filter((l) => matchedIds.has(l.id) && !l.isHouseholdMember).length,
    },
  };
}

/**
 * A fingerprint of who survives and who is overwritten. Preview returns it and apply must
 * echo it: the file hash alone doesn't catch a first-time Microsoft sign-in between the two,
 * which would turn a "new member" the admin confirmed into an overwrite of a live login.
 */
export function planDigest(plan: PeoplePlan): string {
  const matches = [...plan.matches].map(([b, l]) => `${b}>${l}`).sort();
  const kept = plan.keptLinked.map((l) => l.id).sort();
  return createHash("sha256").update(JSON.stringify({ matches, kept })).digest("hex");
}

/**
 * Phase 49: a backup's days (chore and med due dates, vehicle and school dates) are written in
 * its `exportedTimeZone`; older files recorded the server's zone, which is what their days were
 * written in. A restore moves them to the restored household's zone, keeping each date and clock
 * time (lib/household-zone.ts). `fallback` is the zone used for a missing or unknown one.
 */
export function restoredDayZones(b: Backup, fallback: string): { from: string; to: string } {
  return {
    from: canonicalizeTimeZone(b.exportedTimeZone) ?? fallback,
    to: (b.household.timezone && canonicalizeTimeZone(b.household.timezone)) || fallback,
  };
}

/** What the preview says when the restore will move the days, or null when it won't. */
export function dayZoneNote(zones: { from: string; to: string }): string | null {
  if (zones.from === zones.to) return null;
  const name = (z: string) => z.replace(/_/g, " ");
  return `Dates in this backup were saved in ${name(zones.from)} time. They'll be moved to ${name(zones.to)} time, each keeping its date and clock time.`;
}

/** Household fields a file may lack (added after its version); each has a default. */
type OptionalHouseholdField =
  | "familyGoalStickers"
  | "familyGoalTitle"
  | "appName"
  | "themeColor"
  | "rewardOne"
  | "rewardMany"
  | "rewardStore"
  | "mascotOn"
  | "mascotName"
  | "appIcon"
  | "disabledApps"
  | "setupReviewed"
  | "petCareHours"
  | "statementDateOrder";

/** Household settings from the file, re-validated the way the settings form validates them. */
export function normalizeHousehold(
  h: Omit<Backup["household"], OptionalHouseholdField> & Partial<Pick<Backup["household"], OptionalHouseholdField>>,
) {
  // Phase 45.1: home is kept to about a kilometre, so an older file's finer point is rounded.
  const km = (n: number) => Math.round(n * 100) / 100;
  const lat = h.latitude != null && h.latitude >= -90 && h.latitude <= 90 ? km(h.latitude) : null;
  const lon = h.longitude != null && h.longitude >= -180 && h.longitude <= 180 ? km(h.longitude) : null;
  const appName = cleanAppName(h.appName);
  const reward = h.rewardOne && h.rewardMany && h.rewardStore ? checkRewardWords({ one: h.rewardOne, many: h.rewardMany, store: h.rewardStore }) : null;
  return {
    name: h.name.trim() || "Our Family",
    timezone: h.timezone ? canonicalizeTimeZone(h.timezone) : null,
    // Both or neither, like the settings form.
    latitude: lat != null && lon != null ? lat : null,
    longitude: lat != null && lon != null ? lon : null,
    // Phase 20 family sheet goal, validated like lib/store/forms.ts familyGoalSchema.
    familyGoalStickers:
      h.familyGoalStickers != null && h.familyGoalStickers > 0 && h.familyGoalStickers <= 1_000_000 ? h.familyGoalStickers : null,
    familyGoalTitle: h.familyGoalTitle?.trim().slice(0, 80) || null,
    // Validated like the settings form: a name it wouldn't accept means the default.
    appName: appName && appNameLength(appName) <= APP_NAME_MAX ? appName : null,
    // Phase 36: only ids that have a switch, each once (lib/apps.ts, like reading them).
    disabledApps: cleanDisabledApps(h.disabledApps),
    // Phase 45.4: only the steps that exist, each once.
    setupReviewed: [...new Set((h.setupReviewed ?? []).filter((id) => (SETUP_REVIEWABLE as readonly string[]).includes(id)))],
    // Phase 35, validated like Settings → Make it yours: anything it wouldn't save is the default.
    themeColor: h.themeColor && isThemeColorId(h.themeColor) ? h.themeColor : null,
    rewardOne: reward?.ok ? reward.words.one : null,
    rewardMany: reward?.ok ? reward.words.many : null,
    rewardStore: reward?.ok ? reward.words.store : null,
    mascotOn: h.mascotOn ?? true,
    mascotName: cleanMascotName(h.mascotName),
    appIcon: h.appIcon ?? "BUNNY",
    // Phase 47: kept only if it reads as care hours. readCareHours hands back the defaults
    // object itself when it can't, which here means "none set" (the same hours).
    petCareHours: careHoursOrNull(h.petCareHours),
    statementDateOrder: h.statementDateOrder ?? "AUTO",
  };
}

function careHoursOrNull(json: unknown): CareHours | null {
  if (json == null) return null;
  const hours = readCareHours(json);
  return hours === DEFAULT_CARE_HOURS ? null : hours;
}

/**
 * Phase 47: the file's pets whose state reads (lib/pet/stored.ts), with it parsed. A pet that
 * doesn't is left out of the restore rather than failing it: its person, items and memory
 * book still come back, and they can hatch a new one.
 */
export function readablePets(b: Backup) {
  return b.pets.flatMap((p) => {
    const state = readPetState(p.state);
    return state ? [{ ...p, state }] : [];
  });
}

const date = (iso: string) => new Date(iso);
const dateOrNull = (iso: string | null) => (iso ? new Date(iso) : null);

/**
 * Re-issues every id (never reuses the file's: ids are global primary keys, and restoring
 * the automatic pre-restore snapshot later would otherwise collide) and rewrites every
 * reference. Matched people keep the surviving linked row's id. The output is ready for
 * createMany.
 */
export function remapBackup(
  b: Backup,
  opts: { householdId: string; listId: string; personMatches: Map<string, string>; newId?: () => string },
) {
  const newId = opts.newId ?? randomUUID;
  const { householdId, listId, personMatches } = opts;
  const mapFor = (rows: { id: string }[]) => new Map(rows.map((r) => [r.id, newId()]));

  const people = new Map(b.people.map((p) => [p.id, personMatches.get(p.id) ?? newId()]));
  const defs = mapFor(b.taskDefinitions);
  const instances = mapFor(b.taskInstances);
  const vehicles = mapFor(b.vehicles);
  const items = mapFor(b.maintenanceItems);
  const logs = mapFor(b.serviceLogs);
  const supplies = mapFor(b.vehicleSupplies);
  const schoolProfiles = mapFor(b.schoolProfiles);
  const stores = mapFor(b.stores);
  const groups = mapFor(b.productGroups);
  const purchases = mapFor(b.purchases);
  const rewards = mapFor(b.rewards);
  const buckets = mapFor(b.rewardBuckets);
  const orders = mapFor(b.rewardOrders);

  // References were verified by checkReferences, so a missing key can't happen; `!` keeps
  // that assumption loud rather than silently writing undefined.
  const req = (m: Map<string, string>, id: string) => m.get(id)!;
  const opt = (m: Map<string, string>, id: string | null) => (id == null ? null : m.get(id)!);

  const pantry = remapPantry(b, { householdId, newId, stores, groups });
  const products = pantry.products;
  const shoppingListItems = b.shoppingListItems.flatMap((r) => {
    const productId = pantry.forListRow(r);
    if (productId == null) return [];
    return [
      {
        id: newId(),
        listId,
        productId,
        quantity: r.quantity,
        done: r.done,
        kidPick: r.kidPick,
        addedById: opt(people, r.addedById),
        requestedById: opt(people, r.requestedById),
        createdAt: date(r.createdAt),
      },
    ];
  });

  return {
    // Phase 28.5: the money restore (lib/finance/backup.ts) maps its people and trip links
    // through these.
    idMaps: { people, purchases },
    newPeople: b.people
      .filter((p) => !personMatches.has(p.id))
      .map((p) => ({
        id: req(people, p.id),
        householdId,
        firstName: p.firstName,
        lastName: p.lastName,
        isHouseholdMember: p.isHouseholdMember,
        role: p.role,
        color: p.color ?? null,
        email: p.email,
        phone: p.phone,
        notes: p.notes,
        notesAdultsOnly: p.notesAdultsOnly,
        contactCadenceDays: p.contactCadenceDays,
        lastContactedAt: dateOrNull(p.lastContactedAt),
        createdAt: date(p.createdAt),
      })),
    // Profile fields only. Role (Entra owns it), membership, sign-in link, PIN and photo
    // are never touched on a live login (Fable's scope review).
    matchedPeopleUpdates: b.people
      .filter((p) => personMatches.has(p.id))
      .map((p) => ({
        id: req(people, p.id),
        data: {
          firstName: p.firstName,
          lastName: p.lastName,
          ...(p.email != null ? { email: p.email } : {}),
          // Absent in pre-Phase-19 files: leave the live color alone rather than clearing it.
          ...(p.color !== undefined ? { color: p.color } : {}),
          phone: p.phone,
          notes: p.notes,
          notesAdultsOnly: p.notesAdultsOnly,
          contactCadenceDays: p.contactCadenceDays,
          lastContactedAt: dateOrNull(p.lastContactedAt),
          createdAt: date(p.createdAt),
        },
      })),
    importantDates: b.importantDates.map((r) => ({ ...r, id: newId(), personId: req(people, r.personId) })),
    interactions: b.interactions.map((r) => ({
      ...r,
      id: newId(),
      personId: req(people, r.personId),
      loggedById: opt(people, r.loggedById),
      occurredAt: date(r.occurredAt),
      createdAt: date(r.createdAt),
    })),
    relationships: b.relationships.map((r) => ({
      ...r,
      id: newId(),
      fromId: req(people, r.fromId),
      toId: req(people, r.toId),
      createdAt: date(r.createdAt),
    })),
    taskDefinitions: b.taskDefinitions.map((r) => ({
      id: req(defs, r.id),
      householdId,
      title: r.title,
      notes: r.notes,
      domain: r.domain,
      frequencyType: r.frequencyType,
      interval: r.interval,
      daysOfWeek: r.daysOfWeek,
      startDate: date(r.startDate),
      timesOfDay: r.timesOfDay,
      weatherSensitive: r.weatherSensitive,
      points: r.points,
      assignmentStrategy: r.assignmentStrategy,
      active: r.active,
      createdAt: date(r.createdAt),
    })),
    assigneeConnects: b.taskDefinitions
      .filter((r) => r.assigneeIds.length > 0)
      .map((r) => ({ definitionId: req(defs, r.id), personIds: r.assigneeIds.map((id) => req(people, id)) })),
    medications: b.medications.map((r) => ({
      ...r,
      id: newId(),
      taskDefinitionId: req(defs, r.taskDefinitionId),
      prescriberId: opt(people, r.prescriberId),
      pharmacyId: opt(people, r.pharmacyId),
    })),
    taskInstances: b.taskInstances.map((r) => ({
      ...r,
      id: req(instances, r.id),
      definitionId: req(defs, r.definitionId),
      assignedToId: opt(people, r.assignedToId),
      completedById: opt(people, r.completedById),
      dueDate: date(r.dueDate),
      completedAt: dateOrNull(r.completedAt),
      createdAt: date(r.createdAt),
    })),
    pointsLedger: b.pointsLedger.map((r) => ({
      ...r,
      id: newId(),
      personId: req(people, r.personId),
      instanceId: opt(instances, r.instanceId),
      orderId: opt(orders, r.orderId),
      createdAt: date(r.createdAt),
    })),
    rewardBuckets: b.rewardBuckets.map((r) => ({ ...r, id: req(buckets, r.id), householdId, createdAt: date(r.createdAt) })),
    rewards: b.rewards.map((r) => ({
      ...r,
      id: req(rewards, r.id),
      householdId,
      bucketId: opt(buckets, r.bucketId),
      createdAt: date(r.createdAt),
    })),
    rewardOrders: b.rewardOrders.map((r) => ({
      ...r,
      id: req(orders, r.id),
      householdId,
      rewardId: req(rewards, r.rewardId),
      personId: req(people, r.personId),
      placedById: opt(people, r.placedById),
      decidedById: opt(people, r.decidedById),
      closedById: opt(people, r.closedById),
      decidedAt: dateOrNull(r.decidedAt),
      closedAt: dateOrNull(r.closedAt),
      createdAt: date(r.createdAt),
    })),
    vehicles: b.vehicles.map((r) => ({
      ...r,
      id: req(vehicles, r.id),
      householdId,
      mileageUpdatedAt: dateOrNull(r.mileageUpdatedAt),
      createdAt: date(r.createdAt),
    })),
    maintenanceItems: b.maintenanceItems.map((r) => ({
      ...r,
      id: req(items, r.id),
      vehicleId: req(vehicles, r.vehicleId),
      lastDoneAt: dateOrNull(r.lastDoneAt),
      createdAt: date(r.createdAt),
    })),
    serviceLogs: b.serviceLogs.map((r) => ({
      ...r,
      id: req(logs, r.id),
      itemId: req(items, r.itemId),
      loggedById: opt(people, r.loggedById),
      doneAt: date(r.doneAt),
      createdAt: date(r.createdAt),
    })),
    fuelLogs: b.fuelLogs.map((r) => ({
      ...r,
      id: newId(),
      vehicleId: req(vehicles, r.vehicleId),
      loggedById: opt(people, r.loggedById),
      filledAt: date(r.filledAt),
      createdAt: date(r.createdAt),
    })),
    recallAcks: b.recallAcks.map((r) => ({
      ...r,
      id: newId(),
      vehicleId: req(vehicles, r.vehicleId),
      acknowledgedById: opt(people, r.acknowledgedById),
      acknowledgedAt: date(r.acknowledgedAt),
    })),
    vehicleSupplies: b.vehicleSupplies.map((r) => ({ ...r, id: req(supplies, r.id), householdId, createdAt: date(r.createdAt) })),
    schoolProfiles: b.schoolProfiles.map((r) => ({ ...r, id: req(schoolProfiles, r.id), personId: req(people, r.personId), createdAt: date(r.createdAt) })),
    schoolContacts: b.schoolContacts.map((r) => ({ ...r, profileId: req(schoolProfiles, r.profileId), personId: req(people, r.personId) })),
    schoolTasks: b.schoolTasks.map((r) => ({
      ...r,
      id: newId(),
      householdId,
      kidPersonId: opt(people, r.kidPersonId),
      ownerPersonId: opt(people, r.ownerPersonId),
      dueDate: dateOrNull(r.dueDate),
      doneAt: dateOrNull(r.doneAt),
      createdAt: date(r.createdAt),
    })),
    schoolAssignments: b.schoolAssignments.map((r) => ({
      ...r,
      id: newId(),
      profileId: req(schoolProfiles, r.profileId),
      dueDate: dateOrNull(r.dueDate),
      doneAt: dateOrNull(r.doneAt),
      createdAt: date(r.createdAt),
    })),
    vehicleItemSupplies: b.vehicleItemSupplies.map((r) => ({ ...r, itemId: req(items, r.itemId), supplyId: req(supplies, r.supplyId) })),
    vehicleServiceSupplyUses: b.vehicleServiceSupplyUses.map((r) => ({
      ...r,
      logId: req(logs, r.logId),
      supplyId: req(supplies, r.supplyId),
    })),
    stores: b.stores.map((r) => ({ ...r, id: req(stores, r.id), householdId, createdAt: date(r.createdAt) })),
    productGroups: b.productGroups.map((r) => ({ ...r, id: req(groups, r.id), householdId, createdAt: date(r.createdAt) })),
    products: pantry.rows,
    shoppingListItems,
    purchases: b.purchases.map((r) => ({
      ...r,
      id: req(purchases, r.id),
      householdId,
      listId,
      purchasedById: opt(people, r.purchasedById),
      purchasedAt: date(r.purchasedAt),
    })),
    purchaseItems: b.purchaseItems.map((r) => ({
      ...r,
      id: newId(),
      purchaseId: req(purchases, r.purchaseId),
      productId: opt(products, r.productId),
      requestedById: opt(people, r.requestedById),
    })),
    itemPrices: b.itemPrices.map((r) => ({
      ...r,
      id: newId(),
      householdId,
      productId: req(products, r.productId),
      storeId: opt(stores, r.storeId),
      observedAt: date(r.observedAt),
    })),
    receiptAliases: b.receiptAliases.map((r) => ({ ...r, id: newId(), householdId, productId: req(products, r.productId) })),
    pets: readablePets(b).map((r) => ({
      ...r,
      id: newId(),
      householdId,
      personId: req(people, r.personId),
      bornAt: date(r.bornAt),
      lastAdvancedAt: date(r.lastAdvancedAt),
      createdAt: date(r.createdAt),
    })),
    petItems: b.petItems.map((r) => ({ ...r, id: newId(), householdId, personId: req(people, r.personId), createdAt: date(r.createdAt) })),
    petPlays: b.petPlays.map((r) => ({ ...r, personId: req(people, r.personId), paidAt: date(r.paidAt) })),
    petMemorials: b.petMemorials.map((r) => ({
      ...r,
      id: newId(),
      householdId,
      personId: req(people, r.personId),
      bornAt: date(r.bornAt),
      goneAt: date(r.goneAt),
      createdAt: date(r.createdAt),
    })),
    petGifts: b.petGifts.map((r) => ({
      ...r,
      id: newId(),
      householdId,
      personId: req(people, r.personId),
      instanceId: r.instanceId == null ? null : (instances.get(r.instanceId) ?? null),
      grantedAt: date(r.grantedAt),
      openedAt: dateOrNull(r.openedAt),
    })),
    petDiscoveries: b.petDiscoveries.map((r) => ({ ...r, householdId, personId: req(people, r.personId), foundAt: date(r.foundAt) })),
  };
}

/**
 * Pantry items for a restore (Phase 22). Every item needs a household-unique name key, and
 * every list row an item, so:
 * - items whose names share a key (an older file could hold "Milk" and "milk") fold into the
 *   first one, which inherits a barcode it lacks (barcodes are unique in the file);
 * - a v1–v4 free-text list row points at the item of that name, made if it's new;
 * - a list row with neither (never written by the app) is dropped.
 */
function remapPantry(
  b: Backup,
  opts: { householdId: string; newId: () => string; stores: Map<string, string>; groups: Map<string, string> },
) {
  const { householdId, newId } = opts;
  const products = new Map<string, string>();
  const byKey = new Map<string, number>();
  const rows: {
    id: string;
    householdId: string;
    name: string;
    nameKey: string;
    barcode: string | null;
    brand: string | null;
    imageUrl: string | null;
    sizeAmount: number | null;
    sizeUnit: string | null;
    container: string | null;
    defaultStoreId: string | null;
    groupId: string | null;
    createdAt: Date;
  }[] = [];

  for (const r of b.products) {
    // A name with no letters or digits keys on its own id rather than colliding with others.
    const nameKey = productNameKey(r.name) || `#${r.id}`;
    const at = byKey.get(nameKey);
    if (at != null) {
      // Same fill rule as the in-app "Same as…" merge (lib/groceries/merge.ts).
      const kept = rows[at];
      products.set(r.id, kept.id);
      kept.barcode ??= r.barcode;
      kept.brand ??= r.brand;
      kept.imageUrl ??= r.imageUrl;
      kept.defaultStoreId ??= r.defaultStoreId == null ? null : opts.stores.get(r.defaultStoreId)!;
      kept.groupId ??= r.groupId == null ? null : opts.groups.get(r.groupId)!;
      if (kept.sizeAmount == null && kept.sizeUnit == null && kept.container == null) {
        Object.assign(kept, { sizeAmount: r.sizeAmount, sizeUnit: r.sizeUnit, container: r.container });
      }
      continue;
    }
    const id = newId();
    products.set(r.id, id);
    byKey.set(nameKey, rows.length);
    rows.push({
      id,
      householdId,
      name: r.name,
      nameKey,
      barcode: r.barcode,
      brand: r.brand,
      imageUrl: r.imageUrl,
      sizeAmount: r.sizeAmount,
      sizeUnit: r.sizeUnit,
      container: r.container,
      defaultStoreId: r.defaultStoreId == null ? null : opts.stores.get(r.defaultStoreId)!,
      groupId: r.groupId == null ? null : opts.groups.get(r.groupId)!,
      createdAt: new Date(r.createdAt),
    });
  }

  const forListRow = (r: Backup["shoppingListItems"][number]): string | null => {
    if (r.productId != null) return products.get(r.productId)!;
    const name = r.freeText?.trim();
    const nameKey = name ? productNameKey(name) : "";
    if (!name || !nameKey) return null;
    const at = byKey.get(nameKey);
    if (at != null) return rows[at].id;
    const id = newId();
    byKey.set(nameKey, rows.length);
    rows.push({
      id,
      householdId,
      name,
      nameKey,
      barcode: null,
      brand: null,
      imageUrl: null,
      sizeAmount: null,
      sizeUnit: null,
      container: null,
      defaultStoreId: null,
      groupId: null,
      createdAt: new Date(r.createdAt),
    });
    return id;
  };

  return { products, rows, forListRow };
}

/** What a restore will really insert for groceries, after look-alikes fold and older
 * free-text rows become items: the restore preview's counts. */
export function pantryCounts(b: Backup): { products: number; listItems: number } {
  let n = 0;
  const fake = () => `count-${n++}`;
  const pantry = remapPantry(b, {
    householdId: "",
    newId: fake,
    stores: new Map(b.stores.map((s) => [s.id, s.id])),
    groups: new Map(b.productGroups.map((g) => [g.id, g.id])),
  });
  // forListRow adds items for free-text rows, so count list rows first.
  const listItems = b.shoppingListItems.filter((r) => pantry.forListRow(r) != null).length;
  return { products: pantry.rows.length, listItems };
}
