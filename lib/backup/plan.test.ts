import { describe, expect, test, vi } from "vitest";

// plan.ts reaches lib/prisma through lib/household-settings; nothing here touches a DB.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  checkReferences,
  checkUniques,
  normalizeHousehold,
  parseBackupFile,
  pantryCounts,
  planPeople,
  remapBackup,
  timeZoneMismatch,
  type LinkedPerson,
} from "./plan";
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, type Backup } from "./schema";

const T = "2026-01-01T00:00:00.000Z";
const SENTINEL = "SENTINEL_7f3a_do_not_leak";

const person = (id: string, over: Partial<Backup["people"][number]> = {}): Backup["people"][number] => ({
  id,
  firstName: id.toUpperCase(),
  lastName: null,
  isHouseholdMember: true,
  role: "ADULT",
  email: null,
  phone: null,
  notes: null,
  notesAdultsOnly: false,
  contactCadenceDays: null,
  lastContactedAt: null,
  createdAt: T,
  ...over,
});

const linked = (id: string, over: Partial<LinkedPerson> = {}): LinkedPerson => ({
  id,
  firstName: id.toUpperCase(),
  email: null,
  authEmail: null,
  isHouseholdMember: true,
  ...over,
});

function emptyBackup(): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: T,
    exportedTimeZone: "America/New_York",
    databaseMigration: null,
    household: { name: "Our Family", timezone: null, latitude: null, longitude: null, familyGoalStickers: null, familyGoalTitle: null, appName: null, disabledApps: [], setupReviewed: [], ...LOOK_DEFAULTS },
    people: [],
    importantDates: [],
    interactions: [],
    relationships: [],
    taskDefinitions: [],
    taskInstances: [],
    pointsLedger: [],
    rewards: [],
    rewardBuckets: [],
    rewardOrders: [],
    medications: [],
    vehicles: [],
    maintenanceItems: [],
    serviceLogs: [],
    fuelLogs: [],
    recallAcks: [],
    vehicleSupplies: [],
    vehicleItemSupplies: [],
    vehicleServiceSupplyUses: [],
    schoolProfiles: [],
    schoolContacts: [],
    schoolTasks: [],
    schoolAssignments: [],
    stores: [],
    productGroups: [],
    products: [],
    shoppingListItems: [],
    purchases: [],
    purchaseItems: [],
    itemPrices: [],
    receiptAliases: [],
    sealedMoney: null,
  };
}

/** One row of every table, every reference filled in. */
function fullBackup(): Backup {
  const b = emptyBackup();
  b.people = [
    person("mom", { email: "Mom@Example.com", role: "ADMIN" }),
    person("kid", { role: "KID" }),
    person("doc", { isHouseholdMember: false, role: null, email: "mom@example.com" }),
  ];
  b.importantDates = [{ id: "d1", personId: "kid", type: "BIRTHDAY", label: null, month: 5, day: 3, year: 2018 }];
  b.interactions = [{ id: "i1", personId: "doc", type: "CALL", occurredAt: T, note: null, adultsOnly: false, loggedById: "mom", createdAt: T }];
  b.relationships = [{ id: "r1", fromId: "mom", toId: "kid", type: "PARENT", label: null, createdAt: T }];
  b.taskDefinitions = [
    {
      id: "def1",
      title: "Dishes",
      notes: null,
      domain: "CHORE",
      frequencyType: "DAILY",
      interval: null,
      daysOfWeek: [],
      startDate: T,
      timesOfDay: [],
      weatherSensitive: false,
      points: 5,
      assignmentStrategy: "FIXED",
      assigneeIds: ["kid", "mom"],
      active: true,
      createdAt: T,
    },
  ];
  b.taskInstances = [
    { id: "ti1", definitionId: "def1", dueDate: T, assignedToId: "kid", status: "DONE", completedAt: T, completedById: "kid", quantityConsumed: null, createdAt: T },
  ];
  b.pointsLedger = [{ id: "pl1", personId: "kid", delta: 5, reason: null, instanceId: "ti1", orderId: null, createdAt: T }];
  b.rewards = [{ id: "rw1", title: "Ice cream", pointCost: 50, active: true, emoji: null, bucketId: null, limitPerWeek: null, needsApproval: false, createdAt: T }];
  b.medications = [
    { id: "m1", taskDefinitionId: "def1", quantityOnHand: 30, doseAmount: 1, refillThresholdQuantity: 5, prescriberId: "doc", pharmacyId: null },
  ];
  b.vehicles = [{ id: "v1", name: "Van", make: null, model: null, year: null, currentMileage: 100, mileageUpdatedAt: T, active: true, createdAt: T }];
  b.maintenanceItems = [
    { id: "mi1", vehicleId: "v1", title: "Oil", notes: null, intervalMiles: 5000, intervalMonths: null, lastDoneMileage: null, lastDoneAt: null, active: true, createdAt: T },
  ];
  b.serviceLogs = [{ id: "sl1", itemId: "mi1", doneAt: T, mileage: 90, notes: null, costCents: null, loggedById: "mom", createdAt: T }];
  b.fuelLogs = [
    { id: "f1", vehicleId: "v1", filledAt: T, mileage: 95, gallons: 10, costCents: null, fullTank: true, missedPrevious: false, notes: null, loggedById: "kid", createdAt: T },
  ];
  b.recallAcks = [{ id: "ra1", vehicleId: "v1", campaignNumber: "24V001", acknowledgedAt: T, acknowledgedById: "mom" }];
  b.vehicleSupplies = [
    { id: "vs1", name: "Motor oil", partNumber: "5W30", unit: "qt", quantityOnHand: 7, lowThreshold: 5, notes: null, active: true, createdAt: T },
  ];
  b.vehicleItemSupplies = [{ itemId: "mi1", supplyId: "vs1", quantity: 5 }];
  b.vehicleServiceSupplyUses = [{ logId: "sl1", supplyId: "vs1", quantity: 5 }];
  b.schoolProfiles = [
    { id: "sp1", personId: "kid", schoolName: "Lincoln", grade: "3rd", schoolYear: null, transportNotes: null, lunchNotes: null, scheduleNotes: null, notes: null, createdAt: T },
  ];
  b.schoolContacts = [{ profileId: "sp1", personId: "doc", role: "Teacher" }];
  b.schoolTasks = [
    { id: "st1", kidPersonId: "kid", title: "Slip", kind: "FORM", dueDate: T, amountCents: 500, ownerPersonId: "mom", status: "OPEN", doneAt: null, notes: null, createdAt: T },
  ];
  b.schoolAssignments = [
    { id: "sa1", profileId: "sp1", className: "Math", title: "Quiz", dueDate: T, status: "DONE", score: 9, maxScore: 10, notes: null, source: "MANUAL", externalId: null, doneAt: T, createdAt: T },
  ];
  b.stores = [{ id: "s1", name: "Kroger", createdAt: T }];
  b.productGroups = [{ id: "g1", name: "Dairy", emoji: "🥛", sortOrder: 1, starterKey: "dairy", createdAt: T }];
  b.products = [
    { id: "p1", name: "Eggs", barcode: "123", brand: null, imageUrl: null, sizeAmount: 12, sizeUnit: "count", container: "carton", defaultStoreId: "s1", groupId: "g1", createdAt: T },
  ];
  b.shoppingListItems = [
    { id: "li1", productId: "p1", quantity: 1, done: false, kidPick: true, addedById: "mom", requestedById: "kid", createdAt: T },
  ];
  b.purchases = [{ id: "pu1", purchasedAt: T, purchasedById: "mom" }];
  b.purchaseItems = [{ id: "pi1", purchaseId: "pu1", productId: "p1", description: "Eggs", quantity: 1, requestedById: "kid", kidPick: true }];
  b.itemPrices = [{ id: "ip1", productId: "p1", storeId: "s1", totalCents: 499, quantity: 1, unitCents: 499, observedAt: T }];
  b.receiptAliases = [{ id: "ra1", textKey: "lg eggs 12ct", productId: "p1" }];
  return b;
}

describe("parseBackupFile", () => {
  test("accepts a valid file", () => {
    expect(parseBackupFile(JSON.stringify(fullBackup())).ok).toBe(true);
  });

  test("invalid JSON: fixed message, never the input", () => {
    const r = parseBackupFile(`{"people": [${SENTINEL}`);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
  });

  test("schema errors report path and code only, never values", () => {
    const b = fullBackup() as unknown as Record<string, unknown>;
    (b.people as Record<string, unknown>[])[0].role = SENTINEL; // bad enum value
    (b.vehicles as Record<string, unknown>[])[0].year = SENTINEL; // wrong type
    b.format = SENTINEL; // bad literal
    const r = parseBackupFile(JSON.stringify(b));
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain("people.0.role");
  });

  test("caps the number of reported issues", () => {
    const b = fullBackup();
    const bad = Array.from({ length: 50 }, (_, i) => ({ ...person(`x${i}`), createdAt: "nope" }));
    const r = parseBackupFile(JSON.stringify({ ...b, people: bad }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeLessThanOrEqual(22);
      expect(r.errors.at(-1)).toMatch(/more problems/);
    }
  });
});

describe("checkReferences", () => {
  test("a complete file has no problems", () => {
    expect(checkReferences(fullBackup())).toEqual([]);
  });

  test("counts broken references without naming them", () => {
    const b = fullBackup();
    b.fuelLogs[0].loggedById = SENTINEL;
    b.taskDefinitions[0].assigneeIds.push(SENTINEL);
    b.purchaseItems[0].purchaseId = SENTINEL;
    const problems = checkReferences(b);
    expect(problems).toHaveLength(3);
    expect(problems.join()).toContain("fuelLogs.loggedById: 1");
    expect(problems.join()).not.toContain(SENTINEL);
  });

  test("garage-supply links must point at rows in the file", () => {
    const b = fullBackup();
    b.vehicleServiceSupplyUses[0].logId = "gone";
    b.vehicleItemSupplies[0].supplyId = "gone";
    expect(checkReferences(b)).toEqual([
      "vehicleItemSupplies.supplyId: 1 reference(s) to missing rows",
      "vehicleServiceSupplyUses.logId: 1 reference(s) to missing rows",
    ]);
  });

  test("duplicate ids in a table are rejected", () => {
    const b = fullBackup();
    b.vehicles.push({ ...b.vehicles[0], name: "Car" });
    expect(checkReferences(b)).toContain("vehicles: duplicate ids");
  });
});

describe("checkUniques", () => {
  test("a complete file has no problems", () => {
    expect(checkUniques(fullBackup())).toEqual([]);
  });

  test("composite-key rows can't repeat (item, supply) or (service, supply)", () => {
    const b = fullBackup();
    b.vehicleItemSupplies.push({ ...b.vehicleItemSupplies[0], quantity: 1 });
    b.vehicleServiceSupplyUses.push({ ...b.vehicleServiceSupplyUses[0] });
    expect(checkUniques(b)).toEqual([
      "vehicleItemSupplies (item, supply): 1 duplicate(s)",
      "vehicleServiceSupplyUses (service, supply): 1 duplicate(s)",
    ]);
  });

  test("mirrors the database's unique constraints", () => {
    const b = fullBackup();
    b.vehicles.push({ ...b.vehicles[0], id: "v2" });
    b.taskInstances.push({ ...b.taskInstances[0], id: "ti2" });
    b.products.push({ ...b.products[0], id: "p2" });
    b.products.push({ ...b.products[0], id: "p3", barcode: null }); // null barcodes don't collide
    b.products.push({ ...b.products[0], id: "p4", barcode: null });
    // Phase 37: one section per starting key; sections the family added (null) don't collide.
    b.productGroups.push({ ...b.productGroups[0], id: "g2", name: "Milk & eggs" });
    b.productGroups.push({ ...b.productGroups[0], id: "g3", name: "Deli", starterKey: null });
    b.productGroups.push({ ...b.productGroups[0], id: "g4", name: "Flowers", starterKey: null });
    const problems = checkUniques(b);
    expect(problems).toEqual([
      "taskInstances (chore/med, due date): 1 duplicate(s)",
      "vehicles (name): 1 duplicate(s)",
      "productGroups (starting section): 1 duplicate(s)",
      "products (barcode): 1 duplicate(s)",
    ]);
  });
});

describe("planPeople", () => {
  test("matches members by trimmed, case-insensitive email against either email", () => {
    const b = fullBackup();
    const r = planPeople(b, [linked("live-mom", { authEmail: "  mom@EXAMPLE.com " }), linked("live-dad", { email: "dad@example.com" })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.plan.matches]).toEqual([["mom", "live-mom"]]);
    expect(r.plan.keptLinked.map((l) => l.id)).toEqual(["live-dad"]);
    expect(r.plan.newMembers).toBe(1); // kid
    expect(r.plan.newContacts).toBe(1); // doc
  });

  test("never matches a contact, even one sharing a member's email", () => {
    const b = fullBackup();
    b.people = b.people.filter((p) => p.id !== "mom");
    const r = planPeople(b, [linked("live-mom", { email: "mom@example.com" })]);
    expect(r.ok && r.plan.matches.size).toBe(0);
  });

  test("rejects members sharing an email", () => {
    const b = fullBackup();
    b.people.push(person("mom2", { email: "MOM@example.com" }));
    const r = planPeople(b, []);
    expect(r.ok).toBe(false);
  });

  test("rejects a member matching two signed-in people", () => {
    const r = planPeople(fullBackup(), [linked("a", { email: "mom@example.com" }), linked("b", { authEmail: "mom@example.com" })]);
    expect(r.ok).toBe(false);
  });

  test("rejects two members claiming one signed-in person", () => {
    const b = fullBackup();
    b.people.push(person("dad", { email: "dad@example.com" }));
    const r = planPeople(b, [linked("live", { email: "mom@example.com", authEmail: "dad@example.com" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/more than one member/);
  });

  test("counts a match with a removed person", () => {
    const r = planPeople(fullBackup(), [linked("live-mom", { email: "mom@example.com", isHouseholdMember: false })]);
    expect(r.ok && r.plan.matchedButRemoved).toBe(1);
  });

  test("errors never contain emails or names", () => {
    const b = fullBackup();
    b.people.push(person(SENTINEL, { firstName: SENTINEL, email: "mom@example.com" }));
    const r = planPeople(b, [linked("x", { firstName: SENTINEL, email: "mom@example.com" })]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
    expect(JSON.stringify(r)).not.toContain("mom@example.com");
  });
});

describe("timeZoneMismatch", () => {
  test("null when equal, a warning when not", () => {
    expect(timeZoneMismatch(fullBackup(), "America/New_York")).toBeNull();
    expect(timeZoneMismatch(fullBackup(), "UTC")).toMatch(/Dates would shift/);
  });
});

const LOOK_DEFAULTS = { themeColor: null, rewardOne: null, rewardMany: null, rewardStore: null, mascotOn: true, mascotName: null, appIcon: "BUNNY" as const };

describe("normalizeHousehold", () => {
  test("canonicalizes the zone and blanks the name fallback", () => {
    expect(normalizeHousehold({ name: "  ", timezone: "america/new_york", latitude: 40, longitude: -80 })).toEqual({
      name: "Our Family",
      timezone: "America/New_York",
      latitude: 40,
      longitude: -80,
      familyGoalStickers: null,
      familyGoalTitle: null,
      appName: null,
      disabledApps: [],
      setupReviewed: [],
      ...LOOK_DEFAULTS,
    });
  });

  test("rounds home to about a kilometre, and keeps only setup steps that exist (Phase 45)", () => {
    expect(normalizeHousehold({ name: "X", timezone: null, latitude: 40.712776, longitude: -74.005974, setupReviewed: ["look", "nope", "look", "apps"] })).toMatchObject({
      latitude: 40.71,
      longitude: -74.01,
      setupReviewed: ["look", "apps"],
    });
  });

  test("keeps a valid look and drops what Make it yours wouldn't save", () => {
    const h = { name: "X", timezone: null, latitude: null, longitude: null };
    expect(
      normalizeHousehold({ ...h, themeColor: "forest", rewardOne: " acorn ", rewardMany: "acorns", rewardStore: "Acorn Shop", mascotOn: false, mascotName: " Clover ", appIcon: "LETTER" }),
    ).toMatchObject({ themeColor: "forest", rewardOne: "acorn", rewardMany: "acorns", rewardStore: "Acorn Shop", mascotOn: false, mascotName: "Clover", appIcon: "LETTER" });
    expect(normalizeHousehold({ ...h, themeColor: "neon", rewardOne: "acorn", rewardMany: "", rewardStore: "Shop", mascotName: "x".repeat(30) })).toMatchObject({
      themeColor: null,
      rewardOne: null,
      rewardMany: null,
      rewardStore: null,
      mascotName: null,
    });
  });

  test("keeps turned-off apps that have a switch, once each, in order (Phase 36)", () => {
    const h = { name: "X", timezone: null, latitude: null, longitude: null };
    expect(normalizeHousehold({ ...h, disabledApps: ["store", "settings", "garage", "made-up", "chores", "store"] }).disabledApps).toEqual([
      "chores",
      "store",
    ]);
    expect(normalizeHousehold(h).disabledApps).toEqual([]);
  });

  test("keeps a tidy app name and drops one the settings form would refuse", () => {
    const h = { name: "X", timezone: null, latitude: null, longitude: null };
    expect(normalizeHousehold({ ...h, appName: "  Smith\u202EOS " }).appName).toBe("SmithOS");
    expect(normalizeHousehold({ ...h, appName: "x".repeat(40) }).appName).toBeNull();
    expect(normalizeHousehold({ ...h, appName: "   " }).appName).toBeNull();
  });

  test("keeps a sane family goal and drops a bad one", () => {
    const h = { name: "X", timezone: null, latitude: null, longitude: null };
    expect(normalizeHousehold({ ...h, familyGoalStickers: 200, familyGoalTitle: " Pizza " })).toMatchObject({
      familyGoalStickers: 200,
      familyGoalTitle: "Pizza",
    });
    expect(normalizeHousehold({ ...h, familyGoalStickers: -5, familyGoalTitle: "  " })).toMatchObject({
      familyGoalStickers: null,
      familyGoalTitle: null,
    });
  });

  test("an unknown zone becomes null", () => {
    expect(normalizeHousehold({ name: "X", timezone: "Mars/Olympus", latitude: null, longitude: null }).timezone).toBeNull();
  });

  test("out-of-range or half coordinates become both null", () => {
    expect(normalizeHousehold({ name: "X", timezone: null, latitude: 91, longitude: 0 })).toMatchObject({ latitude: null, longitude: null });
    expect(normalizeHousehold({ name: "X", timezone: null, latitude: 10, longitude: null })).toMatchObject({ latitude: null, longitude: null });
  });
});

describe("remapBackup", () => {
  const run = () => {
    let n = 0;
    const b = fullBackup();
    const rows = remapBackup(b, { householdId: "H", listId: "L", personMatches: new Map([["mom", "live-mom"]]), newId: () => `new${++n}` });
    return { b, rows };
  };

  test("no file id survives, except where a matched person reuses the live id", () => {
    const { b, rows } = run();
    const fileIds = new Set(Object.values(b).flatMap((v) => (Array.isArray(v) ? v.flatMap((r: { id?: string }) => (r.id ? [r.id] : [])) : [])));
    const json = JSON.stringify(rows);
    for (const id of fileIds) expect(json).not.toContain(`"${id}"`);
    expect(rows.matchedPeopleUpdates.map((u) => u.id)).toEqual(["live-mom"]);
    expect(rows.newPeople).toHaveLength(2);
  });

  test("references point at the rows they did in the file", () => {
    const { rows } = run();
    const kid = rows.newPeople.find((p) => p.firstName === "KID")!.id;
    const doc = rows.newPeople.find((p) => p.firstName === "DOC")!.id;
    const def = rows.taskDefinitions[0].id;
    expect(rows.taskInstances[0]).toMatchObject({ definitionId: def, assignedToId: kid, completedById: kid });
    expect(rows.pointsLedger[0].instanceId).toBe(rows.taskInstances[0].id);
    expect(rows.medications[0]).toMatchObject({ taskDefinitionId: def, prescriberId: doc });
    expect(rows.interactions[0]).toMatchObject({ personId: doc, loggedById: "live-mom" });
    expect(rows.relationships[0]).toMatchObject({ fromId: "live-mom", toId: kid });
    expect(rows.serviceLogs[0].itemId).toBe(rows.maintenanceItems[0].id);
    expect(rows.vehicleItemSupplies[0]).toMatchObject({ itemId: rows.maintenanceItems[0].id, supplyId: rows.vehicleSupplies[0].id });
    expect(rows.vehicleServiceSupplyUses[0]).toMatchObject({ logId: rows.serviceLogs[0].id, supplyId: rows.vehicleSupplies[0].id });
    expect(rows.schoolProfiles[0].personId).toBe(kid);
    expect(rows.schoolContacts[0]).toMatchObject({ profileId: rows.schoolProfiles[0].id, personId: doc });
    expect(rows.schoolTasks[0]).toMatchObject({ householdId: "H", kidPersonId: kid, ownerPersonId: "live-mom" });
    expect(rows.schoolAssignments[0].profileId).toBe(rows.schoolProfiles[0].id);
    expect(rows.maintenanceItems[0].vehicleId).toBe(rows.vehicles[0].id);
    expect(rows.products[0]).toMatchObject({ nameKey: "egg", sizeAmount: 12, defaultStoreId: rows.stores[0].id, groupId: rows.productGroups[0].id });
    expect(rows.purchaseItems[0]).toMatchObject({ purchaseId: rows.purchases[0].id, productId: rows.products[0].id });
    expect(rows.itemPrices[0]).toMatchObject({ householdId: "H", productId: rows.products[0].id, storeId: rows.stores[0].id, totalCents: 499 });
    expect(rows.receiptAliases[0]).toMatchObject({ householdId: "H", productId: rows.products[0].id, textKey: "lg eggs 12ct" });
    expect(rows.shoppingListItems[0]).toMatchObject({ listId: "L", productId: rows.products[0].id, requestedById: kid });
    // Assignment order isn't meaningful; compare as sets.
    expect(rows.assigneeConnects).toHaveLength(1);
    expect(new Set(rows.assigneeConnects[0].personIds)).toEqual(new Set([kid, "live-mom"]));
  });

  test("household-scoped rows get the target household and real Dates", () => {
    const { rows } = run();
    for (const r of [...rows.newPeople, ...rows.taskDefinitions, ...rows.vehicles, ...rows.products, ...rows.rewards]) expect(r.householdId).toBe("H");
    expect(rows.taskInstances[0].dueDate).toBeInstanceOf(Date);
    expect("assigneeIds" in rows.taskDefinitions[0]).toBe(false);
  });

  test("a matched person gets profile fields only, and keeps the live email when the file has none", () => {
    const b = fullBackup();
    b.people[0].email = null;
    const rows = remapBackup(b, { householdId: "H", listId: "L", personMatches: new Map([["mom", "live-mom"]]) });
    const data = rows.matchedPeopleUpdates[0].data;
    expect(Object.keys(data).sort()).toEqual(["contactCadenceDays", "createdAt", "firstName", "lastContactedAt", "lastName", "notes", "notesAdultsOnly", "phone"]);
  });
});

describe("older files' groceries (Phase 22)", () => {
  // A v4-shaped file, through the real parser: units, defaultUnitId and free-text rows.
  function v4File() {
    const b = fullBackup() as unknown as Record<string, unknown>;
    b.schemaVersion = 4;
    b.quantityUnits = [{ id: "u1", name: "Dozen", abbreviation: "dz" }];
    b.productGroups = [{ id: "g1", name: "Dairy", createdAt: T }];
    b.products = [
      { id: "p1", name: "Eggs", barcode: "123", brand: null, imageUrl: null, defaultUnitId: "u1", defaultStoreId: "s1", groupId: "g1", createdAt: T },
      { id: "p2", name: "eggs", barcode: "456", brand: null, imageUrl: null, defaultUnitId: null, defaultStoreId: null, groupId: null, createdAt: T },
    ];
    b.shoppingListItems = [
      { id: "li1", productId: "p2", freeText: null, quantity: 1, unitId: "u1", done: false, addedById: "mom", requestedById: null, createdAt: T },
      { id: "li2", productId: null, freeText: "Bananas", quantity: 2, unitId: null, done: false, addedById: "mom", requestedById: "kid", createdAt: T },
      { id: "li3", productId: null, freeText: "EGG", quantity: 1, unitId: null, done: true, addedById: null, requestedById: null, createdAt: T },
      { id: "li4", productId: null, freeText: null, quantity: 1, unitId: null, done: false, addedById: null, requestedById: null, createdAt: T },
    ];
    b.purchaseItems = [{ id: "pi1", purchaseId: "pu1", productId: "p2", description: "eggs", quantity: 1, unitId: "u1", requestedById: "kid" }];
    const parsed = parseBackupFile(JSON.stringify(b));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    return parsed.backup;
  }

  test("parses, defaulting the new fields and dropping units", () => {
    const b = v4File();
    // Phase 37: no starterKey in the file: filled in from the starting name.
    expect(b.productGroups[0]).toMatchObject({ emoji: null, sortOrder: 0, starterKey: "dairy" });
    expect(b.products[0]).toMatchObject({ sizeAmount: null, sizeUnit: null, container: null });
    expect(b.products[0]).not.toHaveProperty("defaultUnitId");
    expect(b.shoppingListItems[0]).not.toHaveProperty("unitId");
    expect(b).not.toHaveProperty("quantityUnits");
  });

  test("look-alike names fold into one item, and free-text rows become items", () => {
    const rows = remapBackup(v4File(), { householdId: "H", listId: "L", personMatches: new Map() });
    expect(rows.products.map((p) => p.name)).toEqual(["Eggs", "Bananas"]);
    const [eggs, bananas] = rows.products;
    expect(eggs.barcode).toBe("123");
    expect(rows.shoppingListItems.map((r) => [r.productId, r.quantity])).toEqual([
      [eggs.id, 1],
      [bananas.id, 2],
      [eggs.id, 1],
    ]);
    expect(rows.shoppingListItems[1]).not.toHaveProperty("freeText");
    expect(rows.purchaseItems[0]).toMatchObject({ productId: eggs.id });
    expect(rows.purchaseItems[0]).not.toHaveProperty("unitId");
  });

  test("the restore preview counts what will really be inserted", () => {
    expect(pantryCounts(v4File())).toEqual({ products: 2, listItems: 3 });
  });
});
