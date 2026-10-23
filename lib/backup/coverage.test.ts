import { expect, test } from "vitest";
import type {
  HouseholdModel,
  ImportantDateModel,
  InteractionLogModel,
  MedicationModel,
  PersonModel,
  PersonRelationshipModel,
  PointsLedgerModel,
  ProductGroupModel,
  ProductModel,
  ItemPriceModel,
  ReceiptAliasModel,
  PurchaseItemModel,
  PurchaseModel,
  RewardModel,
  RewardBucketModel,
  RewardOrderModel,
  ShoppingListItemModel,
  StoreModel,
  TaskDefinitionModel,
  TaskInstanceModel,
  VehicleFuelLogModel,
  VehicleMaintenanceItemModel,
  VehicleModel,
  VehicleRecallAckModel,
  VehicleServiceLogModel,
  VehicleItemSupplyModel,
  VehicleServiceSupplyUseModel,
  VehicleSupplyModel,
  SchoolProfileModel,
  SchoolContactModel,
  SchoolTaskModel,
  SchoolAssignmentModel,
  PetModel,
  PetItemModel,
  PetPlayModel,
  PetMemorialModel,
  PetGiftModel,
} from "@/app/generated/prisma/models";
import type { Backup } from "./schema";

/**
 * COMPILE-TIME completeness check (Fable's implementation review). `buildBackup` selects
 * columns explicitly, which is right for secrets but means a column added to a model later
 * would silently drop out of every backup, the file 16.5's restore will trust.
 *
 * Each line below fails `tsc` (the project gate is `npx tsc --noEmit`, which includes this
 * file) with the uncovered column's name, unless that column is in the backup or listed in
 * that model's allowlist. Adding a column to an allowlist is an explicit, reviewable
 * decision that it stays out of backups.
 */
type Uncovered<Model, Exported, Allowed extends string> = Exclude<keyof Model, keyof Exported | Allowed>;
type Covered<Model, Exported, Allowed extends string = never> =
  Uncovered<Model, Exported, Allowed> extends never ? true : { uncoveredColumn: Uncovered<Model, Exported, Allowed> };

type Row<K extends keyof Backup> = Backup[K] extends (infer R)[] ? R : Backup[K];

// Scoping columns are implied by the file itself (it's one household), and parents are
// implied by nesting-free foreign keys that ARE exported.
type Scope = "householdId";

const checks = {
  household: true satisfies Covered<HouseholdModel, Backup["household"], "id" | "createdAt" | "updatedAt">,
  // Security / sign-in / M365-owned columns never leave; see schema.ts's header.
  person: true satisfies Covered<
    PersonModel,
    Row<"people">,
    Scope | "authUserId" | "pinHash" | "pinFailedAttempts" | "pinLockedUntil" | "photo" | "photoContentType" | "entraSyncedAt" | "updatedAt"
    // Phase 40.4: Entra ended a Microsoft sign-in's access (sign-in state, like authUserId).
    | "entraAccessEndedAt"
    // Phase 19.5: per-person view and Bunson preferences, not family data.
    | "viewMode"
    | "bunsonVolume"
    // Phase 20: the saving-up goal is a UI preference too.
    | "savingRewardId"
    // Phase 45.2: the Outlook calendar picked for Home, by Graph id: integration state.
    | "homeCalendarId"
    // Phase 45.4: hiding the "Finish setting up" card, a display preference.
    | "setupCardHidden"
  >,
  importantDate: true satisfies Covered<ImportantDateModel, Row<"importantDates">>,
  interaction: true satisfies Covered<InteractionLogModel, Row<"interactions">>,
  relationship: true satisfies Covered<PersonRelationshipModel, Row<"relationships">>,
  taskDefinition: true satisfies Covered<TaskDefinitionModel, Row<"taskDefinitions">, Scope | "updatedAt">,
  taskInstance: true satisfies Covered<TaskInstanceModel, Row<"taskInstances">>,
  pointsEntry: true satisfies Covered<PointsLedgerModel, Row<"pointsLedger">>,
  reward: true satisfies Covered<RewardModel, Row<"rewards">, Scope | "updatedAt">,
  rewardBucket: true satisfies Covered<RewardBucketModel, Row<"rewardBuckets">, Scope | "updatedAt">,
  rewardOrder: true satisfies Covered<RewardOrderModel, Row<"rewardOrders">, Scope>,
  medication: true satisfies Covered<MedicationModel, Row<"medications">, "createdAt" | "updatedAt">,
  vehicle: true satisfies Covered<VehicleModel, Row<"vehicles">, Scope | "updatedAt">,
  maintenanceItem: true satisfies Covered<VehicleMaintenanceItemModel, Row<"maintenanceItems">, "updatedAt">,
  serviceLog: true satisfies Covered<VehicleServiceLogModel, Row<"serviceLogs">>,
  fuelLog: true satisfies Covered<VehicleFuelLogModel, Row<"fuelLogs">>,
  recallAck: true satisfies Covered<VehicleRecallAckModel, Row<"recallAcks">>,
  store: true satisfies Covered<StoreModel, Row<"stores">, Scope>,
  productGroup: true satisfies Covered<ProductGroupModel, Row<"productGroups">, Scope>,
  // nameKey: derived from the name on restore (lib/product-name.ts).
  product: true satisfies Covered<ProductModel, Row<"products">, Scope | "updatedAt" | "nameKey">,
  // listId: one shopping list per household, recreated by getOrCreateActiveList.
  shoppingListItem: true satisfies Covered<ShoppingListItemModel, Row<"shoppingListItems">, "listId" | "updatedAt">,
  purchase: true satisfies Covered<PurchaseModel, Row<"purchases">, Scope | "listId">,
  purchaseItem: true satisfies Covered<PurchaseItemModel, Row<"purchaseItems">>,
  itemPrice: true satisfies Covered<ItemPriceModel, Row<"itemPrices">, Scope | "createdAt">,
  receiptAlias: true satisfies Covered<ReceiptAliasModel, Row<"receiptAliases">, Scope | "createdAt">,
  vehicleSupply: true satisfies Covered<VehicleSupplyModel, Row<"vehicleSupplies">, Scope | "updatedAt">,
  vehicleItemSupply: true satisfies Covered<VehicleItemSupplyModel, Row<"vehicleItemSupplies">>,
  vehicleServiceSupplyUse: true satisfies Covered<VehicleServiceSupplyUseModel, Row<"vehicleServiceSupplyUses">>,
  schoolProfile: true satisfies Covered<SchoolProfileModel, Row<"schoolProfiles">, "updatedAt">,
  schoolContact: true satisfies Covered<SchoolContactModel, Row<"schoolContacts">>,
  schoolTask: true satisfies Covered<SchoolTaskModel, Row<"schoolTasks">, Scope | "updatedAt">,
  schoolAssignment: true satisfies Covered<SchoolAssignmentModel, Row<"schoolAssignments">, "updatedAt">,
  // Phase 47: the digital pet.
  // Phase 47: giftsCheckedAt is a scan bookmark, rebuilt by looking (null scans from birth).
  pet: true satisfies Covered<PetModel, Row<"pets">, Scope | "updatedAt" | "giftsCheckedAt">,
  petItem: true satisfies Covered<PetItemModel, Row<"petItems">, Scope>,
  petPlay: true satisfies Covered<PetPlayModel, Row<"petPlays">>,
  petMemorial: true satisfies Covered<PetMemorialModel, Row<"petMemorials">, Scope>,
  petGift: true satisfies Covered<PetGiftModel, Row<"petGifts">, Scope>,
};

test("every app-owned model is checked for backup coverage", () => {
  expect(Object.values(checks).every(Boolean)).toBe(true);
  expect(Object.keys(checks)).toHaveLength(37);
});
