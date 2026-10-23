import { describe, expect, test } from "vitest";
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, FORBIDDEN_BACKUP_KEYS, backupSchema } from "./schema";

/** Every key the schema can ever emit, at any depth (objects and arrays of objects). */
function schemaKeys(schema: unknown, out = new Set<string>()): Set<string> {
  const def = (schema as { def?: { type?: string; shape?: Record<string, unknown>; element?: unknown; innerType?: unknown } }).def;
  if (!def) return out;
  if (def.type === "object" && def.shape) {
    for (const [key, child] of Object.entries(def.shape)) {
      out.add(key);
      schemaKeys(child, out);
    }
  }
  if (def.element) schemaKeys(def.element, out);
  if (def.innerType) schemaKeys(def.innerType, out);
  // A .transform() (productGroups' starter keys) is a pipe: its input holds the keys.
  if ((def as { in?: unknown }).in) schemaKeys((def as { in?: unknown }).in, out);
  return out;
}

const empty = {
  format: BACKUP_FORMAT,
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: "2026-09-24T12:00:00.000Z",
  exportedTimeZone: "America/New_York",
  databaseMigration: "20260922235204_vehicles_fuel_cost_recalls",
  household: { name: "Our Family", timezone: null, latitude: null, longitude: null },
  people: [],
  importantDates: [],
  interactions: [],
  relationships: [],
  taskDefinitions: [],
  taskInstances: [],
  pointsLedger: [],
  rewards: [],
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
};

describe("backupSchema", () => {
  test("no forbidden (secret or sign-in) key exists anywhere in the schema", () => {
    const keys = schemaKeys(backupSchema);
    expect(keys.size).toBeGreaterThan(50); // the walk really descended
    for (const forbidden of FORBIDDEN_BACKUP_KEYS) expect(keys.has(forbidden)).toBe(false);
  });

  test("accepts a minimal backup", () => {
    expect(backupSchema.safeParse(empty).success).toBe(true);
  });

  test("strips unknown keys, so a smuggled secret can't pass through a parse", () => {
    const parsed = backupSchema.parse({
      ...empty,
      people: [
        {
          id: "p1",
          firstName: "Ada",
          lastName: null,
          isHouseholdMember: true,
          role: "KID",
          email: null,
          phone: null,
          notes: null,
          contactCadenceDays: null,
          lastContactedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          pinHash: "$argon2id$...",
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("argon2");
  });

  test("rejects another format or a future schema version", () => {
    expect(backupSchema.safeParse({ ...empty, format: "something-else" }).success).toBe(false);
    expect(backupSchema.safeParse({ ...empty, schemaVersion: BACKUP_SCHEMA_VERSION + 1 }).success).toBe(false);
  });

  test("still reads a v1 file, which predates garage supplies (Phase 12.5) and school (Phase 18)", () => {
    const v1: Record<string, unknown> = { ...empty, schemaVersion: 1 };
    for (const key of [
      "vehicleSupplies",
      "vehicleItemSupplies",
      "vehicleServiceSupplyUses",
      "schoolProfiles",
      "schoolContacts",
      "schoolTasks",
      "schoolAssignments",
    ])
      delete v1[key];
    const parsed = backupSchema.parse(v1);
    expect(parsed.vehicleSupplies).toEqual([]);
    expect(parsed.vehicleServiceSupplyUses).toEqual([]);
  });

  test("Phase 37: a file made before starter keys gets them from the starting names, like the migration", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const group = (id: string, name: string, sortOrder: number) => ({ id, name, emoji: null, sortOrder, createdAt: at });
    const older = backupSchema.parse({
      ...empty,
      productGroups: [group("g1", "Produce", 3), group("g2", "produce", 1), group("g3", "Bath & body", 0), group("g4", "Dog stuff", 4), group("g5", "PET", 5)],
    });
    expect(Object.fromEntries(older.productGroups.map((g) => [g.id, g.starterKey]))).toEqual({ g1: null, g2: "produce", g3: "bath", g4: null, g5: "pet" });

    // A newer file's own keys stand, null included: a renamed or added section isn't re-guessed by name.
    const newer = backupSchema.parse({
      ...empty,
      productGroups: [{ ...group("g1", "Produce", 0), starterKey: null }, { ...group("g2", "Dairy & eggs", 1), starterKey: "dairy" }, group("g3", "Dairy", 2)],
    });
    expect(Object.fromEntries(newer.productGroups.map((g) => [g.id, g.starterKey]))).toEqual({ g1: null, g2: "dairy", g3: null });
  });
});
