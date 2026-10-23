import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPin } from "../lib/pin-hash";
import { PrismaClient } from "../app/generated/prisma/client";
import { productNameKey } from "../lib/product-name";

if (existsSync(".env")) process.loadEnvFile(".env");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Every seeded profile shares this PIN for local dev convenience.
// Change PINs per-person once Phase 1's People Hub can edit them.
const DEFAULT_PIN = "1234";

// The admin is whoever runs the seed, so their identity comes from the environment rather
// than the code. The email must match their Microsoft sign-in for the profile to auto-link.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@example.com";
const ADMIN_FIRST_NAME = process.env.SEED_ADMIN_FIRST_NAME?.trim() || "Admin";
const ADMIN_LAST_NAME = process.env.SEED_ADMIN_LAST_NAME?.trim() || null;

async function main() {
  const pinHash = await hashPin(DEFAULT_PIN);

  const household = await prisma.household.create({
    data: { name: "Our Family" },
  });

  await prisma.person.create({
    data: {
      householdId: household.id,
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      isHouseholdMember: true,
      role: "ADMIN",
      email: ADMIN_EMAIL,
      pinHash,
    },
  });

  await prisma.person.createMany({
    data: [
      {
        householdId: household.id,
        firstName: "Sample",
        lastName: "Co-Parent",
        isHouseholdMember: true,
        role: "ADULT",
        email: "replace-me@example.com",
        pinHash,
      },
      {
        householdId: household.id,
        firstName: "Kid One",
        lastName: "Example",
        isHouseholdMember: true,
        role: "KID",
        pinHash,
      },
      {
        householdId: household.id,
        firstName: "Kid Two",
        lastName: "Example",
        isHouseholdMember: true,
        role: "KID",
        pinHash,
      },
      {
        householdId: household.id,
        firstName: "Grandma",
        lastName: "Example",
        isHouseholdMember: false,
        phone: "555-0100",
      },
      {
        householdId: household.id,
        firstName: "Family",
        lastName: "Friend",
        isHouseholdMember: false,
        email: "friend@example.com",
      },
    ],
  });

  // A few backdated purchases so Phase 10's pantry-suggestion card isn't empty on the
  // first live check — Phase 8's own seed-data lesson (an empty stale-contacts card was
  // indistinguishable from a broken one until real usage weeks later would have surfaced
  // it). Three weekly purchases each for two items is the minimum computePantrySuggestions
  // needs to establish a cadence at all.
  const milk = await prisma.product.create({
    data: { householdId: household.id, name: "Milk", nameKey: productNameKey("Milk"), sizeAmount: 1, sizeUnit: "gal", container: "jug" },
  });
  const eggs = await prisma.product.create({
    data: { householdId: household.id, name: "Eggs", nameKey: productNameKey("Eggs"), sizeAmount: 12, sizeUnit: "count", container: "carton" },
  });
  // One item still missing its size, so the Pantry's "Needs details" filter has something
  // to show on a fresh database (Phase 22).
  await prisma.product.create({
    data: { householdId: household.id, name: "Goldfish crackers", nameKey: productNameKey("Goldfish crackers") },
  });
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (const daysAgo of [21, 14, 7]) {
    const purchasedAt = new Date(Date.now() - daysAgo * DAY_MS);
    const purchase = await prisma.purchase.create({
      data: { householdId: household.id, purchasedAt },
    });
    await prisma.purchaseItem.createMany({
      data: [
        { purchaseId: purchase.id, productId: milk.id, description: milk.name },
        { purchaseId: purchase.id, productId: eggs.id, description: eggs.name },
      ],
    });
  }

  // Three starter chores (one weather-sensitive, so the forecast flag has something to
  // attach to once a location is set in Settings → Household), plus eight backdated
  // completions so Kid One sits two shy of the first milestone (10) on first live check —
  // same "empty card reads as broken" lesson as the pantry seed above.
  const kids = await prisma.person.findMany({
    where: { householdId: household.id, firstName: { in: ["Kid One", "Kid Two"] } },
    select: { id: true, firstName: true },
  });
  const kidOne = kids.find((k) => k.firstName === "Kid One")!;
  const kidTwo = kids.find((k) => k.firstName === "Kid Two")!;

  const [makeBed] = await Promise.all([
    prisma.taskDefinition.create({
      data: {
        householdId: household.id,
        title: "Make bed",
        domain: "CHORE",
        frequencyType: "DAILY",
        startDate: new Date(),
        points: 2,
        assignmentStrategy: "LEAST_ASSIGNED",
        assignees: { connect: [{ id: kidOne.id }, { id: kidTwo.id }] },
      },
    }),
    prisma.taskDefinition.create({
      data: {
        householdId: household.id,
        title: "Take out trash",
        domain: "CHORE",
        frequencyType: "WEEKLY",
        interval: 1,
        startDate: new Date(),
        points: 5,
        assignmentStrategy: "FIXED",
        assignees: { connect: [{ id: kidOne.id }] },
      },
    }),
    prisma.taskDefinition.create({
      data: {
        householdId: household.id,
        title: "Walk the dog",
        domain: "CHORE",
        frequencyType: "DAILY",
        startDate: new Date(),
        points: 3,
        weatherSensitive: true,
        assignmentStrategy: "ROUND_ROBIN",
        assignees: { connect: [{ id: kidOne.id }, { id: kidTwo.id }] },
      },
    }),
  ]);

  for (const daysAgo of [8, 7, 6, 5, 4, 3, 2, 1]) {
    const dueDate = new Date(Date.now() - daysAgo * DAY_MS);
    const instance = await prisma.taskInstance.create({
      data: {
        definitionId: makeBed.id,
        dueDate,
        assignedToId: kidOne.id,
        status: "DONE",
        completedAt: dueDate,
        completedById: kidOne.id,
      },
    });
    await prisma.pointsLedger.create({
      data: { personId: kidOne.id, delta: makeBed.points, reason: makeBed.title, instanceId: instance.id },
    });
  }

  await prisma.reward.createMany({
    data: [
      { householdId: household.id, title: "Extra screen time (30 min)", pointCost: 10 },
      { householdId: household.id, title: "Pick the movie", pointCost: 20 },
    ],
  });

  // One vehicle NHTSA actually knows (2018 HONDA ODYSSEY has recalls on file), so the
  // Phase 12 recall chip, MPG, service history, and cost summary all render non-empty on
  // the first live check — the same "empty card reads as broken" lesson as above. Fill-ups
  // include one partial and one missed-previous, the two MPG-chain cases worth eyeballing.
  const midnightDaysAgo = (daysAgo: number) => {
    const d = new Date(Date.now() - daysAgo * DAY_MS);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const van = await prisma.vehicle.create({
    data: {
      householdId: household.id,
      name: "Family van",
      year: 2018,
      make: "Honda",
      model: "Odyssey",
      currentMileage: 48_900,
      mileageUpdatedAt: new Date(),
    },
  });
  const oilChange = await prisma.vehicleMaintenanceItem.create({
    data: {
      vehicleId: van.id,
      title: "Oil change",
      intervalMiles: 5000,
      intervalMonths: 6,
      lastDoneMileage: 45_100,
      lastDoneAt: midnightDaysAgo(120),
    },
  });
  await prisma.vehicleServiceLog.createMany({
    data: [
      { itemId: oilChange.id, doneAt: midnightDaysAgo(300), mileage: 40_200, costCents: 6_999, notes: "Jiffy Lube" },
      { itemId: oilChange.id, doneAt: midnightDaysAgo(120), mileage: 45_100, costCents: 7_499 },
    ],
  });
  await prisma.vehicleMaintenanceItem.createMany({
    data: [
      { vehicleId: van.id, title: "Tire rotation", intervalMiles: 7500 },
      { vehicleId: van.id, title: "Engine air filter", intervalMiles: 15_000, intervalMonths: 12 },
    ],
  });
  await prisma.vehicleFuelLog.createMany({
    data: [
      { vehicleId: van.id, filledAt: midnightDaysAgo(60), mileage: 46_700, gallons: 16.2, costCents: 5_540 },
      { vehicleId: van.id, filledAt: midnightDaysAgo(48), mileage: 47_060, gallons: 15.1, costCents: 5_210 },
      { vehicleId: van.id, filledAt: midnightDaysAgo(41), mileage: 47_240, gallons: 7.0, costCents: 2_380, fullTank: false },
      { vehicleId: van.id, filledAt: midnightDaysAgo(35), mileage: 47_420, gallons: 8.1, costCents: 2_790 },
      { vehicleId: van.id, filledAt: midnightDaysAgo(20), mileage: 48_150, gallons: 15.8, costCents: 5_450, missedPrevious: true },
      { vehicleId: van.id, filledAt: midnightDaysAgo(6), mileage: 48_520, gallons: 15.4, costCents: 5_300 },
    ],
  });

  console.log(`Seeded household "${household.name}" with 4 members + 2 contacts.`);
  console.log("Seeded 1 vehicle (2018 Honda Odyssey) with service history, fill-ups, and 3 maintenance items.");
  console.log("Seeded 3 chores (Make bed, Take out trash, Walk the dog) and 2 rewards.");
  console.log(`Every seeded profile PIN is "${DEFAULT_PIN}" — change via the People Hub once it exists.`);
  const adminName = [ADMIN_FIRST_NAME, ADMIN_LAST_NAME].filter(Boolean).join(" ");
  console.log(`Sign in with ${ADMIN_EMAIL} via Microsoft to auto-link the ${adminName} profile (set SEED_ADMIN_EMAIL / SEED_ADMIN_FIRST_NAME / SEED_ADMIN_LAST_NAME before seeding to change it).`);
  console.log('Replace "Sample Co-Parent" / kid names with your real family via Prisma Studio (npm run db:studio) for now.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
