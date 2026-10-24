import { z } from "zod";
import {
  AppIcon,
  AssignmentStrategy,
  FrequencyType,
  ImportantDateType,
  InteractionType,
  PersonColor,
  PersonRole,
  RewardOrderStatus,
  RelationshipType,
  TaskDomain,
  TaskInstanceStatus,
  SchoolTaskKind,
  SchoolTaskStatus,
  AssignmentStatus,
} from "@/app/generated/prisma/enums";
import { withStarterKeys } from "@/lib/starting-sections";

/**
 * The whole-household backup format (Phase 16), version 1. This schema IS the contract:
 * `buildBackup` validates its own output against it before anything is downloaded, and
 * Phase 16.5's restore will validate an uploaded file against it before touching the DB.
 *
 * What's deliberately absent (see docs/BUILD.md Phase 16): PIN hashes and lockout state,
 * sign-in links (authUserId) and anything from the Better Auth tables, Entra sync state,
 * photos (they come from Microsoft 365), and third-party secrets. Also left out:
 * CalendarSync / CalendarEventLink (Phase 17), integration state tied to one mailbox; after a
 * restore, the next calendar sync replaces every event it manages.
 * SchoolFeed / SchoolFeedEvent (Phase 18.5) are left out too: an encrypted feed address and
 * a cache. Feeds are re-added after a restore.
 * Notification (Phase 20) is left out: the bell's inbox is a stream of pings about live
 * orders, and restore clears it. Person.savingRewardId is a UI preference, also left out.
 * AlertPrefs (Phase 21) is left out: per-person alert switches, which survive a restore
 * anyway since restore keeps signed-in people (admins). HouseholdAlerts (Phase 21.5) is left
 * out too: it holds the family's encrypted Teams link, and restore updates the Household row
 * rather than deleting it, so the link survives. PushSubscription (Phase 21.6) is left out:
 * each row is one phone's capability, and phones re-register. Money jars (Phase 25) are
 * private to their members and this file is admin-run, so they're never readable here:
 * Phase 28 (format v7) carries them in `sealedMoney`, encrypted on the server
 * (lib/finance/backup.ts) — the admin holding the file can't open it, only this server's
 * restore can. Bank connections, review questions and FinAlertSent aren't sealed in either.
 * Restore puts them back only when asked (Phase 28.5, lib/finance/backup.ts); otherwise it
 * leaves today's jars as they are.
 * BackupEvent (Phase 28) is the audit trail, never in a backup and never deleted by restore.
 * MailOrder / MailOrderScan (Phase 29) aren't in either backup: orders are re-read from
 * email, and a jar restore drops them with the jar (the person's scan stops until they turn
 * it on in a jar again).
 *
 * Ids are kept so references inside the file resolve; restore will re-issue them.
 *
 * Enum values come from the generated Prisma enums, not literals: a value added to
 * schema.prisma would otherwise pass tsc and every test, then fail every real backup
 * the first time a row used it (Fable's implementation review). The format widens with the
 * schema; restore validates with this same schema, so the two can't disagree.
 */

const id = z.string().min(1);
const nullableId = id.nullable();
const iso = z.iso.datetime();
const nullableIso = iso.nullable();
const text = z.string();
const nullableText = z.string().nullable();
// Every integer column is a Postgres INT4; an out-of-range value is a clean 400 here
// instead of a failed insert halfway through a restore.
const int = z.int32();

const household = z.object({
  name: text,
  timezone: nullableText,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  // Phase 20 family sticker sheet goal; absent in v1–v3 files.
  familyGoalStickers: int.nullable().default(null),
  familyGoalTitle: nullableText.default(null),
  // The family's own name for the app; absent in files from before it existed.
  appName: nullableText.default(null),
  // Phase 36: the apps the family turned off; absent in older files (every app on).
  disabledApps: z.array(text).default([]),
  // Phase 35 Make it yours; absent in older files, which keep the app's own look.
  themeColor: nullableText.default(null),
  rewardOne: nullableText.default(null),
  rewardMany: nullableText.default(null),
  rewardStore: nullableText.default(null),
  mascotOn: z.boolean().default(true),
  mascotName: nullableText.default(null),
  appIcon: z.enum(AppIcon).default("BUNNY"),
  // Phase 45.4: setup steps an admin has been through; absent in older files.
  setupReviewed: z.array(text).default([]),
  // Phase 47: when the pet is awake, as stored (JSON). Restore keeps it only if it reads as
  // care hours (lib/pet/stored.ts); absent in older files (the default hours).
  petCareHours: z.json().nullable().default(null),
  // Phase 52: how ambiguous statement dates read; absent in older files (automatic).
  statementDateOrder: z.enum(["AUTO", "MONTH_FIRST", "DAY_FIRST"]).default("AUTO"),
});

const person = z.object({
  id,
  firstName: text,
  lastName: nullableText,
  isHouseholdMember: z.boolean(),
  role: z.enum(PersonRole).nullable(),
  // Phase 19. Optional so v3 files written before it still parse.
  color: z.enum(PersonColor).nullable().optional(),
  email: nullableText,
  phone: nullableText,
  notes: nullableText,
  // 2026-10-09; older files have none.
  notesAdultsOnly: z.boolean().default(false),
  contactCadenceDays: int.nullable(),
  lastContactedAt: nullableIso,
  createdAt: iso,
});

const importantDate = z.object({
  id,
  personId: id,
  type: z.enum(ImportantDateType),
  label: nullableText,
  month: int,
  day: int,
  year: int.nullable(),
});

const interaction = z.object({
  id,
  personId: id,
  type: z.enum(InteractionType),
  occurredAt: iso,
  note: nullableText,
  // 2026-10-09; older files have none.
  adultsOnly: z.boolean().default(false),
  loggedById: nullableId,
  createdAt: iso,
});

const relationship = z.object({
  id,
  fromId: id,
  toId: id,
  type: z.enum(RelationshipType),
  label: nullableText,
  createdAt: iso,
});

const taskDefinition = z.object({
  id,
  title: text,
  notes: nullableText,
  domain: z.enum(TaskDomain),
  frequencyType: z.enum(FrequencyType),
  interval: int.nullable(),
  daysOfWeek: z.array(int),
  startDate: iso,
  timesOfDay: z.array(text),
  weatherSensitive: z.boolean(),
  points: int,
  assignmentStrategy: z.enum(AssignmentStrategy),
  assigneeIds: z.array(id),
  active: z.boolean(),
  createdAt: iso,
});

const taskInstance = z.object({
  id,
  definitionId: id,
  dueDate: iso,
  assignedToId: nullableId,
  status: z.enum(TaskInstanceStatus),
  completedAt: nullableIso,
  completedById: nullableId,
  quantityConsumed: z.number().nullable(),
  createdAt: iso,
});

const pointsEntry = z.object({
  id,
  personId: id,
  delta: int,
  reason: nullableText,
  instanceId: nullableId,
  // Phase 20: a Sticker Store purchase or its refund; absent in v1–v3 files.
  orderId: nullableId.default(null),
  createdAt: iso,
});

const reward = z.object({
  id,
  title: text,
  // Positive, like the reward form; a 0 or negative cost would hand out free stickers.
  pointCost: int.min(1),
  active: z.boolean(),
  // Phase 20 store fields; absent in v1–v3 files.
  emoji: nullableText.default(null),
  bucketId: nullableId.default(null),
  // Same 1–7 the form allows; 0 would make a reward silently unbuyable.
  limitPerWeek: int.min(1).max(7).nullable().default(null),
  needsApproval: z.boolean().default(false),
  createdAt: iso,
});

const rewardBucket = z.object({ id, name: text, emoji: nullableText, createdAt: iso });

const rewardOrder = z.object({
  id,
  rewardId: id,
  personId: id,
  placedById: nullableId,
  title: text,
  emoji: nullableText,
  cost: int.min(1),
  status: z.enum(RewardOrderStatus),
  note: nullableText,
  decidedAt: nullableIso,
  decidedById: nullableId,
  closedAt: nullableIso,
  closedById: nullableId,
  createdAt: iso,
});

const medication = z.object({
  id,
  taskDefinitionId: id,
  quantityOnHand: z.number().nullable(),
  doseAmount: z.number().nullable(),
  refillThresholdQuantity: z.number().nullable(),
  prescriberId: nullableId,
  pharmacyId: nullableId,
});

const vehicle = z.object({
  id,
  name: text,
  make: nullableText,
  model: nullableText,
  year: int.nullable(),
  // Phase 53: absent in older files.
  vin: nullableText.default(null),
  currentMileage: int,
  mileageUpdatedAt: nullableIso,
  active: z.boolean(),
  createdAt: iso,
});

const maintenanceItem = z.object({
  id,
  vehicleId: id,
  title: text,
  notes: nullableText,
  intervalMiles: int.nullable(),
  intervalMonths: int.nullable(),
  lastDoneMileage: int.nullable(),
  lastDoneAt: nullableIso,
  active: z.boolean(),
  createdAt: iso,
});

const serviceLog = z.object({
  id,
  itemId: id,
  doneAt: iso,
  mileage: int,
  notes: nullableText,
  costCents: int.nullable(),
  loggedById: nullableId,
  createdAt: iso,
});

const fuelLog = z.object({
  id,
  vehicleId: id,
  filledAt: iso,
  mileage: int,
  gallons: z.number(),
  costCents: int.nullable(),
  fullTank: z.boolean(),
  missedPrevious: z.boolean(),
  notes: nullableText,
  loggedById: nullableId,
  createdAt: iso,
});

const recallAck = z.object({
  id,
  vehicleId: id,
  campaignNumber: text,
  acknowledgedAt: iso,
  acknowledgedById: nullableId,
});

const named = z.object({ id, name: text, createdAt: iso });
// Sections (Phase 22, format v5): older files have no emoji or order. Phase 37: which starting
// section it is, for guessing a new item's section. A file without it (made before Phase 37)
// gets it filled in by name, as the migration did for the live database (withStarterKeys).
const productGroup = z.object({
  id,
  name: text,
  emoji: nullableText.default(null),
  sortOrder: z.number().int().default(0),
  starterKey: nullableText.optional(),
  createdAt: iso,
});

const product = z.object({
  id,
  name: text,
  barcode: nullableText,
  brand: nullableText,
  imageUrl: nullableText,
  // "How it comes" (v5). Older files' defaultUnitId is dropped by the parse: QuantityUnit is gone.
  sizeAmount: z.number().positive().nullable().default(null),
  sizeUnit: nullableText.default(null),
  container: nullableText.default(null),
  defaultStoreId: nullableId,
  groupId: nullableId,
  createdAt: iso,
});

const shoppingListItem = z.object({
  id,
  /** Always set from v5 on. v1–v4 rows could be free text instead; restore turns those into
   * Pantry items (lib/backup/plan.ts's remapBackup). */
  productId: nullableId,
  freeText: nullableText.optional(),
  quantity: z.number(),
  done: z.boolean(),
  // Phase 23 (added within v5; older files default to false).
  kidPick: z.boolean().default(false),
  addedById: nullableId,
  requestedById: nullableId,
  createdAt: iso,
});

const purchase = z.object({ id, purchasedAt: iso, purchasedById: nullableId });

const purchaseItem = z.object({
  id,
  purchaseId: id,
  productId: nullableId,
  description: text,
  quantity: z.number(),
  requestedById: nullableId,
  kidPick: z.boolean().default(false),
});

// Receipt prices (Phase 24, format v6): what items cost and the receipt lines matched to them.
const itemPrice = z.object({
  id,
  productId: id,
  storeId: nullableId,
  totalCents: z.int32(),
  quantity: z.number(),
  unitCents: z.int32().nullable(),
  observedAt: iso,
});
const receiptAlias = z.object({ id, textKey: text, productId: id });

// Garage supplies (Phase 12.5, format v2). Composite-key join rows carry no id of their own.
const vehicleSupply = z.object({
  id,
  name: text,
  partNumber: nullableText,
  unit: nullableText,
  quantityOnHand: z.number().nullable(),
  lowThreshold: z.number().nullable(),
  notes: nullableText,
  active: z.boolean(),
  createdAt: iso,
});
const vehicleItemSupply = z.object({ itemId: id, supplyId: id, quantity: z.number() });
const vehicleServiceSupplyUse = z.object({ logId: id, supplyId: id, quantity: z.number() });

// School (Phase 18, format v3).
const schoolProfile = z.object({
  id,
  personId: id,
  schoolName: text,
  grade: nullableText,
  schoolYear: nullableText,
  transportNotes: nullableText,
  lunchNotes: nullableText,
  scheduleNotes: nullableText,
  notes: nullableText,
  createdAt: iso,
});
const schoolContact = z.object({ profileId: id, personId: id, role: text });
const schoolTask = z.object({
  id,
  kidPersonId: nullableId,
  title: text,
  kind: z.enum(SchoolTaskKind),
  dueDate: nullableIso,
  amountCents: int.nullable(),
  ownerPersonId: nullableId,
  status: z.enum(SchoolTaskStatus),
  doneAt: nullableIso,
  notes: nullableText,
  createdAt: iso,
});
const schoolAssignment = z.object({
  id,
  profileId: id,
  className: text,
  title: text,
  dueDate: nullableIso,
  status: z.enum(AssignmentStatus),
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  notes: nullableText,
  source: text,
  externalId: nullableText,
  doneAt: nullableIso,
  createdAt: iso,
});

// The digital pet (Phase 47, format v8). Everything hangs off a person, whose id restore
// re-issues. `state` is the pet's JSON as stored; restore drops a pet whose state doesn't read
// (lib/pet/stored.ts) rather than refusing the file. `seed` fixes its personality, so it's kept.
const pet = z.object({
  id,
  personId: id,
  name: text,
  seed: text,
  state: z.record(z.string(), z.json()),
  bornAt: iso,
  lastAdvancedAt: iso,
  createdAt: iso,
});
// Phase 56 added the spot; a backup from before then has none (the surface's usual spot).
const petItem = z.object({ id, personId: id, itemId: text, place: nullableText, x: z.number().int().nullish(), y: z.number().int().nullish(), createdAt: iso });
// Composite primary key (person, game), no id of its own.
const petPlay = z.object({ personId: id, game: text, paidAt: iso });
const petMemorial = z.object({
  id,
  personId: id,
  name: text,
  species: text,
  stage: text,
  form: int,
  cause: text,
  ageMinutes: int,
  favoriteToy: text,
  bornAt: iso,
  goneAt: iso,
  createdAt: iso,
});

// Which chores already brought a pet present (one per chore), so a restore doesn't hand
// them out again. instanceId is null once its chore is gone.
const petGift = z.object({ id, personId: id, instanceId: nullableId, day: text, itemId: nullableText, grantedAt: iso, openedAt: nullableIso });

// Phase 54: the collection book, every form a person's pets have reached. Composite primary
// key (person, species, stage, form), no id of its own.
const petDiscovery = z.object({ personId: id, species: text, stage: text, form: int, foundAt: iso });

export const BACKUP_FORMAT = "familyos-household-backup";
/**
 * v2 (Phase 12.5) added the garage-supplies arrays; v3 (Phase 18) the school arrays; v4
 * (Phase 20) the Sticker Store (buckets, orders, and new reward/ledger/household fields); v5
 * (Phase 22) the groceries redesign: product sizes and section order, every list row a Pantry
 * item, and no quantity units (an older file's units are ignored); v6 (Phase 24) receipt
 * prices and learned receipt matches; v7 (Phase 28) the sealed money jars; v8 (Phase 47) the
 * digital pet (pets, their items, game payouts, chore presents, the memory book, the collection book, and the household's care
 * hours). Older
 * files still restore with the arrays they lack defaulting to empty, so restoring one
 * removes that data here (the restore preview shows those delete counts). A v1 file still restores: those arrays
 * default to empty (and the restore preview says existing supplies will be removed).
 */
export const BACKUP_SCHEMA_VERSION = 8;

/**
 * Phase 28 (v7): the household's money jars, sealed (AES-256-GCM over gzipped JSON, see
 * lib/finance/backup.ts). Opaque here: lib/backup never reads inside it. Key names avoid
 * FORBIDDEN_BACKUP_KEYS (iv, authTag, encryptedValue). jarCount is in the clear so a
 * restore preview can say "N money jars (sealed)" without opening it.
 */
export const sealedMoneySchema = z.object({
  version: z.literal(1),
  cipher: z.literal("aes-256-gcm"),
  encoding: z.literal("gzip+json"),
  keyVersion: z.literal(1),
  jarCount: z.number().int().nonnegative(),
  nonce: z.string().max(64),
  tag: z.string().max(64),
  sealed: z.string(),
});
export type SealedMoney = z.infer<typeof sealedMoneySchema>;

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal([1, 2, 3, 4, 5, 6, 7, BACKUP_SCHEMA_VERSION]),
  exportedAt: iso,
  /**
   * Chore/med due dates and vehicle log dates are stored as the SERVER's local midnight.
   * Restoring on a server in a different timezone would shift them and duplicate
   * instances, so 16.5's restore checks this first.
   */
  exportedTimeZone: text,
  /** The newest applied Prisma migration when the backup was taken. */
  databaseMigration: nullableText,
  household,
  people: z.array(person),
  importantDates: z.array(importantDate),
  interactions: z.array(interaction),
  relationships: z.array(relationship),
  taskDefinitions: z.array(taskDefinition),
  taskInstances: z.array(taskInstance),
  pointsLedger: z.array(pointsEntry),
  rewards: z.array(reward),
  rewardBuckets: z.array(rewardBucket).default([]),
  rewardOrders: z.array(rewardOrder).default([]),
  medications: z.array(medication),
  vehicles: z.array(vehicle),
  maintenanceItems: z.array(maintenanceItem),
  serviceLogs: z.array(serviceLog),
  fuelLogs: z.array(fuelLog),
  recallAcks: z.array(recallAck),
  vehicleSupplies: z.array(vehicleSupply).default([]),
  vehicleItemSupplies: z.array(vehicleItemSupply).default([]),
  vehicleServiceSupplyUses: z.array(vehicleServiceSupplyUse).default([]),
  schoolProfiles: z.array(schoolProfile).default([]),
  schoolContacts: z.array(schoolContact).default([]),
  schoolTasks: z.array(schoolTask).default([]),
  schoolAssignments: z.array(schoolAssignment).default([]),
  stores: z.array(named),
  productGroups: z.array(productGroup).transform(withStarterKeys),
  products: z.array(product),
  shoppingListItems: z.array(shoppingListItem),
  purchases: z.array(purchase),
  purchaseItems: z.array(purchaseItem),
  itemPrices: z.array(itemPrice).default([]),
  receiptAliases: z.array(receiptAlias).default([]),
  pets: z.array(pet).default([]),
  petItems: z.array(petItem).default([]),
  petPlays: z.array(petPlay).default([]),
  petMemorials: z.array(petMemorial).default([]),
  petGifts: z.array(petGift).default([]),
  petDiscoveries: z.array(petDiscovery).default([]),
  sealedMoney: sealedMoneySchema.nullable().default(null),
});

export type Backup = z.infer<typeof backupSchema>;

/**
 * Keys that must never appear anywhere in a backup, at any depth. A test walks the whole
 * built backup against this list, a cheap guarantee on top of the schema (zod strips
 * unknown keys, but this catches a key someone adds to the schema itself by mistake).
 */
export const FORBIDDEN_BACKUP_KEYS = [
  "pinHash",
  "pinFailedAttempts",
  "pinLockedUntil",
  "authUserId",
  "entraSyncedAt",
  // Phase 40.4: Entra's say on a Microsoft sign-in, which restore doesn't carry either.
  "entraAccessEndedAt",
  "photo",
  "photoContentType",
  "encryptedValue",
  "iv",
  "authTag",
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
];
