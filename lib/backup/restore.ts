import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { readBackup, type BackupHooks, type MoneyRestoreContext, type MoneyRestoreCounts, type Tx } from "./build";
import {
  checkReferences,
  checkUniques,
  normalizeHousehold,
  planDigest,
  planPeople,
  remapBackup,
  pantryCounts,
  readablePets,
  timeZoneMismatch,
  type LinkedPerson,
  type PeoplePlan,
  type Rejection,
} from "./plan";
import type { Backup } from "./schema";

/**
 * Restore = REPLACE this household's data with a backup's (owner's call, Phase 16.5).
 *
 * What survives: the household row (its settings are overwritten), its shopping list row,
 * integration credentials, and every person with their own sign-in (a live login is never
 * deleted; a matched one gets the backup's profile fields). Everything else is deleted and
 * re-inserted from the file with new ids, in one transaction whose first step snapshots
 * the household as it was, returned to the caller so the browser can save it.
 *
 * Phase 28: the snapshot seals today's jars into "the household as it was" (hooks.sealMoney).
 * Phase 28.5: with `restoreMoney`, the file's sealed jars replace today's (hooks.restoreMoney,
 * lib/finance/backup.ts), inside this same transaction. Without it jars are left alone, and
 * the restore is refused if it would delete a jar member who hasn't signed in yet (restore
 * deletes everyone without a sign-in, and their membership would go with them). Jar
 * membership is read here through Prisma only, never jar contents.
 */

const CHUNK = 1000;
export const SERVER_TIME_ZONE = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export type RestorePreview = {
  deletes: Record<string, number>;
  inserts: Record<string, number>;
  matched: { backupName: string; linkedName: string }[];
  keptLinked: string[];
  newMembersNeedingPin: number;
  matchedButRemoved: number;
  timeZoneWarning: string | null;
  anythingToDelete: boolean;
  /** Phase 28: money jars sealed in the file. */
  sealedMoneyJars: number;
  /** Phase 28.5: what putting them back would do (counts only), or why it can't. */
  money: { canRestore: true; counts: MoneyRestoreCounts } | { canRestore: false; reason: string } | null;
  /** Phase 28.5: jar members not signed in yet, who'd lose their jar unless jars are put back. */
  unsignedJarMembers: number;
  /** Echoed back by apply; see planDigest. */
  planDigest: string;
};

async function linkedPeople(db: Tx | typeof prisma, householdId: string): Promise<LinkedPerson[]> {
  const rows = await db.person.findMany({
    where: { householdId, authUserId: { not: null } },
    select: { id: true, firstName: true, email: true, isHouseholdMember: true, role: true, authUser: { select: { email: true } } },
  });
  return rows.map((r) => ({ id: r.id, firstName: r.firstName, email: r.email, authEmail: r.authUser?.email ?? null, isHouseholdMember: r.isHouseholdMember, role: r.role }));
}

/** Jar members who'd be deleted by a restore (no sign-in yet). Counts only. */
function unsignedJarMembers(db: Tx | typeof prisma, householdId: string) {
  return db.moneyJarMember.count({ where: { jar: { householdId }, person: { authUserId: null } } });
}

function moneyContext(backup: Backup, people: PeoplePlan, linked: LinkedPerson[], idMaps: { people: Map<string, string>; purchases: Map<string, string> }): MoneyRestoreContext {
  const live = new Map(linked.map((l) => [l.id, l]));
  return {
    filePeople: backup.people,
    people: idMaps.people,
    purchases: idMaps.purchases,
    matched: new Map([...people.matches].map(([b, l]) => [b, { isHouseholdMember: live.get(l)?.isHouseholdMember ?? false, role: live.get(l)?.role ?? null }])),
    linked: linked.map((l) => ({ id: l.id, authEmail: l.authEmail, isHouseholdMember: l.isHouseholdMember, role: l.role ?? null })),
  };
}

async function deleteCounts(db: Tx | typeof prisma, householdId: string): Promise<Record<string, number>> {
  const person = { householdId };
  const [people, instances, definitions, vehicles, products, listItems, purchases, rewards, interactions, points, supplies, schoolProfiles, schoolTasks, schoolAssignments, orders, shelves, prices, pets, petMemories] = await Promise.all([
    db.person.count({ where: { householdId, authUserId: null } }),
    db.taskInstance.count({ where: { definition: { householdId } } }),
    db.taskDefinition.count({ where: { householdId } }),
    db.vehicle.count({ where: { householdId } }),
    db.product.count({ where: { householdId } }),
    db.shoppingListItem.count({ where: { list: { householdId } } }),
    db.purchase.count({ where: { householdId } }),
    db.reward.count({ where: { householdId } }),
    db.interactionLog.count({ where: { person } }),
    db.pointsLedger.count({ where: { person } }),
    db.vehicleSupply.count({ where: { householdId } }),
    db.schoolProfile.count({ where: { person: { householdId } } }),
    db.schoolTask.count({ where: { householdId } }),
    db.schoolAssignment.count({ where: { profile: { person: { householdId } } } }),
    db.rewardOrder.count({ where: { householdId } }),
    db.rewardBucket.count({ where: { householdId } }),
    db.itemPrice.count({ where: { householdId } }),
    db.pet.count({ where: { householdId } }),
    db.petMemorial.count({ where: { householdId } }),
  ]);
  return {
    "people (without their own sign-in)": people,
    "chores & meds": definitions,
    "scheduled chores & doses": instances,
    "points entries": points,
    rewards,
    "store orders": orders,
    "store shelves": shelves,
    "interaction log entries": interactions,
    vehicles,
    "garage supplies": supplies,
    "school details": schoolProfiles,
    "school to-dos": schoolTasks,
    "homework & grades": schoolAssignments,
    "Pantry items": products,
    "shopping list items": listItems,
    "shopping trips": purchases,
    "receipt prices": prices,
    pets,
    "pet memories": petMemories,
  };
}

function insertCounts(b: Backup): Record<string, number> {
  const pantry = pantryCounts(b);
  return {
    people: b.people.length,
    "chores & meds": b.taskDefinitions.length,
    "scheduled chores & doses": b.taskInstances.length,
    "points entries": b.pointsLedger.length,
    rewards: b.rewards.length,
    "store orders": b.rewardOrders.length,
    "store shelves": b.rewardBuckets.length,
    "interaction log entries": b.interactions.length,
    vehicles: b.vehicles.length,
    "garage supplies": b.vehicleSupplies.length,
    "school details": b.schoolProfiles.length,
    "school to-dos": b.schoolTasks.length,
    "homework & grades": b.schoolAssignments.length,
    "Pantry items": pantry.products,
    "shopping list items": pantry.listItems,
    "shopping trips": b.purchases.length,
    "receipt prices": b.itemPrices.length,
    // A pet whose state doesn't read is left out (readablePets), so it isn't counted.
    pets: readablePets(b).length,
    "pet memories": b.petMemorials.length,
  };
}

/** Every check that needs no writes. Shared by preview and apply, so they can't disagree. */
async function validate(householdId: string, backup: Backup): Promise<{ ok: true; people: PeoplePlan; linked: LinkedPerson[] } | Rejection> {
  const errors = [...checkReferences(backup), ...checkUniques(backup)];
  if (errors.length > 0) return { ok: false, errors: ["The backup file is internally inconsistent:", ...errors] };
  const linked = await linkedPeople(prisma, householdId);
  const people = planPeople(backup, linked);
  if (!people.ok) return people;
  return { ok: true, people: people.plan, linked };
}

export async function previewRestore(householdId: string, backup: Backup, hooks: BackupHooks = {}): Promise<{ ok: true; preview: RestorePreview } | Rejection> {
  const v = await validate(householdId, backup);
  if (!v.ok) return v;
  const deletes = await deleteCounts(prisma, householdId);
  let money: RestorePreview["money"] = null;
  if (backup.sealedMoney) {
    if (!hooks.previewMoney) money = { canRestore: false, reason: "Money jars can't be put back from here." };
    else {
      const { idMaps } = remapBackup(backup, { householdId, listId: "preview", personMatches: v.people.matches });
      const r = hooks.previewMoney(backup.sealedMoney, moneyContext(backup, v.people, v.linked, idMaps));
      money = r.ok ? { canRestore: true, counts: r.preview } : { canRestore: false, reason: r.errors.join(" ") };
    }
  }
  const backupNames = new Map(backup.people.map((p) => [p.id, p.firstName]));
  const linkedNames = new Map(v.linked.map((l) => [l.id, l.firstName]));
  return {
    ok: true,
    preview: {
      deletes,
      inserts: insertCounts(backup),
      matched: [...v.people.matches].map(([b, l]) => ({ backupName: backupNames.get(b) ?? "?", linkedName: linkedNames.get(l) ?? "?" })),
      keptLinked: v.people.keptLinked.map((l) => l.firstName),
      newMembersNeedingPin: v.people.newMembers,
      matchedButRemoved: v.people.matchedButRemoved,
      timeZoneWarning: timeZoneMismatch(backup, SERVER_TIME_ZONE()),
      anythingToDelete: Object.values(deletes).some((n) => n > 0),
      sealedMoneyJars: backup.sealedMoney?.jarCount ?? 0,
      money,
      unsignedJarMembers: await unsignedJarMembers(prisma, householdId),
      planDigest: planDigest(v.people),
    },
  };
}

async function createInChunks<T>(rows: T[], create: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await create(rows.slice(i, i + CHUNK));
}

export async function applyRestore(
  householdId: string,
  viewerId: string,
  backup: Backup,
  opts: { allowTimeZoneMismatch: boolean; expectedPlanDigest: string; hooks?: BackupHooks; restoreMoney?: boolean },
): Promise<
  | { ok: true; previousBackup: Backup; inserted: Record<string, number>; money: { restored: MoneyRestoreCounts; previousMemberIds: string[] } | null }
  | Rejection
> {
  const hooks = opts.hooks ?? {};
  if (opts.restoreMoney && (!backup.sealedMoney || !hooks.restoreMoney)) {
    return { ok: false, errors: ["This file has no money jars to put back."] };
  }
  const tzWarning = timeZoneMismatch(backup, SERVER_TIME_ZONE());
  if (tzWarning && !opts.allowTimeZoneMismatch) return { ok: false, errors: [tzWarning] };

  const v = await validate(householdId, backup);
  if (!v.ok) return v;

  const previousBackup = await prisma.$transaction(
    async (tx) => {
      // 1. Snapshot first: replace is irreversible, and the file might be the wrong one.
      const snapshot = await readBackup(tx, householdId, new Date(), hooks);

      // Re-check the people plan inside the transaction, against the rows as they are now.
      const people = planPeople(backup, await linkedPeople(tx, householdId));
      if (!people.ok) throw new RestoreRejected(people.errors);
      if (planDigest(people.plan) !== opts.expectedPlanDigest) {
        throw new RestoreRejected(["Who's signed in here changed since the preview. Preview the file again."]);
      }
      if (!opts.restoreMoney && (await unsignedJarMembers(tx, householdId)) > 0) {
        throw new RestoreRejected([
          "Someone in a money jar hasn't signed in yet, and this restore would remove them from their jar. Tick \"put the money jars back\" or have them sign in first.",
        ]);
      }

      // 2. Delete, cascade-safe (checked against prisma/schema.prisma's onDelete rules).
      await tx.purchase.deleteMany({ where: { householdId } }); // cascades purchase items
      await tx.shoppingListItem.deleteMany({ where: { list: { householdId } } });
      await tx.product.deleteMany({ where: { householdId } });
      await tx.store.deleteMany({ where: { householdId } });
      await tx.productGroup.deleteMany({ where: { householdId } });
      await tx.vehicle.deleteMany({ where: { householdId } }); // cascades items, logs, fuel, acks, item supplies, supply uses
      await tx.vehicleSupply.deleteMany({ where: { householdId } });
      await tx.schoolTask.deleteMany({ where: { householdId } });
      // Every student's profile, linked people's included (cascades contacts and homework).
      await tx.schoolProfile.deleteMany({ where: { person: { householdId } } });
      // Phase 20: orders reference rewards (a NO ACTION FK), so they go first. The bell's
      // notifications point at orders that are about to disappear, so they go too.
      await tx.notification.deleteMany({ where: { householdId } });
      await tx.rewardOrder.deleteMany({ where: { householdId } });
      await tx.reward.deleteMany({ where: { householdId } });
      await tx.rewardBucket.deleteMany({ where: { householdId } });
      await tx.taskDefinition.deleteMany({ where: { householdId } }); // cascades instances, meds, assignees
      // Phase 47: every pet row, signed-in people's included (Pet.personId is unique, and a
      // kept person's old pet would block the file's).
      await tx.pet.deleteMany({ where: { householdId } });
      await tx.petItem.deleteMany({ where: { householdId } });
      await tx.petMemorial.deleteMany({ where: { householdId } });
      await tx.petPlay.deleteMany({ where: { person: { householdId } } });
      await tx.petGift.deleteMany({ where: { householdId } });
      const everyone = { householdId };
      await tx.pointsLedger.deleteMany({ where: { person: everyone } });
      await tx.importantDate.deleteMany({ where: { person: everyone } });
      await tx.interactionLog.deleteMany({ where: { person: everyone } });
      await tx.personRelationship.deleteMany({ where: { OR: [{ from: everyone }, { to: everyone }] } });
      await tx.person.deleteMany({ where: { householdId, authUserId: null } });

      // 3. Household settings and the (kept) shopping list.
      const { petCareHours, ...settings } = normalizeHousehold(backup.household);
      await tx.household.update({ where: { id: householdId }, data: { ...settings, petCareHours: petCareHours ?? Prisma.DbNull } });
      const list = await tx.shoppingList.upsert({ where: { householdId }, create: { householdId }, update: {} });

      // 4. Insert, parents before children.
      const rows = remapBackup(backup, { householdId, listId: list.id, personMatches: people.plan.matches });
      for (const u of rows.matchedPeopleUpdates) await tx.person.update({ where: { id: u.id }, data: u.data });
      await createInChunks(rows.newPeople, (data) => tx.person.createMany({ data }));
      await createInChunks(rows.importantDates, (data) => tx.importantDate.createMany({ data }));
      await createInChunks(rows.interactions, (data) => tx.interactionLog.createMany({ data }));
      await createInChunks(rows.relationships, (data) => tx.personRelationship.createMany({ data }));
      await createInChunks(rows.stores, (data) => tx.store.createMany({ data }));
      await createInChunks(rows.productGroups, (data) => tx.productGroup.createMany({ data }));
      await createInChunks(rows.products, (data) => tx.product.createMany({ data }));
      await createInChunks(rows.taskDefinitions, (data) => tx.taskDefinition.createMany({ data }));
      for (const c of rows.assigneeConnects) {
        await tx.taskDefinition.update({
          where: { id: c.definitionId },
          data: { assignees: { connect: c.personIds.map((id) => ({ id })) } },
        });
      }
      await createInChunks(rows.medications, (data) => tx.medication.createMany({ data }));
      await createInChunks(rows.taskInstances, (data) => tx.taskInstance.createMany({ data }));
      // Phase 20: buckets -> rewards -> orders -> ledger (ledger rows can point at orders).
      await createInChunks(rows.rewardBuckets, (data) => tx.rewardBucket.createMany({ data }));
      await createInChunks(rows.rewards, (data) => tx.reward.createMany({ data }));
      await createInChunks(rows.rewardOrders, (data) => tx.rewardOrder.createMany({ data }));
      await createInChunks(rows.pointsLedger, (data) => tx.pointsLedger.createMany({ data }));
      await createInChunks(rows.vehicles, (data) => tx.vehicle.createMany({ data }));
      await createInChunks(rows.maintenanceItems, (data) => tx.vehicleMaintenanceItem.createMany({ data }));
      await createInChunks(rows.serviceLogs, (data) => tx.vehicleServiceLog.createMany({ data }));
      await createInChunks(rows.fuelLogs, (data) => tx.vehicleFuelLog.createMany({ data }));
      await createInChunks(rows.recallAcks, (data) => tx.vehicleRecallAck.createMany({ data }));
      await createInChunks(rows.vehicleSupplies, (data) => tx.vehicleSupply.createMany({ data }));
      await createInChunks(rows.vehicleItemSupplies, (data) => tx.vehicleItemSupply.createMany({ data }));
      await createInChunks(rows.vehicleServiceSupplyUses, (data) => tx.vehicleServiceSupplyUse.createMany({ data }));
      await createInChunks(rows.schoolProfiles, (data) => tx.schoolProfile.createMany({ data }));
      await createInChunks(rows.schoolContacts, (data) => tx.schoolContact.createMany({ data }));
      await createInChunks(rows.schoolTasks, (data) => tx.schoolTask.createMany({ data }));
      await createInChunks(rows.schoolAssignments, (data) => tx.schoolAssignment.createMany({ data }));
      await createInChunks(rows.shoppingListItems, (data) => tx.shoppingListItem.createMany({ data }));
      await createInChunks(rows.purchases, (data) => tx.purchase.createMany({ data }));
      await createInChunks(rows.purchaseItems, (data) => tx.purchaseItem.createMany({ data }));
      await createInChunks(rows.itemPrices, (data) => tx.itemPrice.createMany({ data }));
      await createInChunks(rows.receiptAliases, (data) => tx.receiptAlias.createMany({ data }));
      await createInChunks(rows.pets, (data) => tx.pet.createMany({ data }));
      await createInChunks(rows.petItems, (data) => tx.petItem.createMany({ data }));
      await createInChunks(rows.petPlays, (data) => tx.petPlay.createMany({ data }));
      await createInChunks(rows.petMemorials, (data) => tx.petMemorial.createMany({ data }));
      // After the chores' instances, which a present points at.
      await createInChunks(rows.petGifts, (data) => tx.petGift.createMany({ data }));

      // 4b. Phase 28.5: the money jars, once the people and trips they point at exist.
      let money: { restored: MoneyRestoreCounts; previousMemberIds: string[] } | null = null;
      if (opts.restoreMoney && backup.sealedMoney && hooks.restoreMoney) {
        const linkedNow = await linkedPeople(tx, householdId);
        const r = await hooks.restoreMoney(tx, householdId, backup.sealedMoney, moneyContext(backup, people.plan, linkedNow, rows.idMaps));
        if (!r.ok) throw new RestoreRejected(r.errors);
        money = { restored: r.restored, previousMemberIds: r.previousMemberIds };
      }

      // 5. Invariant: the admin running this still exists, is a member, and is an admin.
      // (The route only lets an admin on their own sign-in restore, so their row is never among
      // the deleted — this is the belt to that brace.)
      const viewer = await tx.person.findUnique({ where: { id: viewerId }, select: { role: true, isHouseholdMember: true, householdId: true } });
      if (!viewer || viewer.householdId !== householdId || !viewer.isHouseholdMember || viewer.role !== "ADMIN") {
        throw new RestoreRejected(["The restore would have removed your own admin access, so nothing was changed."]);
      }
      return { snapshot, money };
    },
    // REPEATABLE READ, like buildBackup: the snapshot must be one consistent moment or it
    // could fail its own reference check when restored. A concurrent edit to a row this
    // deletes then fails the transaction (P2034) instead of being silently lost.
    { timeout: 120_000, maxWait: 5_000, isolationLevel: "RepeatableRead" },
  ).catch((err: unknown) => {
    if (err instanceof RestoreRejected) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return new RestoreRejected(["Someone was changing data during the restore, so nothing was changed. Try again."]);
    }
    throw err;
  });

  if (previousBackup instanceof RestoreRejected) return { ok: false, errors: previousBackup.errors };
  return { ok: true, previousBackup: previousBackup.snapshot, inserted: insertCounts(backup), money: previousBackup.money };
}

/** Thrown inside the transaction to roll it back with a user-facing, data-free reason. */
class RestoreRejected extends Error {
  constructor(readonly errors: string[]) {
    super("restore rejected");
  }
}
