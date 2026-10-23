import { deployZone } from "@/lib/household-zone";
import { prisma } from "@/lib/prisma";
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, backupSchema, type Backup, type SealedMoney } from "./schema";
import { LOOK_SELECT } from "@/lib/family-look";

/**
 * Builds the whole-household backup (Phase 16). Every top-level query is scoped by
 * householdId, and every child query through its parent, so nothing from another household
 * can cross in. Fields are selected explicitly (never `include` a whole row), so a secret
 * column added to a model later can't silently ride along.
 */
/**
 * Phase 28: what other code adds to a backup without lib/backup importing it (lib/backup is
 * a kernel zone, so it can't import lib/finance). The routes wire lib/finance/backup.ts's
 * sealMoney in; without it a backup has no money section.
 */
export type BackupHooks = {
  sealMoney?: (tx: Tx, householdId: string) => Promise<SealedMoney | null>;
  /** Phase 28.5: what putting the file's jars back would do, in counts only. */
  previewMoney?: (box: SealedMoney, ctx: MoneyRestoreContext) => { ok: true; preview: MoneyRestoreCounts } | { ok: false; errors: string[] };
  /** Phase 28.5: replaces the household's jars with the file's, inside restore's transaction. */
  restoreMoney?: (
    tx: Tx,
    householdId: string,
    box: SealedMoney,
    ctx: MoneyRestoreContext,
  ) => Promise<{ ok: true; restored: MoneyRestoreCounts; previousMemberIds: string[] } | { ok: false; errors: string[] }>;
};

export type MoneyRestoreContext = {
  filePeople: Backup["people"];
  /** backup person id -> the id it has after the restore */
  people: Map<string, string>;
  /** backup purchase id -> the id it has after the restore */
  purchases: Map<string, string>;
  /** backup person id -> the live, Microsoft-linked person it was matched to (by profile email) */
  matched: Map<string, { isHouseholdMember: boolean; role: string | null }>;
  /** Everyone signed in here, by the Microsoft address they sign in with (not editable). */
  linked: { id: string; authEmail: string | null; isHouseholdMember: boolean; role: string | null }[];
};

export type MoneyRestoreCounts = { jars: number; jarsSkipped: number; membersKept: number; membersWaiting: number; membersDropped: number };

export async function buildBackup(householdId: string, now = new Date(), hooks: BackupHooks = {}): Promise<Backup> {
  // One consistent snapshot (Fable's implementation review): without a transaction, a write
  // landing between the read batches could leave e.g. an instance whose definition isn't in
  // the file. Postgres REPEATABLE READ gives every read below the same snapshot.
  return prisma.$transaction((tx) => readBackup(tx, householdId, now, hooks), {
    isolationLevel: "RepeatableRead",
    timeout: 60_000,
  });
}

export type { Tx } from "@/lib/prisma";
import type { Tx } from "@/lib/prisma";

async function latestMigration(tx: Tx): Promise<string | null> {
  // Informational only: a database without Prisma's migrations table (e.g. created with
  // `prisma db push`) gets null rather than a failed backup. Probed with to_regclass, not
  // try/catch: a failed statement aborts the whole Postgres transaction, which would break
  // every write restore makes after its snapshot (Fable's implementation review).
  const [probe] = await tx.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`;
  if (!probe?.present) return null;
  const rows = await tx.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC LIMIT 1`;
  return rows[0]?.migration_name ?? null;
}

/** Also used by restore, which snapshots the household inside its own transaction first. */
export async function readBackup(tx: Tx, householdId: string, now: Date, hooks: BackupHooks = {}): Promise<Backup> {
  const iso = (date: Date) => date.toISOString();
  const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);

  const [household, people, taskDefinitions, rewards, vehicles, stores, productGroups, products, purchases] =
    await Promise.all([
      tx.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { name: true, timezone: true, dayZone: true, latitude: true, longitude: true, familyGoalStickers: true, familyGoalTitle: true, disabledApps: true, setupReviewed: true, ...LOOK_SELECT },
      }),
      tx.person.findMany({
        where: { householdId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          isHouseholdMember: true,
          role: true,
          color: true,
          email: true,
          phone: true,
          notes: true,
          notesAdultsOnly: true,
          contactCadenceDays: true,
          lastContactedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.taskDefinition.findMany({
        where: { householdId },
        select: {
          id: true,
          title: true,
          notes: true,
          domain: true,
          frequencyType: true,
          interval: true,
          daysOfWeek: true,
          startDate: true,
          timesOfDay: true,
          weatherSensitive: true,
          points: true,
          assignmentStrategy: true,
          assignees: { select: { id: true } },
          active: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.reward.findMany({
        where: { householdId },
        select: {
          id: true,
          title: true,
          pointCost: true,
          active: true,
          emoji: true,
          bucketId: true,
          limitPerWeek: true,
          needsApproval: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.vehicle.findMany({
        where: { householdId },
        select: {
          id: true,
          name: true,
          make: true,
          model: true,
          year: true,
          currentMileage: true,
          mileageUpdatedAt: true,
          active: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.store.findMany({ where: { householdId }, select: { id: true, name: true, createdAt: true } }),
      tx.productGroup.findMany({ where: { householdId }, select: { id: true, name: true, emoji: true, sortOrder: true, starterKey: true, createdAt: true } }),
      tx.product.findMany({
        where: { householdId },
        select: {
          id: true,
          name: true,
          barcode: true,
          brand: true,
          imageUrl: true,
          sizeAmount: true,
          sizeUnit: true,
          container: true,
          defaultStoreId: true,
          groupId: true,
          createdAt: true,
        },
      }),
      tx.purchase.findMany({
        where: { householdId },
        select: { id: true, purchasedAt: true, purchasedById: true },
        orderBy: { purchasedAt: "asc" },
      }),
    ]);

  const [
    importantDates,
    interactions,
    relationships,
    taskInstances,
    pointsLedger,
    medications,
    maintenanceItems,
    serviceLogs,
    fuelLogs,
    recallAcks,
    shoppingListItems,
    purchaseItems,
    itemPrices,
    receiptAliases,
    vehicleSupplies,
    vehicleItemSupplies,
    schoolProfiles,
    schoolContacts,
    schoolTasks,
    schoolAssignments,
    vehicleServiceSupplyUses,
  ] = await Promise.all([
    tx.importantDate.findMany({
      where: { person: { householdId } },
      select: { id: true, personId: true, type: true, label: true, month: true, day: true, year: true },
    }),
    tx.interactionLog.findMany({
      where: { person: { householdId } },
      select: { id: true, personId: true, type: true, occurredAt: true, note: true, adultsOnly: true, loggedById: true, createdAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    tx.personRelationship.findMany({
      where: { from: { householdId }, to: { householdId } },
      select: { id: true, fromId: true, toId: true, type: true, label: true, createdAt: true },
    }),
    // All instances, upcoming PENDING ones included: rotation fairness reads the last 60
    // by due date regardless of status, and a manual reassignment of a future instance is
    // itself user data (Fable's scope review).
    tx.taskInstance.findMany({
      where: { definition: { householdId } },
      select: {
        id: true,
        definitionId: true,
        dueDate: true,
        assignedToId: true,
        status: true,
        completedAt: true,
        completedById: true,
        quantityConsumed: true,
        createdAt: true,
      },
      orderBy: { dueDate: "asc" },
    }),
    tx.pointsLedger.findMany({
      where: { person: { householdId } },
      select: { id: true, personId: true, delta: true, reason: true, instanceId: true, orderId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    tx.medication.findMany({
      where: { taskDefinition: { householdId } },
      select: {
        id: true,
        taskDefinitionId: true,
        quantityOnHand: true,
        doseAmount: true,
        refillThresholdQuantity: true,
        prescriberId: true,
        pharmacyId: true,
      },
    }),
    tx.vehicleMaintenanceItem.findMany({
      where: { vehicle: { householdId } },
      select: {
        id: true,
        vehicleId: true,
        title: true,
        notes: true,
        intervalMiles: true,
        intervalMonths: true,
        lastDoneMileage: true,
        lastDoneAt: true,
        active: true,
        createdAt: true,
      },
    }),
    tx.vehicleServiceLog.findMany({
      where: { item: { vehicle: { householdId } } },
      select: { id: true, itemId: true, doneAt: true, mileage: true, notes: true, costCents: true, loggedById: true, createdAt: true },
      orderBy: { doneAt: "asc" },
    }),
    tx.vehicleFuelLog.findMany({
      where: { vehicle: { householdId } },
      select: {
        id: true,
        vehicleId: true,
        filledAt: true,
        mileage: true,
        gallons: true,
        costCents: true,
        fullTank: true,
        missedPrevious: true,
        notes: true,
        loggedById: true,
        createdAt: true,
      },
      orderBy: { filledAt: "asc" },
    }),
    tx.vehicleRecallAck.findMany({
      where: { vehicle: { householdId } },
      select: { id: true, vehicleId: true, campaignNumber: true, acknowledgedAt: true, acknowledgedById: true },
    }),
    tx.shoppingListItem.findMany({
      where: { list: { householdId } },
      select: {
        id: true,
        productId: true,
        quantity: true,
        done: true,
        kidPick: true,
        addedById: true,
        requestedById: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    tx.purchaseItem.findMany({
      where: { purchase: { householdId } },
      select: { id: true, purchaseId: true, productId: true, description: true, quantity: true, requestedById: true, kidPick: true },
    }),
    tx.itemPrice.findMany({
      where: { householdId },
      select: { id: true, productId: true, storeId: true, totalCents: true, quantity: true, unitCents: true, observedAt: true },
      orderBy: { observedAt: "asc" },
    }),
    tx.receiptAlias.findMany({ where: { householdId }, select: { id: true, textKey: true, productId: true } }),
    tx.vehicleSupply.findMany({
      where: { householdId },
      select: {
        id: true,
        name: true,
        partNumber: true,
        unit: true,
        quantityOnHand: true,
        lowThreshold: true,
        notes: true,
        active: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    }),
    // Both ends in this household: an item and a supply can only be linked within one, but
    // scoping both sides keeps a cross-household row out even if one ever existed.
    tx.vehicleItemSupply.findMany({
      where: { item: { vehicle: { householdId } }, supply: { householdId } },
      select: { itemId: true, supplyId: true, quantity: true },
    }),
    tx.schoolProfile.findMany({
      where: { person: { householdId } },
      select: {
        id: true,
        personId: true,
        schoolName: true,
        grade: true,
        schoolYear: true,
        transportNotes: true,
        lunchNotes: true,
        scheduleNotes: true,
        notes: true,
        createdAt: true,
      },
    }),
    tx.schoolContact.findMany({
      where: { profile: { person: { householdId } }, person: { householdId } },
      select: { profileId: true, personId: true, role: true },
    }),
    tx.schoolTask.findMany({
      where: { householdId },
      select: {
        id: true,
        kidPersonId: true,
        title: true,
        kind: true,
        dueDate: true,
        amountCents: true,
        ownerPersonId: true,
        status: true,
        doneAt: true,
        notes: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    tx.schoolAssignment.findMany({
      where: { profile: { person: { householdId } } },
      select: {
        id: true,
        profileId: true,
        className: true,
        title: true,
        dueDate: true,
        status: true,
        score: true,
        maxScore: true,
        notes: true,
        source: true,
        externalId: true,
        doneAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    tx.vehicleServiceSupplyUse.findMany({
      where: { log: { item: { vehicle: { householdId } } }, supply: { householdId } },
      select: { logId: true, supplyId: true, quantity: true },
    }),
  ]);

  // Phase 20 Sticker Store.
  const [rewardBuckets, rewardOrders] = await Promise.all([
    tx.rewardBucket.findMany({
      where: { householdId },
      select: { id: true, name: true, emoji: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    tx.rewardOrder.findMany({
      where: { householdId },
      select: {
        id: true,
        rewardId: true,
        personId: true,
        placedById: true,
        title: true,
        emoji: true,
        cost: true,
        status: true,
        note: true,
        decidedAt: true,
        decidedById: true,
        closedAt: true,
        closedById: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const databaseMigration = await latestMigration(tx);
  // Phase 49: dayZone goes into exportedTimeZone, not the household (lib/backup/coverage.test.ts).
  const { dayZone, ...householdSettings } = household;

  const backup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: iso(now),
    // Phase 49: the zone the days are written in (lib/household-zone.ts).
    exportedTimeZone: dayZone ?? deployZone(),
    databaseMigration,
    household: householdSettings,
    people: people.map((p) => ({ ...p, lastContactedAt: isoOrNull(p.lastContactedAt), createdAt: iso(p.createdAt) })),
    importantDates,
    interactions: interactions.map((i) => ({ ...i, occurredAt: iso(i.occurredAt), createdAt: iso(i.createdAt) })),
    relationships: relationships.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    taskDefinitions: taskDefinitions.map(({ assignees, ...t }) => ({
      ...t,
      startDate: iso(t.startDate),
      createdAt: iso(t.createdAt),
      assigneeIds: assignees.map((a) => a.id),
    })),
    taskInstances: taskInstances.map((t) => ({
      ...t,
      dueDate: iso(t.dueDate),
      completedAt: isoOrNull(t.completedAt),
      createdAt: iso(t.createdAt),
    })),
    pointsLedger: pointsLedger.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
    rewards: rewards.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    rewardBuckets: rewardBuckets.map((b) => ({ ...b, createdAt: iso(b.createdAt) })),
    rewardOrders: rewardOrders.map((o) => ({
      ...o,
      decidedAt: isoOrNull(o.decidedAt),
      closedAt: isoOrNull(o.closedAt),
      createdAt: iso(o.createdAt),
    })),
    medications,
    vehicles: vehicles.map((v) => ({ ...v, mileageUpdatedAt: isoOrNull(v.mileageUpdatedAt), createdAt: iso(v.createdAt) })),
    maintenanceItems: maintenanceItems.map((m) => ({ ...m, lastDoneAt: isoOrNull(m.lastDoneAt), createdAt: iso(m.createdAt) })),
    serviceLogs: serviceLogs.map((s) => ({ ...s, doneAt: iso(s.doneAt), createdAt: iso(s.createdAt) })),
    fuelLogs: fuelLogs.map((f) => ({ ...f, filledAt: iso(f.filledAt), createdAt: iso(f.createdAt) })),
    recallAcks: recallAcks.map((r) => ({ ...r, acknowledgedAt: iso(r.acknowledgedAt) })),
    vehicleSupplies: vehicleSupplies.map((s) => ({ ...s, createdAt: iso(s.createdAt) })),
    vehicleItemSupplies,
    vehicleServiceSupplyUses,
    schoolProfiles: schoolProfiles.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
    schoolContacts,
    schoolTasks: schoolTasks.map((t) => ({ ...t, dueDate: isoOrNull(t.dueDate), doneAt: isoOrNull(t.doneAt), createdAt: iso(t.createdAt) })),
    schoolAssignments: schoolAssignments.map((a) => ({
      ...a,
      dueDate: isoOrNull(a.dueDate),
      doneAt: isoOrNull(a.doneAt),
      createdAt: iso(a.createdAt),
    })),
    stores: stores.map((s) => ({ ...s, createdAt: iso(s.createdAt) })),
    productGroups: productGroups.map((g) => ({ ...g, createdAt: iso(g.createdAt) })),
    products: products.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
    shoppingListItems: shoppingListItems.map((s) => ({ ...s, createdAt: iso(s.createdAt) })),
    purchases: purchases.map((p) => ({ ...p, purchasedAt: iso(p.purchasedAt) })),
    purchaseItems,
    itemPrices: itemPrices.map((p) => ({ ...p, observedAt: iso(p.observedAt) })),
    receiptAliases,
    sealedMoney: hooks.sealMoney ? await hooks.sealMoney(tx, householdId) : null,
  };

  // The export validates itself against the same schema restore will use, so a backup that
  // downloads is one restore can read.
  return backupSchema.parse(backup);
}
