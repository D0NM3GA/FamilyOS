import { afterAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildBackup } from "./build";
import { applyRestore, previewRestore, SERVER_TIME_ZONE } from "./restore";
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, type Backup } from "./schema";
import { parseBackupFile } from "./plan";
import { newEgg } from "@/lib/pet/state";

/**
 * Restore against a real database (Phase 16.5): `npm run test:db` (needs the dev Postgres
 * from docker compose). Skipped by plain `npm test`. Everything runs in throwaway
 * households that are deleted afterwards; other households are checked untouched.
 */
const RUN = import.meta.env.MODE === "db";

const tag = `e2e-${Date.now()}`;
const T = "2026-01-01T05:00:00.000Z";
const T2 = "2026-02-01T05:00:00.000Z";

function fixture(): Backup {
  const P = (id: string, o: Partial<Backup["people"][number]>) => ({
    id, firstName: id, lastName: "Tester", isHouseholdMember: true, role: "ADULT" as const, color: null, email: null, phone: null,
    notes: null, notesAdultsOnly: false, contactCadenceDays: null, lastContactedAt: null, createdAt: T, ...o,
  });
  return {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: T, exportedTimeZone: SERVER_TIME_ZONE(),
    databaseMigration: null,
    household: { name: "Fixture Family", timezone: "America/New_York", latitude: 40.71, longitude: -74.01, familyGoalStickers: 200, familyGoalTitle: "Pizza night", appName: "FixtureOS",
      disabledApps: ["store", "cars"],
      setupReviewed: ["look"],
      themeColor: "forest", rewardOne: "star", rewardMany: "stars", rewardStore: "Star Shop", mascotOn: false, mascotName: "Clover", appIcon: "LETTER",
      petCareHours: { weekday: [{ start: 420, end: 480 }, { start: 900, end: 1200 }], weekend: [{ start: 540, end: 1260 }] },
    },
    people: [
      P("Mom", { email: `mom-${tag}@example.com`, role: "ADMIN", phone: "555-1", notes: "note", notesAdultsOnly: true, contactCadenceDays: 7, lastContactedAt: T2 }),
      P("Kid", { role: "KID", color: "SKY" }),
      P("Kid2", { role: "KID", createdAt: T2 }),
      P("Doc", { isHouseholdMember: false, role: null, email: `mom-${tag}@example.com`, phone: "555-9" }),
      P("Pharm", { isHouseholdMember: false, role: null }),
    ],
    importantDates: [
      { id: "d1", personId: "Kid", type: "BIRTHDAY", label: null, month: 5, day: 3, year: 2018 },
      { id: "d2", personId: "Doc", type: "OTHER", label: "Checkup", month: 9, day: 1, year: null },
    ],
    interactions: [{ id: "i1", personId: "Doc", type: "CALL", occurredAt: T, note: "hi", adultsOnly: true, loggedById: "Mom", createdAt: T }],
    relationships: [
      { id: "r1", fromId: "Mom", toId: "Kid", type: "PARENT", label: null, createdAt: T },
      { id: "r2", fromId: "Kid", toId: "Mom", type: "CHILD", label: null, createdAt: T },
    ],
    taskDefinitions: [
      { id: "def1", title: "Dishes", notes: null, domain: "CHORE", frequencyType: "DAILY", interval: null, daysOfWeek: [], startDate: T,
        timesOfDay: [], weatherSensitive: true, points: 5, assignmentStrategy: "ROUND_ROBIN", assigneeIds: ["Kid", "Kid2", "Mom"], active: true, createdAt: T },
      { id: "def2", title: "Vitamin", notes: "with food", domain: "MED", frequencyType: "DAYS_OF_WEEK", interval: null, daysOfWeek: [1, 3], startDate: T,
        timesOfDay: ["08:00", "20:00"], weatherSensitive: false, points: 0, assignmentStrategy: "FIXED", assigneeIds: ["Kid"], active: true, createdAt: T2 },
    ],
    taskInstances: [
      { id: "ti1", definitionId: "def1", dueDate: T, assignedToId: "Kid", status: "DONE", completedAt: T, completedById: "Kid", quantityConsumed: null, createdAt: T },
      { id: "ti2", definitionId: "def1", dueDate: T2, assignedToId: "Kid2", status: "PENDING", completedAt: null, completedById: null, quantityConsumed: null, createdAt: T2 },
      { id: "ti3", definitionId: "def2", dueDate: T, assignedToId: "Kid", status: "DONE", completedAt: T, completedById: "Mom", quantityConsumed: 1.5, createdAt: T },
    ],
    pointsLedger: [
      { id: "pl1", personId: "Kid", delta: 5, reason: null, instanceId: "ti1", orderId: null, createdAt: T },
      { id: "pl2", personId: "Kid", delta: -3, reason: "Ice cream", instanceId: null, orderId: "ro1", createdAt: T2 },
    ],
    rewards: [
      { id: "rw1", title: "Ice cream", pointCost: 3, active: true, emoji: "🍦", bucketId: "rb1", limitPerWeek: 1, needsApproval: true, createdAt: T },
    ],
    rewardBuckets: [{ id: "rb1", name: "Little treats", emoji: "🍬", createdAt: T }],
    rewardOrders: [
      { id: "ro1", rewardId: "rw1", personId: "Kid", placedById: "Kid", title: "Ice cream", emoji: "🍦", cost: 3, status: "DELIVERED",
        note: null, decidedAt: T2, decidedById: "Mom", closedAt: T2, closedById: "Mom", createdAt: T2 },
    ],
    medications: [{ id: "m1", taskDefinitionId: "def2", quantityOnHand: 28.5, doseAmount: 1.5, refillThresholdQuantity: 5, prescriberId: "Doc", pharmacyId: "Pharm" }],
    vehicles: [{ id: "v1", name: "Van", make: "Honda", model: "Odyssey", year: 2019, currentMileage: 50000, mileageUpdatedAt: T2, active: true, createdAt: T }],
    maintenanceItems: [{ id: "mi1", vehicleId: "v1", title: "Oil", notes: null, intervalMiles: 5000, intervalMonths: 6, lastDoneMileage: 48000, lastDoneAt: T, active: true, createdAt: T }],
    serviceLogs: [{ id: "sl1", itemId: "mi1", doneAt: T, mileage: 48000, notes: "Jiffy", costCents: 5999, loggedById: "Mom", createdAt: T }],
    fuelLogs: [{ id: "f1", vehicleId: "v1", filledAt: T2, mileage: 50000, gallons: 15.2, costCents: 4500, fullTank: true, missedPrevious: false, notes: null, loggedById: "Kid", createdAt: T2 }],
    recallAcks: [{ id: "ra1", vehicleId: "v1", campaignNumber: "24V001", acknowledgedAt: T2, acknowledgedById: "Mom" }],
    vehicleSupplies: [
      { id: "vs1", name: `Motor oil ${tag}`, partNumber: "5W30", unit: "qt", quantityOnHand: 7.5, lowThreshold: 5, notes: null, active: true, createdAt: T },
      { id: "vs2", name: "Wiper blades", partNumber: null, unit: null, quantityOnHand: null, lowThreshold: null, notes: "Van only", active: false, createdAt: T2 },
    ],
    vehicleItemSupplies: [{ itemId: "mi1", supplyId: "vs1", quantity: 5 }],
    vehicleServiceSupplyUses: [{ logId: "sl1", supplyId: "vs1", quantity: 4.5 }],
    schoolProfiles: [
      { id: "sp1", personId: "Kid", schoolName: "Lincoln", grade: "3rd", schoolYear: "2026-27", transportNotes: "Bus 14", lunchNotes: null, scheduleNotes: null, notes: null, createdAt: T },
    ],
    schoolContacts: [{ profileId: "sp1", personId: "Doc", role: "Homeroom teacher" }],
    schoolTasks: [
      { id: "st1", kidPersonId: "Kid", title: "Field trip slip", kind: "FEE", dueDate: T2, amountCents: 1250, ownerPersonId: "Mom", status: "OPEN", doneAt: null, notes: null, createdAt: T },
    ],
    schoolAssignments: [
      { id: "sa1", profileId: "sp1", className: "Math", title: "Ch 3", dueDate: T2, status: "DONE", score: 18, maxScore: 20, notes: null, source: "MANUAL", externalId: null, doneAt: T2, createdAt: T },
    ],
    stores: [{ id: "s1", name: "Kroger", createdAt: T }],
    productGroups: [{ id: "g1", name: "Dairy", emoji: "🥛", sortOrder: 1, starterKey: "dairy", createdAt: T }],
    products: [
      { id: "p1", name: "Eggs", barcode: `bc-${tag}`, brand: "Happy", imageUrl: null, sizeAmount: 12, sizeUnit: "count", container: "carton", defaultStoreId: "s1", groupId: "g1", createdAt: T },
      { id: "p2", name: "Paper towels", barcode: null, brand: null, imageUrl: null, sizeAmount: 12, sizeUnit: "rolls", container: "pack", defaultStoreId: null, groupId: null, createdAt: T },
      { id: "p3", name: "Birthday candles", barcode: null, brand: null, imageUrl: null, sizeAmount: null, sizeUnit: null, container: null, defaultStoreId: null, groupId: null, createdAt: T2 },
    ],
    shoppingListItems: [
      { id: "li1", productId: "p1", quantity: 2, done: false, kidPick: true, addedById: "Mom", requestedById: "Kid", createdAt: T },
      { id: "li2", productId: "p3", quantity: 1, done: true, kidPick: false, addedById: null, requestedById: null, createdAt: T2 },
    ],
    purchases: [{ id: "pu1", purchasedAt: T, purchasedById: "Mom" }],
    purchaseItems: [{ id: "pi1", purchaseId: "pu1", productId: "p2", description: "Paper towels", quantity: 6, requestedById: "Kid", kidPick: false }],
    itemPrices: [{ id: "ip1", productId: "p2", storeId: "s1", totalCents: 1299, quantity: 1, unitCents: 1299, observedAt: T }],
    receiptAliases: [{ id: "ra1", textKey: `ppr twl ${tag}`, productId: "p2" }],
    pets: [{ id: "pet1", personId: "Kid", name: "Pip", seed: "seed-1", state: { ...newEgg("bird", 1000), stage: "baby", bond: 4, recentSnacks: [990, 995] }, bornAt: T, lastAdvancedAt: T2, createdAt: T }],
    petItems: [
      { id: "pit1", personId: "Kid", itemId: "ball", place: "out", createdAt: T },
      { id: "pit2", personId: "Kid", itemId: "party-hat", place: null, createdAt: T2 },
    ],
    petPlays: [{ personId: "Kid", game: "catch", paidAt: T2 }],
    petMemorials: [
      { id: "pm1", personId: "Kid", name: "Old Pip", species: "blob", stage: "adult", form: 3, cause: "old-age", ageMinutes: 7000, favoriteToy: "ball", bornAt: T, goneAt: T2, createdAt: T2 },
    ],
    petGifts: [
      { id: "pg1", personId: "Kid", instanceId: "ti1", day: "2026-01-01", itemId: "ball", grantedAt: T, openedAt: T2 },
      { id: "pg2", personId: "Kid", instanceId: null, day: "2026-02-01", itemId: null, grantedAt: T2, openedAt: null },
    ],
    petDiscoveries: [
      { personId: "Kid", species: "blob", stage: "adult", form: 3, foundAt: T },
      { personId: "Kid", species: "bird", stage: "baby", form: 0, foundAt: T2 },
      { personId: "Kid2", species: "bird", stage: "baby", form: 0, foundAt: T2 },
    ],
    sealedMoney: null,
  };
}

// Which table each reference field points at.
const REFS: Record<string, Record<string, string>> = {
  importantDates: { personId: "people" },
  interactions: { personId: "people", loggedById: "people" },
  relationships: { fromId: "people", toId: "people" },
  taskDefinitions: { assigneeIds: "people" },
  taskInstances: { definitionId: "taskDefinitions", assignedToId: "people", completedById: "people" },
  pointsLedger: { personId: "people", instanceId: "taskInstances", orderId: "rewardOrders" },
  rewards: { bucketId: "rewardBuckets" },
  rewardOrders: { rewardId: "rewards", personId: "people", placedById: "people", decidedById: "people", closedById: "people" },
  medications: { taskDefinitionId: "taskDefinitions", prescriberId: "people", pharmacyId: "people" },
  maintenanceItems: { vehicleId: "vehicles" },
  serviceLogs: { itemId: "maintenanceItems", loggedById: "people" },
  fuelLogs: { vehicleId: "vehicles", loggedById: "people" },
  recallAcks: { vehicleId: "vehicles", acknowledgedById: "people" },
  vehicleItemSupplies: { itemId: "maintenanceItems", supplyId: "vehicleSupplies" },
  vehicleServiceSupplyUses: { logId: "serviceLogs", supplyId: "vehicleSupplies" },
  schoolProfiles: { personId: "people" },
  schoolContacts: { profileId: "schoolProfiles", personId: "people" },
  schoolTasks: { kidPersonId: "people", ownerPersonId: "people" },
  schoolAssignments: { profileId: "schoolProfiles" },
  products: { defaultStoreId: "stores", groupId: "productGroups" },
  shoppingListItems: { productId: "products", addedById: "people", requestedById: "people" },
  purchases: { purchasedById: "people" },
  purchaseItems: { purchaseId: "purchases", productId: "products", requestedById: "people" },
  itemPrices: { productId: "products", storeId: "stores" },
  receiptAliases: { productId: "products" },
  pets: { personId: "people" },
  petItems: { personId: "people" },
  petPlays: { personId: "people" },
  petMemorials: { personId: "people" },
  petGifts: { personId: "people", instanceId: "taskInstances" },
  petDiscoveries: { personId: "people" },
};
const HEADER = new Set(["format", "schemaVersion", "exportedAt", "exportedTimeZone", "databaseMigration", "household", "sealedMoney"]);

/** JSON with object keys sorted: Postgres jsonb (a pet's state) doesn't keep key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Ids replaced by a content key of the row they point at (recursively), tables sorted. */
function normalize(b: Backup, dropPeople: Set<string> = new Set()) {
  const t = b as unknown as Record<string, Record<string, unknown>[]>;
  const byId = new Map<string, [string, Record<string, unknown>]>();
  for (const [name, rows] of Object.entries(t)) if (!HEADER.has(name)) for (const r of rows) byId.set(`${name}:${r.id}`, [name, r]);
  const key = (table: string, row: Record<string, unknown>): string => {
    const refs = REFS[table] ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "id") continue;
      const target = refs[k];
      if (!target) out[k] = v;
      else if (Array.isArray(v)) out[k] = v.map((id) => key(target, byId.get(`${target}:${id}`)![1])).sort();
      else out[k] = v == null ? null : key(target, byId.get(`${target}:${v}`)![1]);
    }
    return stable(out);
  };
  const result: Record<string, unknown> = { household: b.household };
  for (const [name, rows] of Object.entries(t)) {
    if (HEADER.has(name)) continue;
    result[name] = rows.filter((r) => !(name === "people" && dropPeople.has(r.id as string))).map((r) => key(name, r)).sort();
  }
  return result;
}

async function counts(householdId: string) {
  return {
    people: await prisma.person.count({ where: { householdId } }),
    defs: await prisma.taskDefinition.count({ where: { householdId } }),
    vehicles: await prisma.vehicle.count({ where: { householdId } }),
    products: await prisma.product.count({ where: { householdId } }),
    listItems: await prisma.shoppingListItem.count({ where: { list: { householdId } } }),
    pets: await prisma.pet.count({ where: { householdId } }),
  };
}

const created: { households: string[]; users: string[] } = { households: [], users: [] };
async function household(name: string) {
  const h = await prisma.household.create({ data: { name } });
  created.households.push(h.id);
  return h.id;
}
async function linkedPerson(householdId: string, email: string, personEmail: string | null, role: "ADMIN" | "ADULT", firstName: string) {
  const u = await prisma.user.create({ data: { name: firstName, email } });
  created.users.push(u.id);
  return prisma.person.create({
    data: { householdId, firstName, email: personEmail, role, isHouseholdMember: true, authUserId: u.id, pinHash: "keep-me" },
  });
}

/** Preview then apply, the way the page does. */
async function restore(householdId: string, viewerId: string, file: Backup, allowTimeZoneMismatch = false) {
  const preview = await previewRestore(householdId, file);
  if (!preview.ok) return preview;
  return applyRestore(householdId, viewerId, file, { allowTimeZoneMismatch, expectedPlanDigest: preview.preview.planDigest });
}

describe.skipIf(!RUN)("restore (database)", () => {
  const ctx = {} as { h1: string; h2: string; h3: string; a2: string; kept: string; B1: Backup; others: [string, string][] };

  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: { in: created.households } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  });

  test("fixture -> household -> backup is lossless", async () => {
    const others = await prisma.household.findMany({ select: { id: true } });
    ctx.others = await Promise.all(others.map(async (h) => [h.id, JSON.stringify(await counts(h.id))] as [string, string]));
    ctx.h1 = await household(`e2e h1 ${tag}`);
    const a1 = await linkedPerson(ctx.h1, `mom-${tag}@example.com`, null, "ADMIN", "Signed-in mom");
    const F = fixture();
    const p1 = await previewRestore(ctx.h1, F);
    expect(p1.ok && p1.preview.matched.length).toBe(1); // matched by the sign-in email
    // Phase 28: the audit trail outlives a restore.
    await prisma.backupEvent.create({ data: { householdId: ctx.h1, actorId: a1.id, kind: "HOUSEHOLD_BACKUP", fileSha256: "x", bytes: 1 } });
    expect(await restore(ctx.h1, a1.id, F)).toMatchObject({ ok: true });
    expect(await prisma.backupEvent.count({ where: { householdId: ctx.h1 } })).toBe(1);
    ctx.B1 = await buildBackup(ctx.h1);
    expect(normalize(ctx.B1)).toEqual(normalize(F));
  });

  test("rejections change nothing", async () => {
    // A linked admin (email differs in case, only on the sign-in), a linked adult not in the
    // file, and junk: an unlinked kid with a PIN, a contact sharing the admin's email, a
    // vehicle, a product with the file's barcode, a chore.
    ctx.h2 = await household(`e2e h2 ${tag}`);
    ctx.a2 = (await linkedPerson(ctx.h2, `MOM-${tag.toUpperCase()}@EXAMPLE.COM`, null, "ADMIN", "Other mom")).id;
    ctx.kept = (await linkedPerson(ctx.h2, `dad-${tag}@example.com`, `dad-${tag}@example.com`, "ADULT", "Dad")).id;
    await prisma.person.create({ data: { householdId: ctx.h2, firstName: "Junk kid", role: "KID", isHouseholdMember: true, pinHash: "junk" } });
    await prisma.person.create({ data: { householdId: ctx.h2, firstName: "Junk contact", isHouseholdMember: false, email: `mom-${tag}@example.com` } });
    await prisma.vehicle.create({ data: { householdId: ctx.h2, name: "Junk car" } });
    await prisma.product.create({ data: { householdId: ctx.h2, name: "Junk eggs", nameKey: "junk egg", barcode: `bc-${tag}` } });
    await prisma.taskDefinition.create({
      data: { householdId: ctx.h2, title: "Junk chore", domain: "CHORE", frequencyType: "DAILY", startDate: new Date(T) },
    });

    const before = JSON.stringify(await counts(ctx.h2));
    expect((await restore(ctx.h2, ctx.a2, { ...ctx.B1, exportedTimeZone: "Pacific/Kiritimati" })).ok).toBe(false);
    const broken = structuredClone(ctx.B1);
    broken.fuelLogs[0].vehicleId = "nope";
    expect((await restore(ctx.h2, ctx.a2, broken)).ok).toBe(false);
    const dupe = structuredClone(ctx.B1);
    dupe.people.push({ ...dupe.people.find((p) => p.email?.startsWith("mom-") && p.isHouseholdMember)!, id: "dupe-mom" });
    expect((await restore(ctx.h2, ctx.a2, dupe)).ok).toBe(false);

    // Someone signs in with Microsoft for the first time between preview and apply.
    const preview = await previewRestore(ctx.h2, ctx.B1);
    if (!preview.ok) throw new Error("preview failed");
    const late = await linkedPerson(ctx.h2, `late-${tag}@example.com`, null, "ADULT", "Late");
    const stale = await applyRestore(ctx.h2, ctx.a2, ctx.B1, { allowTimeZoneMismatch: false, expectedPlanDigest: preview.preview.planDigest });
    expect(stale.ok).toBe(false);
    await prisma.person.delete({ where: { id: late.id } });

    expect(JSON.stringify(await counts(ctx.h2))).toBe(before);
  });

  test("replace: junk gone, linked people kept, the matched admin keeps role, login and PIN", async () => {
    // Phase 47: a kept person's own pet goes too (the file's pets replace every one here).
    await prisma.pet.create({
      data: { householdId: ctx.h2, personId: ctx.kept, name: "Junk pet", seed: "junk", state: newEgg("blob", 0), lastAdvancedAt: new Date(T) },
    });
    const r2 = await restore(ctx.h2, ctx.a2, ctx.B1);
    if (!r2.ok) throw new Error(r2.errors.join("; "));
    expect(r2.previousBackup.vehicles.map((v) => v.name)).toContain("Junk car");
    const B2 = await buildBackup(ctx.h2);
    expect(B2.people.some((p) => p.id === ctx.kept)).toBe(true);
    expect(normalize(B2, new Set([ctx.kept]))).toEqual(normalize(ctx.B1));

    const admin = await prisma.person.findUniqueOrThrow({ where: { id: ctx.a2 }, omit: { pinHash: false } });
    expect(admin).toMatchObject({ role: "ADMIN", pinHash: "keep-me", firstName: "Mom" });
    expect(admin.authUserId).not.toBeNull();
    const kids = await prisma.person.findMany({ where: { householdId: ctx.h2, role: "KID" }, omit: { pinHash: false } });
    expect(kids.map((k) => k.pinHash)).toEqual([null, null]);
    const kept = await prisma.person.findUniqueOrThrow({ where: { id: ctx.kept }, omit: { pinHash: false } });
    expect(kept.pinHash).toBe("keep-me");

    // Idempotent, and the automatic snapshot restores (new ids never collide).
    expect((await restore(ctx.h2, ctx.a2, ctx.B1)).ok).toBe(true);
    expect(normalize(await buildBackup(ctx.h2), new Set([ctx.kept]))).toEqual(normalize(ctx.B1));
    expect((await restore(ctx.h2, ctx.a2, r2.previousBackup, true)).ok).toBe(true);
    const back = await buildBackup(ctx.h2);
    expect(back.vehicles.map((v) => v.name)).toContain("Junk car");
    expect(back.pets.map((p) => p.name)).toContain("Junk pet");
  });

  test("a pet round-trips with its state, seed, items, payouts and memories (Phase 47)", async () => {
    const pet = await prisma.pet.findFirstOrThrow({ where: { householdId: ctx.h1 }, include: { person: { select: { firstName: true } } } });
    expect(pet).toMatchObject({ name: "Pip", seed: "seed-1", person: { firstName: "Kid" } });
    expect(pet.state).toMatchObject({ species: "bird", stage: "baby", bond: 4, recentSnacks: [990, 995] });
    expect(await prisma.petItem.count({ where: { householdId: ctx.h1, personId: pet.personId } })).toBe(2);
    expect(await prisma.petPlay.count({ where: { personId: pet.personId } })).toBe(1);
    expect(await prisma.petMemorial.count({ where: { householdId: ctx.h1, personId: pet.personId } })).toBe(1);
    // The present remembers its chore: the restored instance, not the file's id.
    const gifts = await prisma.petGift.findMany({
      where: { householdId: ctx.h1, personId: pet.personId },
      select: { day: true, instance: { select: { dueDate: true, definition: { select: { title: true } } } } },
      orderBy: { day: "asc" },
    });
    expect(gifts).toEqual([
      { day: "2026-01-01", instance: { dueDate: new Date(T), definition: { title: "Dishes" } } },
      { day: "2026-02-01", instance: null },
    ]);
    const h = await prisma.household.findUniqueOrThrow({ where: { id: ctx.h1 }, select: { petCareHours: true } });
    expect(h.petCareHours).toEqual(fixture().household.petCareHours);
    // Phase 54: the collection book, each entry on the restored person.
    const book = await prisma.petDiscovery.findMany({
      where: { householdId: ctx.h1 },
      select: { species: true, stage: true, form: true, foundAt: true, person: { select: { firstName: true } } },
      orderBy: [{ person: { firstName: "asc" } }, { foundAt: "asc" }],
    });
    expect(book).toEqual([
      { species: "blob", stage: "adult", form: 3, foundAt: new Date(T), person: { firstName: "Kid" } },
      { species: "bird", stage: "baby", form: 0, foundAt: new Date(T2), person: { firstName: "Kid" } },
      { species: "bird", stage: "baby", form: 0, foundAt: new Date(T2), person: { firstName: "Kid2" } },
    ]);
  });

  test("a pet whose state doesn't read is dropped, and the rest restores (Phase 47)", async () => {
    ctx.h3 = await household(`e2e h3 ${tag}`);
    const admin = await linkedPerson(ctx.h3, `h3-${tag}@example.com`, `mom-${tag}@example.com`, "ADMIN", "Third mom");
    const file = structuredClone(ctx.B1);
    const kid2 = file.people.find((p) => p.firstName === "Kid2")!;
    file.pets.push({ ...file.pets[0], id: "bad-pet", personId: kid2.id, name: "Glitch", state: { species: "dragon", stage: "egg" } });
    const preview = await previewRestore(ctx.h3, file);
    expect(preview.ok && preview.preview.inserts.pets).toBe(1);
    const r = await restore(ctx.h3, admin.id, file);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect((await prisma.pet.findMany({ where: { householdId: ctx.h3 }, select: { name: true } })).map((p) => p.name)).toEqual(["Pip"]);
    expect(await prisma.petMemorial.count({ where: { householdId: ctx.h3 } })).toBe(1);
  });

  test("a v7 file, from before the pet, still restores and clears today's pets (Phase 47)", async () => {
    const old = structuredClone(ctx.B1) as unknown as Record<string, unknown>;
    old.schemaVersion = 7;
    for (const k of ["pets", "petItems", "petPlays", "petMemorials", "petGifts", "petDiscoveries"]) delete old[k];
    delete (old.household as Record<string, unknown>).petCareHours;
    const parsed = parseBackupFile(JSON.stringify(old));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const admin = await prisma.person.findFirstOrThrow({ where: { householdId: ctx.h3, role: "ADMIN", authUserId: { not: null } } });
    const preview = await previewRestore(ctx.h3, parsed.backup);
    expect(preview.ok && preview.preview.deletes).toMatchObject({ pets: 1, "pet memories": 1, "pet collection book entries": 3 });
    const r = await restore(ctx.h3, admin.id, parsed.backup);
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.previousBackup.pets).toHaveLength(1);
    expect(await prisma.pet.count({ where: { householdId: ctx.h3 } })).toBe(0);
    expect(await prisma.petItem.count({ where: { householdId: ctx.h3 } })).toBe(0);
    expect(await prisma.petPlay.count({ where: { person: { householdId: ctx.h3 } } })).toBe(0);
    expect(await prisma.petGift.count({ where: { householdId: ctx.h3 } })).toBe(0);
    expect(await prisma.petDiscovery.count({ where: { householdId: ctx.h3 } })).toBe(0);
    expect(await prisma.household.findUniqueOrThrow({ where: { id: ctx.h3 }, select: { petCareHours: true } })).toEqual({ petCareHours: null });
    expect(await prisma.person.count({ where: { householdId: ctx.h3 } })).toBe(5);
  });

  test("other households are untouched", async () => {
    const after = await Promise.all(ctx.others.map(async ([id]) => [id, JSON.stringify(await counts(id))]));
    expect(after).toEqual(ctx.others);
    expect(await prisma.person.count({ where: { householdId: ctx.h1 } })).toBe(5);
  });
});
