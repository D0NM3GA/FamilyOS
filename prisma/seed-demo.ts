/**
 * Demo data for every part of the app, so it can be looked at "in action" on a dev database:
 * `npm run db:seed:demo`. DEV ONLY: it clears the household's chores, meds, store, vehicles,
 * groceries, school, contacts, money jars and the kids' pets and fills them again, dated around
 * today.
 *
 * It keeps the household's members and their sign-ins (the household of the oldest
 * Microsoft-linked admin, the one the dev sign-in acts as), adding a second grown-up and two
 * kids if it hasn't got them. Refuses to run in production.
 * Nothing here talks to Microsoft, banks or any other outside service.
 */
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../app/generated/prisma/client";
import { productNameKey } from "../lib/product-name";
import { merchantKeyOf, STARTING_CATEGORIES } from "../lib/finance/categories";
import { hashPin } from "../lib/pin-hash";
import { newEgg } from "../lib/pet/state";
import { epochMinute } from "../lib/pet/care-hours";

// Same as prisma/seed.ts, for the kids this adds.
const DEV_PIN = "1234";

if (process.env.NODE_ENV === "production") throw new Error("seed-demo is for development databases only.");

if (existsSync(".env")) process.loadEnvFile(".env");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// ---- dates (server-local, like the app) ---------------------------------------------------
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const at = (offset: number, h = 12, m = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, h, m);
/** A civil day (UTC midnight), for @db.Date columns. */
const civil = (offset: number) => {
  const d = at(offset);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
const ym = (offsetMonths: number) => {
  const d = new Date(today.getFullYear(), today.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Deterministic "random" so every run looks the same.
let seed = 20261009;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

async function main() {
  const admin = await prisma.person.findFirst({
    where: { role: "ADMIN", isHouseholdMember: true, authUserId: { not: null } },
    orderBy: { createdAt: "asc" },
    omit: { photo: true },
  });
  if (!admin) throw new Error("No Microsoft-linked admin yet: sign in once (or run the dev sign-in) first.");
  const householdId = admin.householdId;
  const { partner, kidA, kidB } = await ensureFamily(householdId, admin.id);
  console.log(`Household ${householdId}: ${admin.firstName}, ${partner.firstName}, ${kidA.firstName}, ${kidB.firstName}`);

  await clear(householdId);
  await prisma.person.updateMany({ where: { householdId, role: "KID" }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
  await prisma.person.update({ where: { id: admin.id }, data: { color: "SKY" } });
  await prisma.person.update({ where: { id: partner.id }, data: { color: "GRAPE" } });
  await prisma.person.update({ where: { id: kidA.id }, data: { color: "SUN" } });
  await prisma.person.update({ where: { id: kidB.id }, data: { color: "LIME" } });

  const people = await seedPeople(householdId, admin.id, partner.id, kidA.id, kidB.id);
  await seedChores(householdId, admin.id, kidA.id, kidB.id);
  await seedMeds(householdId, admin.id, partner.id, kidA.id, kidB.id, people);
  await seedStore(householdId, [admin.id, partner.id], kidA, kidB);
  await seedVehicles(householdId, admin.id, partner.id);
  const trips = await seedGroceries(householdId, admin.id, partner.id, kidA.id, kidB.id);
  await seedSchool(householdId, admin.id, partner.id, kidA.id, kidB.id, people);
  await seedMoney(householdId, admin.id, partner.id, partner.firstName, trips);
  await seedPets(householdId, kidA.id, kidB.id);
  console.log("Demo data ready.");
}

/**
 * The second grown-up and two kids the demo needs, from the household's members (a signed-in
 * adult first), adding the made-up family's Mom, Ivy and Max for any that are missing. Added
 * members aren't signed in to anything; the kids get the base seed's dev PIN.
 */
async function ensureFamily(householdId: string, adminId: string) {
  const members = () => prisma.person.findMany({ where: { householdId, isHouseholdMember: true }, omit: { photo: true }, orderBy: [{ createdAt: "asc" }, { firstName: "asc" }] });
  let all = await members();
  const adults = all.filter((p) => p.id !== adminId && (p.role === "ADULT" || p.role === "ADMIN"));
  if (!adults.length) await prisma.person.create({ data: { householdId, firstName: "Mom", lastName: "Parker", isHouseholdMember: true, role: "ADULT", email: "mom@example.com" } });
  const kidNames = ["Ivy", "Max"].filter((name) => !all.some((p) => p.role === "KID" && p.firstName === name));
  const missingKids = Math.max(0, 2 - all.filter((p) => p.role === "KID").length);
  if (missingKids) {
    const pinHash = await hashPin(DEV_PIN);
    for (const firstName of kidNames.slice(0, missingKids)) await prisma.person.create({ data: { householdId, firstName, lastName: "Parker", isHouseholdMember: true, role: "KID", pinHash } });
  }
  all = await members();
  const grownUps = all.filter((p) => p.id !== adminId && (p.role === "ADULT" || p.role === "ADMIN"));
  const partner = grownUps.find((p) => p.authUserId) ?? grownUps[0];
  const [kidA, kidB] = all.filter((p) => p.role === "KID");
  return { partner, kidA, kidB };
}

async function clear(householdId: string) {
  const inHousehold = { person: { householdId } };
  await prisma.rewardOrder.deleteMany({ where: { householdId } });
  await prisma.pointsLedger.deleteMany({ where: inHousehold });
  await prisma.notification.deleteMany({ where: { householdId } });
  await prisma.person.updateMany({ where: { householdId }, data: { savingRewardId: null } });
  await prisma.reward.deleteMany({ where: { householdId } });
  await prisma.rewardBucket.deleteMany({ where: { householdId } });
  await prisma.taskDefinition.deleteMany({ where: { householdId } });
  await prisma.vehicle.deleteMany({ where: { householdId } });
  await prisma.vehicleSupply.deleteMany({ where: { householdId } });
  await prisma.moneyJar.deleteMany({ where: { householdId } });
  await prisma.itemPrice.deleteMany({ where: { householdId } });
  await prisma.purchase.deleteMany({ where: { householdId } });
  await prisma.shoppingList.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.productGroup.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.schoolTask.deleteMany({ where: { householdId } });
  await prisma.schoolProfile.deleteMany({ where: { person: { householdId } } });
  await prisma.importantDate.deleteMany({ where: inHousehold });
  await prisma.interactionLog.deleteMany({ where: inHousehold });
  await prisma.personRelationship.deleteMany({ where: { from: { householdId } } });
  await prisma.person.deleteMany({ where: { householdId, isHouseholdMember: false } });
}

// ---- People Hub -----------------------------------------------------------------------------

async function seedPeople(householdId: string, adminId: string, partnerId: string, kidAId: string, kidBId: string) {
  const contact = (firstName: string, lastName: string, extra: Partial<Prisma.PersonUncheckedCreateInput> = {}) =>
    prisma.person.create({ data: { householdId, firstName, lastName, isHouseholdMember: false, ...extra }, omit: { photo: true } });
  const grandma = await contact("Rose", "Parker", { phone: "(555) 010-0142", notes: "Dad's mom. Loves gardening; allergic to shellfish.", contactCadenceDays: 7 });
  const grandpa = await contact("Walt", "Parker", { phone: "(555) 010-0143", contactCadenceDays: 14 });
  const aunt = await contact("Nina", "Alvarez", { email: "nina.alvarez@example.com", notes: "Dad's sister, lives a few hours away.", contactCadenceDays: 30 });
  const neighbor = await contact("Tom", "Becker", { phone: "(555) 010-0188", notes: "Next door. Has a spare key.", contactCadenceDays: 30 });
  const teacherA = await contact("Ana", "Rivera", { email: "a.rivera@acornhollow.example.edu", notes: "5th grade teacher" });
  const teacherB = await contact("David", "Chen", { email: "d.chen@acornhollow.example.edu", notes: "2nd grade teacher" });
  const coach = await contact("Mike", "Owens", { phone: "(555) 010-0110", notes: "Soccer coach (Saturdays)" });
  const doctor = await contact("Priya", "Patel", { phone: "(555) 010-0199", notes: "Pediatrician, Maple Street Pediatrics" });
  const pharmacy = await contact("CVS", "Pharmacy", { phone: "(555) 010-0123", notes: "Main St" });

  const dates: Prisma.ImportantDateCreateManyInput[] = [];
  const dateIn = (personId: string, type: "BIRTHDAY" | "ANNIVERSARY" | "OTHER", offset: number, year: number | null, label?: string) => {
    const d = at(offset);
    dates.push({ personId, type, month: d.getMonth() + 1, day: d.getDate(), year, label: label ?? null });
  };
  dateIn(grandma.id, "BIRTHDAY", 12, 1955);
  dateIn(adminId, "ANNIVERSARY", 21, 2010, "Wedding anniversary");
  dateIn(kidAId, "BIRTHDAY", 27, 2015);
  dateIn(aunt.id, "BIRTHDAY", 60, 1985);
  dateIn(kidBId, "BIRTHDAY", 140, 2018);
  dateIn(neighbor.id, "OTHER", 5, null, "Back from vacation");
  await prisma.importantDate.createMany({ data: dates });

  await prisma.interactionLog.createMany({
    data: [
      { personId: grandma.id, type: "CALL", occurredAt: at(-3, 18, 30), note: "Planning Thanksgiving at her house.", loggedById: adminId },
      { personId: grandma.id, type: "VISIT", occurredAt: at(-17, 14), note: "Kids helped with the garden.", loggedById: partnerId },
      { personId: grandpa.id, type: "TEXT", occurredAt: at(-9, 9), loggedById: adminId },
      { personId: aunt.id, type: "TEXT", occurredAt: at(-48, 20), note: "Sent photos from the beach.", loggedById: partnerId },
      { personId: neighbor.id, type: "VISIT", occurredAt: at(-70, 17), note: "Borrowed the ladder.", loggedById: adminId },
      { personId: coach.id, type: "EMAIL", occurredAt: at(-6, 8), note: "Practice moved to 9am.", loggedById: partnerId },
      { personId: teacherA.id, type: "EMAIL", occurredAt: at(-12, 15), note: "Conference sign-up.", loggedById: partnerId },
    ],
  });
  await prisma.person.update({ where: { id: grandma.id }, data: { lastContactedAt: at(-3, 18, 30) } });
  await prisma.person.update({ where: { id: grandpa.id }, data: { lastContactedAt: at(-9, 9) } });
  await prisma.person.update({ where: { id: aunt.id }, data: { lastContactedAt: at(-48, 20) } });
  await prisma.person.update({ where: { id: neighbor.id }, data: { lastContactedAt: at(-70, 17) } });

  await prisma.personRelationship.createMany({
    data: [
      { fromId: adminId, toId: partnerId, type: "SPOUSE" },
      { fromId: grandma.id, toId: adminId, type: "PARENT" },
      { fromId: grandpa.id, toId: adminId, type: "PARENT" },
      { fromId: aunt.id, toId: adminId, type: "SIBLING" },
      { fromId: kidAId, toId: adminId, type: "CHILD" },
      { fromId: kidBId, toId: adminId, type: "CHILD" },
      { fromId: neighbor.id, toId: adminId, type: "OTHER", label: "Neighbor" },
      { fromId: coach.id, toId: kidAId, type: "OTHER", label: "Soccer coach" },
    ],
  });
  return { grandma, teacherA, teacherB, coach, doctor, pharmacy };
}

// ---- Chores ---------------------------------------------------------------------------------

type Rule = { frequencyType: "DAILY" | "WEEKLY" | "INTERVAL_DAYS" | "DAYS_OF_WEEK"; interval?: number; daysOfWeek?: number[] };
const occursOn = (rule: Rule, start: Date, day: Date) => {
  const diff = Math.round((day.getTime() - start.getTime()) / 86_400_000);
  if (diff < 0) return false;
  if (rule.frequencyType === "DAILY") return true;
  if (rule.frequencyType === "WEEKLY") return diff % 7 === 0;
  if (rule.frequencyType === "INTERVAL_DAYS") return diff % (rule.interval ?? 1) === 0;
  return (rule.daysOfWeek ?? []).includes(day.getDay());
};

async function seedChores(householdId: string, adminId: string, kidAId: string, kidBId: string) {
  const start = at(-30, 0);
  const chores: { title: string; rule: Rule; points: number; strategy: "FIXED" | "ROUND_ROBIN"; who: string[]; notes?: string; skipRate: number }[] = [
    { title: "Feed the dog", rule: { frequencyType: "DAILY" }, points: 2, strategy: "ROUND_ROBIN", who: [kidAId, kidBId], skipRate: 0.1 },
    { title: "Empty the dishwasher", rule: { frequencyType: "DAILY" }, points: 3, strategy: "FIXED", who: [kidAId], skipRate: 0.2 },
    { title: "Take out the trash", rule: { frequencyType: "DAYS_OF_WEEK", daysOfWeek: [1, 4] }, points: 3, strategy: "FIXED", who: [kidBId], notes: "Bins to the curb Monday and Thursday nights.", skipRate: 0.1 },
    { title: "Tidy your room", rule: { frequencyType: "WEEKLY" }, points: 5, strategy: "ROUND_ROBIN", who: [kidAId, kidBId], skipRate: 0.15 },
    { title: "Water the plants", rule: { frequencyType: "INTERVAL_DAYS", interval: 3 }, points: 0, strategy: "FIXED", who: [adminId], skipRate: 0.05 },
  ];
  for (const c of chores) {
    const def = await prisma.taskDefinition.create({
      data: {
        householdId,
        title: c.title,
        notes: c.notes ?? null,
        domain: "CHORE",
        frequencyType: c.rule.frequencyType,
        interval: c.rule.interval ?? null,
        daysOfWeek: c.rule.daysOfWeek ?? [],
        startDate: start,
        points: c.points,
        assignmentStrategy: c.strategy,
        assignees: { connect: c.who.map((id) => ({ id })) },
      },
    });
    let n = 0;
    for (let offset = -13; offset <= 0; offset++) {
      const day = at(offset, 0);
      if (!occursOn(c.rule, start, day)) continue;
      const assignedToId = c.strategy === "ROUND_ROBIN" ? c.who[n++ % c.who.length] : c.who[0];
      const done = offset < 0 && rand() > c.skipRate;
      // Older misses were skipped by a grown-up; the last two days' are still overdue.
      const status = done ? "DONE" : offset >= -2 ? "PENDING" : "SKIPPED";
      const inst = await prisma.taskInstance.create({
        data: { definitionId: def.id, dueDate: day, assignedToId, status, completedAt: done ? at(offset, 17, between(0, 59)) : null, completedById: done ? assignedToId : null },
      });
      if (done && c.points > 0) await prisma.pointsLedger.create({ data: { personId: assignedToId, delta: c.points, reason: c.title, instanceId: inst.id, createdAt: at(offset, 17) } });
    }
  }
}

// ---- Meds -----------------------------------------------------------------------------------

async function seedMeds(householdId: string, adminId: string, partnerId: string, kidAId: string, kidBId: string, people: { doctor: { id: string }; pharmacy: { id: string } }) {
  const start = at(-20, 0);
  const meds = [
    { title: "Amoxicillin 250mg", forId: kidBId, times: ["08:00", "20:00"], points: 1, qty: 12, dose: 1, refill: 4, notes: "With food. Finish the whole course.", missed: [] as number[] },
    { title: "Zyrtec (children's)", forId: kidAId, times: ["19:00"], points: 1, qty: 5, dose: 1, refill: 7, notes: "Allergy season.", missed: [] },
    { title: "Vitamin D 2000 IU", forId: adminId, times: ["08:00"], points: 0, qty: 48, dose: 1, refill: 10, notes: null, missed: [-3] },
    { title: "Allergy nasal spray", forId: partnerId, times: ["07:30"], points: 0, qty: 60, dose: 2, refill: 20, notes: "2 sprays each side.", missed: [] },
  ];
  for (const m of meds) {
    const def = await prisma.taskDefinition.create({
      data: {
        householdId,
        title: m.title,
        notes: m.notes,
        domain: "MED",
        frequencyType: "DAILY",
        daysOfWeek: [],
        startDate: start,
        timesOfDay: m.times,
        points: m.points,
        assignmentStrategy: "FIXED",
        assignees: { connect: [{ id: m.forId }] },
        medication: { create: { quantityOnHand: m.qty, doseAmount: m.dose, refillThresholdQuantity: m.refill, prescriberId: m.forId === kidAId || m.forId === kidBId ? people.doctor.id : null, pharmacyId: people.pharmacy.id } },
      },
    });
    for (let offset = -6; offset <= 0; offset++) {
      for (const time of m.times) {
        const [hh, mm] = time.split(":").map(Number);
        const due = at(offset, hh, mm);
        const done = due < now && !(m.missed.includes(offset) && hh < 12);
        if (offset === 0 && due > now) continue; // the app makes today's later doses
        const inst = await prisma.taskInstance.create({
          data: {
            definitionId: def.id,
            dueDate: due,
            assignedToId: m.forId,
            status: done ? "DONE" : "PENDING",
            completedAt: done ? new Date(due.getTime() + between(2, 40) * 60_000) : null,
            completedById: done ? (m.forId === kidAId || m.forId === kidBId ? pick([adminId, partnerId]) : m.forId) : null,
            quantityConsumed: done ? m.dose : null,
          },
        });
        if (done && m.points > 0) await prisma.pointsLedger.create({ data: { personId: m.forId, delta: m.points, reason: m.title, instanceId: inst.id, createdAt: due } });
      }
    }
  }
}

// ---- Sticker Store --------------------------------------------------------------------------

async function seedStore(householdId: string, adultIds: string[], kidA: { id: string; firstName: string }, kidB: { id: string; firstName: string }) {
  const bucket = (name: string, emoji: string) => prisma.rewardBucket.create({ data: { householdId, name, emoji } });
  const treats = await bucket("Treats", "🍭");
  const screen = await bucket("Screen time", "📺");
  const big = await bucket("Big stuff", "🎁");
  const reward = (title: string, emoji: string, pointCost: number, bucketId: string, extra: Partial<Prisma.RewardUncheckedCreateInput> = {}) =>
    prisma.reward.create({ data: { householdId, title, emoji, pointCost, bucketId, ...extra } });
  const iceCream = await reward("Ice cream after dinner", "🍦", 15, treats.id);
  await reward("Pick the dessert", "🧁", 10, treats.id);
  const tablet = await reward("30 minutes of tablet", "📱", 10, screen.id, { limitPerWeek: 3 });
  await reward("Movie night pick", "🎬", 25, screen.id);
  const lego = await reward("LEGO set (up to $30)", "🧱", 150, big.id, { needsApproval: true });
  const sleepover = await reward("Sleepover with a friend", "🏕️", 100, big.id, { needsApproval: true });
  await reward("Skip a chore", "🎟️", 20, treats.id, { active: false });

  await prisma.pointsLedger.createMany({
    data: [
      { personId: kidA.id, delta: 20, reason: "Helped carry groceries", createdAt: at(-8, 16) },
      { personId: kidB.id, delta: 10, reason: "Read to grandma", createdAt: at(-5, 19) },
      { personId: kidA.id, delta: 150, reason: "Great report card", createdAt: at(-25, 18) },
      { personId: kidB.id, delta: 40, reason: "Brave at the dentist", createdAt: at(-22, 11) },
    ],
  });
  const order = async (r: { id: string; title: string; emoji: string | null; pointCost: number }, who: { id: string; firstName: string }, status: "WAITING_OK" | "TO_DO" | "DELIVERED" | "DECLINED", offset: number) => {
    const o = await prisma.rewardOrder.create({
      data: {
        householdId,
        rewardId: r.id,
        personId: who.id,
        placedById: who.id,
        title: r.title,
        emoji: r.emoji,
        cost: r.pointCost,
        status,
        createdAt: at(offset, 18),
        decidedAt: status === "WAITING_OK" ? null : at(offset, 19),
        decidedById: status === "WAITING_OK" ? null : adultIds[0],
        closedAt: status === "DELIVERED" || status === "DECLINED" ? at(offset, 20) : null,
        closedById: status === "DELIVERED" || status === "DECLINED" ? adultIds[0] : null,
      },
    });
    await prisma.pointsLedger.create({ data: { personId: who.id, delta: -r.pointCost, reason: r.title, orderId: o.id, createdAt: at(offset, 18) } });
    if (status === "DECLINED") await prisma.pointsLedger.create({ data: { personId: who.id, delta: r.pointCost, reason: `Not this time: ${r.title}`, orderId: o.id, createdAt: at(offset, 20) } });
    const needsOk = status === "WAITING_OK";
    for (const adult of adultIds) {
      await prisma.notification.create({
        data: {
          householdId,
          recipientId: adult,
          kind: needsOk ? "ORDER_NEEDS_OK" : "ORDER_PLACED",
          title: needsOk ? `${who.firstName} wants ${r.emoji} ${r.title} · ${r.pointCost} stickers · needs your OK` : `${who.firstName} bought ${r.emoji} ${r.title} · ${r.pointCost} stickers`,
          href: "/points#orders",
          orderId: o.id,
          readAt: offset < -1 ? at(offset, 21) : null,
          createdAt: at(offset, 18),
        },
      });
    }
  };
  await order(iceCream, kidA, "DELIVERED", -5);
  await order(tablet, kidB, "TO_DO", 0);
  await order(sleepover, kidB, "DECLINED", -9);
  await order(tablet, kidA, "DELIVERED", -2);
  await order(lego, kidA, "WAITING_OK", -1);
  await prisma.person.update({ where: { id: kidB.id }, data: { savingRewardId: lego.id } });
}

// ---- Vehicles -------------------------------------------------------------------------------

async function seedVehicles(householdId: string, adminId: string, partnerId: string) {
  const oil = await prisma.vehicleSupply.create({ data: { householdId, name: "0W-20 synthetic oil", unit: "qt", quantityOnHand: 3, lowThreshold: 5, notes: "Costco 6-pack" } });
  const filter = await prisma.vehicleSupply.create({ data: { householdId, name: "Oil filter (Honda 15400-PLM-A02)", partNumber: "15400-PLM-A02", unit: "each", quantityOnHand: 2, lowThreshold: 1 } });
  await prisma.vehicleSupply.create({ data: { householdId, name: "Washer fluid", unit: "gal", quantityOnHand: 1, lowThreshold: 1 } });

  const vehicles = [
    {
      name: "Family Van",
      make: "Honda",
      model: "Odyssey",
      year: 2019,
      miles: 61240,
      mpg: 21,
      who: partnerId,
      items: [
        { title: "Oil change", miles: 5000, months: 6, lastMiles: 56500, lastDays: -170, cost: 0, supplies: true },
        { title: "Tire rotation", miles: 7500, months: null, lastMiles: 56500, lastDays: -170, cost: 2500 },
        { title: "Cabin air filter", miles: 15000, months: 12, lastMiles: 49800, lastDays: -330, cost: 3900 },
        { title: "Wiper blades", miles: null, months: 12, lastMiles: 44000, lastDays: -420, cost: 4600 },
        { title: "State registration", miles: null, months: 12, lastMiles: 50900, lastDays: -350, cost: 8500 },
      ],
    },
    {
      name: "Dad's Truck",
      make: "Ford",
      model: "F-150",
      year: 2016,
      miles: 98410,
      mpg: 17,
      who: adminId,
      items: [
        { title: "Oil change", miles: 5000, months: 6, lastMiles: 95100, lastDays: -60, cost: 7900 },
        { title: "Brake pads (front)", miles: 40000, months: null, lastMiles: 71000, lastDays: -700, cost: 28900 },
        { title: "Transmission fluid", miles: 60000, months: null, lastMiles: 60200, lastDays: -900, cost: 21000 },
      ],
    },
  ];
  for (const v of vehicles) {
    const vehicle = await prisma.vehicle.create({ data: { householdId, name: v.name, make: v.make, model: v.model, year: v.year, currentMileage: v.miles, mileageUpdatedAt: at(-1, 18) } });
    for (const it of v.items) {
      const item = await prisma.vehicleMaintenanceItem.create({
        data: { vehicleId: vehicle.id, title: it.title, intervalMiles: it.miles, intervalMonths: it.months, lastDoneMileage: it.lastMiles, lastDoneAt: at(it.lastDays) },
      });
      const log = await prisma.vehicleServiceLog.create({
        data: { itemId: item.id, doneAt: at(it.lastDays, 10), mileage: it.lastMiles, costCents: it.cost || null, notes: it.supplies ? "Did it in the driveway." : null, loggedById: v.who, createdAt: at(it.lastDays, 11) },
      });
      if ("supplies" in it && it.supplies) {
        await prisma.vehicleItemSupply.createMany({ data: [{ itemId: item.id, supplyId: oil.id, quantity: 5 }, { itemId: item.id, supplyId: filter.id, quantity: 1 }] });
        await prisma.vehicleServiceSupplyUse.createMany({ data: [{ logId: log.id, supplyId: oil.id, quantity: 5 }, { logId: log.id, supplyId: filter.id, quantity: 1 }] });
      }
    }
    // Fill-ups over the last two months, mileage counting up to today's reading.
    let miles = v.miles - 1900;
    for (let offset = -58; offset <= -1; offset += between(6, 9)) {
      const gallons = Math.round((14 + rand() * 6) * 10) / 10;
      miles += Math.round(gallons * v.mpg * (0.9 + rand() * 0.2));
      if (miles > v.miles) miles = v.miles;
      await prisma.vehicleFuelLog.create({
        data: { vehicleId: vehicle.id, filledAt: at(offset, 17), mileage: miles, gallons, costCents: Math.round(gallons * (310 + between(0, 40))), fullTank: true, loggedById: v.who, createdAt: at(offset, 17) },
      });
    }
  }
}

// ---- Groceries ------------------------------------------------------------------------------

async function seedGroceries(householdId: string, adminId: string, partnerId: string, kidAId: string, kidBId: string) {
  const store = async (name: string) => prisma.store.create({ data: { householdId, name } });
  const publix = await store("Publix");
  const costco = await store("Costco");
  const target = await store("Target");
  const groups = new Map<string, string>();
  // Starting sections the family renamed (Phase 37): new items are still guessed into them.
  for (const [i, [name, emoji, starterKey]] of [
    ["Produce", "🥦", "produce"],
    ["Dairy & eggs", "🥛", "dairy"],
    ["Meat & seafood", "🥩", "meat"],
    ["Bakery", "🍞", "bakery"],
    ["Pantry", "🥫", "pantry"],
    ["Snacks", "🍪", "snacks"],
    ["Frozen", "🧊", "frozen"],
    ["Household", "🧻", "household"],
  ].entries()) {
    const g = await prisma.productGroup.create({ data: { householdId, name, emoji, sortOrder: i, starterKey } });
    groups.set(name, g.id);
  }
  const products = new Map<string, string>();
  const product = async (name: string, group: string, storeId: string, size?: [number, string, string?], brand?: string) => {
    const p = await prisma.product.create({
      data: { householdId, name, nameKey: productNameKey(name), groupId: groups.get(group), defaultStoreId: storeId, sizeAmount: size?.[0] ?? null, sizeUnit: size?.[1] ?? null, container: size?.[2] ?? null, brand: brand ?? null },
    });
    products.set(name, p.id);
    return p;
  };
  await product("Bananas", "Produce", publix.id, [3, "lb"]);
  await product("Strawberries", "Produce", publix.id, [1, "lb", "box"]);
  await product("Baby carrots", "Produce", publix.id, [1, "lb", "bag"]);
  await product("Eggs", "Dairy & eggs", costco.id, [24, "ct"], "Kirkland");
  await product("Milk (2%)", "Dairy & eggs", publix.id, [1, "gal"]);
  await product("Shredded cheddar", "Dairy & eggs", publix.id, [8, "oz", "bag"]);
  await product("Greek yogurt", "Dairy & eggs", publix.id, [32, "oz", "tub"], "Chobani");
  await product("Chicken breasts", "Meat & seafood", costco.id, [6, "lb", "pack"]);
  await product("Ground beef", "Meat & seafood", publix.id, [2, "lb"]);
  await product("Sandwich bread", "Bakery", publix.id, [20, "oz", "loaf"], "Dave's Killer Bread");
  await product("Pasta", "Pantry", publix.id, [1, "lb", "box"], "Barilla");
  await product("Peanut butter", "Pantry", costco.id, [40, "oz", "jar"], "Jif");
  await product("Cereal", "Pantry", target.id, [18, "oz", "box"], "Cheerios");
  await product("Goldfish crackers", "Snacks", target.id, [30, "oz", "carton"], "Pepperidge Farm");
  await product("Granola bars", "Snacks", costco.id, [48, "ct", "box"], "Nature Valley");
  await product("Frozen waffles", "Frozen", publix.id, [10, "ct", "box"], "Eggo");
  await product("Paper towels", "Household", costco.id, [12, "rolls", "pack"], "Bounty");
  await product("Dish soap", "Household", target.id, [28, "oz", "bottle"], "Dawn");
  await product("Dog food", "Household", costco.id, [40, "lb", "bag"], "Kirkland");

  const list = await prisma.shoppingList.create({ data: { householdId } });
  const item = (name: string, quantity: number, addedById: string, extra: Partial<Prisma.ShoppingListItemUncheckedCreateInput> = {}) =>
    prisma.shoppingListItem.create({ data: { listId: list.id, productId: products.get(name)!, quantity, addedById, ...extra } });
  await item("Milk (2%)", 2, partnerId);
  await item("Eggs", 1, partnerId);
  await item("Bananas", 1, adminId);
  await item("Ground beef", 1, adminId);
  await item("Sandwich bread", 2, partnerId);
  await item("Paper towels", 1, adminId);
  await item("Dog food", 1, partnerId);
  await item("Goldfish crackers", 1, kidBId, { requestedById: kidBId, kidPick: true });
  await item("Strawberries", 2, kidAId, { requestedById: kidAId, kidPick: true });
  await item("Frozen waffles", 1, adminId, { done: true });

  // Past trips (what "Finish trip" saves) and the prices receipts taught it.
  const trips: { id: string; storeName: string; offset: number }[] = [];
  const trip = async (offset: number, byId: string, storeId: string, storeName: string, lines: [string, number, number][]) => {
    const t = await prisma.purchase.create({
      data: {
        householdId,
        listId: list.id,
        purchasedAt: at(offset, 11),
        purchasedById: byId,
        items: { create: lines.map(([name, quantity]) => ({ productId: products.get(name)!, description: name, quantity })) },
      },
    });
    await prisma.itemPrice.createMany({
      data: lines.map(([name, quantity, cents]) => ({ householdId, productId: products.get(name)!, storeId, totalCents: cents, quantity, unitCents: Math.round(cents / quantity), observedAt: at(offset, 11) })),
    });
    trips.push({ id: t.id, storeName, offset });
  };
  await trip(-19, partnerId, publix.id, "PUBLIX", [["Milk (2%)", 2, 798], ["Bananas", 1, 189], ["Strawberries", 2, 798], ["Ground beef", 1, 1198], ["Pasta", 3, 597], ["Sandwich bread", 1, 549]]);
  await trip(-12, adminId, publix.id, "PUBLIX", [["Milk (2%)", 2, 818], ["Greek yogurt", 1, 699], ["Shredded cheddar", 2, 798], ["Baby carrots", 1, 249], ["Frozen waffles", 2, 858]]);
  await trip(-9, partnerId, costco.id, "COSTCO", [["Eggs", 1, 829], ["Chicken breasts", 1, 2199], ["Peanut butter", 1, 1149], ["Paper towels", 1, 2399], ["Granola bars", 1, 1299], ["Dog food", 1, 4599]]);
  await trip(-4, partnerId, publix.id, "PUBLIX", [["Milk (2%)", 1, 419], ["Bananas", 1, 199], ["Sandwich bread", 2, 1098], ["Strawberries", 1, 399]]);
  return trips;
}

// ---- School ---------------------------------------------------------------------------------

async function seedSchool(
  householdId: string,
  adminId: string,
  partnerId: string,
  kidAId: string,
  kidBId: string,
  people: { teacherA: { id: string }; teacherB: { id: string }; coach: { id: string } },
) {
  const year = today.getMonth() >= 6 ? `${today.getFullYear()}-${String((today.getFullYear() + 1) % 100).padStart(2, "0")}` : `${today.getFullYear() - 1}-${String(today.getFullYear() % 100).padStart(2, "0")}`;
  const profileA = await prisma.schoolProfile.create({
    data: {
      personId: kidAId,
      schoolName: "Acorn Hollow Elementary",
      grade: "5",
      schoolYear: year,
      transportNotes: "Car line pickup at 2:45; bus #14 on Wednesdays.",
      lunchNotes: "Packs lunch Mon–Thu, pizza Friday ($3.50).",
      scheduleNotes: "PE Tuesday/Thursday: sneakers. Library books due Mondays.",
      contacts: { create: [{ personId: people.teacherA.id, role: "Teacher" }, { personId: people.coach.id, role: "Soccer coach" }] },
    },
  });
  const profileB = await prisma.schoolProfile.create({
    data: {
      personId: kidBId,
      schoolName: "Acorn Hollow Elementary",
      grade: "2",
      schoolYear: year,
      transportNotes: "Car line pickup at 2:45.",
      lunchNotes: "School lunch account.",
      contacts: { create: [{ personId: people.teacherB.id, role: "Teacher" }] },
    },
  });
  await prisma.schoolTask.createMany({
    data: [
      { householdId, kidPersonId: kidAId, title: "Field trip permission slip (Science museum)", kind: "FORM", dueDate: at(3, 0), ownerPersonId: partnerId },
      { householdId, kidPersonId: kidAId, title: "Picture day fee", kind: "FEE", dueDate: at(6, 0), amountCents: 1800, ownerPersonId: adminId },
      { householdId, kidPersonId: kidAId, title: "Poster board for science fair", kind: "SUPPLIES", dueDate: at(10, 0), ownerPersonId: adminId },
      { householdId, kidPersonId: kidBId, title: "Book fair money", kind: "FEE", dueDate: at(1, 0), amountCents: 1500, ownerPersonId: partnerId },
      { householdId, kidPersonId: kidBId, title: "Emergency contact form", kind: "FORM", dueDate: at(-2, 0), ownerPersonId: partnerId },
      { householdId, kidPersonId: kidBId, title: "Library card renewal", kind: "OTHER", dueDate: at(-8, 0), ownerPersonId: adminId, status: "DONE", doneAt: at(-9, 18) },
    ],
  });
  const assignment = (profileId: string, className: string, title: string, offset: number | null, status: "TODO" | "DONE" | "MISSING" = "TODO", extra: Partial<Prisma.SchoolAssignmentUncheckedCreateInput> = {}) => ({
    profileId,
    className,
    title,
    dueDate: offset == null ? null : at(offset, 23, 59),
    status,
    doneAt: status === "DONE" ? at((offset ?? 0) - 1, 19) : null,
    ...extra,
  });
  await prisma.schoolAssignment.createMany({
    data: [
      assignment(profileA.id, "Math", "Fractions worksheet (p. 42)", 1),
      assignment(profileA.id, "Reading", "Reading log: 20 minutes a night", 4),
      assignment(profileA.id, "Science", "Plant life cycle quiz", -3, "DONE", { score: 18, maxScore: 20 }),
      assignment(profileA.id, "Spelling", "Unit 6 practice", -2, "MISSING"),
      assignment(profileA.id, "Social Studies", "State regions map", 8),
      assignment(profileB.id, "Reading", "Sight words: list 5", 2),
      assignment(profileB.id, "Math", "Counting by 5s", -1, "DONE", { score: 10, maxScore: 10 }),
      assignment(profileB.id, "Art", "Leaf rubbing collage", 5),
    ],
  });
}

// ---- Money jar ------------------------------------------------------------------------------

async function seedMoney(householdId: string, adminId: string, partnerId: string, partnerName: string, trips: { id: string; storeName: string; offset: number }[]) {
  const jar = await prisma.moneyJar.create({
    data: { householdId, name: "Family", emoji: "🏡", cushionCents: 50000, members: { create: [{ personId: adminId, alertOverBudget: true }, { personId: partnerId }] } },
  });
  await prisma.finCategory.createMany({ data: STARTING_CATEGORIES.map((c, i) => ({ jarId: jar.id, key: c.key, name: c.name, emoji: c.emoji, kind: c.kind, sortOrder: i })) });
  const cats = new Map((await prisma.finCategory.findMany({ where: { jarId: jar.id } })).map((c) => [c.key, c.id]));
  const budgets: Record<string, number> = { groceries: 90000, dining: 25000, car: 25000, kids: 20000, fun: 15000, gifts: 10000, shopping: 30000 };
  for (const [key, cents] of Object.entries(budgets)) await prisma.finCategory.update({ where: { jarId_key: { jarId: jar.id, key } }, data: { budgetCents: cents } });
  await prisma.finCategory.update({ where: { jarId_key: { jarId: jar.id, key: "gifts" } }, data: { rollover: true, rolloverFrom: ym(-3), goalCents: 60000, goalMonth: ym(2) } });

  const account = (name: string, externalId: string, source: "SIMPLEFIN" | "MANUAL", extra: Partial<Prisma.FinAccountUncheckedCreateInput> = {}) =>
    prisma.finAccount.create({ data: { jarId: jar.id, source, externalId, name, ...extra } });
  const checking = await account("Joint Checking", "demo-checking", "SIMPLEFIN", { org: "Hometown Credit Union", balanceCents: 342215, availableCents: 338015, balanceAt: at(0, 6), spending: true });
  const card = await account("Sapphire Card", "demo-card", "SIMPLEFIN", { org: "Chase", balanceCents: -118842, balanceAt: at(0, 6) });
  const savings = await account("Savings", "demo-savings", "MANUAL", { org: "Hometown Credit Union", balanceCents: 1254000, balanceAt: at(-2, 9) });

  // Net worth (Phase 34): six month-ends of balances, and the minivan, its loan and a 529 typed in.
  const monthEndUtc = (mOff: number) => new Date(Date.UTC(today.getFullYear(), today.getMonth() + mOff + 1, 0));
  const monthStartUtc = (mOff: number) => new Date(Date.UTC(today.getFullYear(), today.getMonth() + mOff, 1));
  await prisma.finBalanceDay.createMany({
    data: [-6, -5, -4, -3, -2, -1].flatMap((mOff) => [
      { accountId: checking.id, day: monthEndUtc(mOff), balanceCents: 250000 + (6 + mOff) * 14000 },
      { accountId: card.id, day: monthEndUtc(mOff), balanceCents: -(90000 + Math.abs(mOff % 3) * 9000) },
      { accountId: savings.id, day: monthEndUtc(mOff), balanceCents: 1254000 + mOff * 30000 },
    ]),
  });
  const holding = (name: string, kind: "VEHICLE" | "LOAN" | "OTHER_ASSET", values: [mOff: number, cents: number][]) =>
    prisma.finHolding.create({ data: { jarId: jar.id, name, kind, values: { create: values.map(([mOff, cents]) => ({ valuedOn: monthStartUtc(mOff), valueCents: cents })) } } });
  await holding("The minivan", "VEHICLE", [[-7, 2450000], [-1, 2280000]]);
  await holding("Minivan loan", "LOAN", [[-7, 1420000], [-4, 1310000], [0, 1190000]]);
  await holding("Kids' 529", "OTHER_ASSET", [[-8, 800000], [-2, 960000]]);

  type Row = { acct: { id: string; source: "SIMPLEFIN" | "MANUAL" }; offset: number; cents: number; desc: string; cat: string | null; pending?: boolean; gift?: { by: string; from: string; revealIn: number }; purchaseId?: string };
  const rows: Row[] = [];
  const add = (r: Row) => {
    if (r.offset <= 0) rows.push(r);
  };
  const first = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const startOffset = Math.round((first.getTime() - today.getTime()) / 86_400_000);

  // Paychecks every other Friday.
  let friday = startOffset;
  while (at(friday).getDay() !== 5) friday++;
  for (let d = friday; d <= 0; d += 14) add({ acct: checking, offset: d, cents: 280000, desc: "ACME CORP PAYROLL DIR DEP", cat: "income" });

  for (let mOff = -6; mOff <= 0; mOff++) {
    const base = new Date(today.getFullYear(), today.getMonth() + mOff, 1);
    const day = (n: number) => Math.round((new Date(base.getFullYear(), base.getMonth(), n).getTime() - today.getTime()) / 86_400_000);
    const recent = mOff >= -1;
    add({ acct: checking, offset: day(1), cents: -185000, desc: "OAK APARTMENTS RENT ACH", cat: "bills" });
    add({ acct: checking, offset: day(2), cents: -30000, desc: "ONLINE TRANSFER TO SAVINGS", cat: "transfers" });
    add({ acct: savings, offset: day(2), cents: 30000, desc: "ONLINE TRANSFER FROM CHECKING", cat: "transfers" });
    add({ acct: checking, offset: day(7), cents: -between(4100, 5300), desc: "CITY POWER & WATER", cat: "bills" });
    add({ acct: checking, offset: day(12), cents: -between(11800, 17600), desc: "METRO GAS BILL", cat: "bills" });
    add({ acct: checking, offset: day(22), cents: -13800, desc: "GEICO AUTO INSURANCE", cat: "car" });
    add({ acct: card, offset: day(3), cents: recent ? -1799 : -1599, desc: "NETFLIX.COM", cat: "subscriptions" });
    add({ acct: card, offset: day(9), cents: -1199, desc: "SPOTIFY USA", cat: "subscriptions" });
    add({ acct: card, offset: day(14), cents: -299, desc: "APPLE.COM/BILL", cat: "subscriptions" });
    add({ acct: card, offset: day(15), cents: -7999, desc: "COMCAST XFINITY", cat: "bills" });
    add({ acct: card, offset: day(20), cents: -1399, desc: "DISNEY PLUS", cat: "subscriptions" });
    const autopay = between(95000, 160000);
    add({ acct: checking, offset: day(25), cents: -autopay, desc: "CHASE CREDIT CRD AUTOPAY", cat: "transfers" });
    add({ acct: card, offset: day(25), cents: autopay, desc: "AUTOMATIC PAYMENT - THANK YOU", cat: "transfers" });
    add({ acct: card, offset: day(between(4, 26)), cents: -between(1800, 8900), desc: `AMAZON MKTPL*${pick(["2K4L9", "7HD31", "QX88P", "M3T0Z"])}`, cat: "shopping" });
    add({ acct: card, offset: day(between(5, 25)), cents: -between(4200, 6800), desc: "AMC THEATRES #0414", cat: "fun" });
    if (mOff % 2 === 0) add({ acct: card, offset: day(between(3, 27)), cents: -between(2000, 4500), desc: "CVS/PHARMACY #05211", cat: "health" });
    if (mOff % 3 === 0) add({ acct: card, offset: day(between(6, 24)), cents: -between(3500, 14000), desc: "THE HOME DEPOT #6345", cat: "home" });
  }
  // Every-week-ish spending across the whole span.
  for (let d = startOffset; d <= 0; d += between(6, 8)) add({ acct: card, offset: d, cents: -between(12500, 26500), desc: "PUBLIX #1234", cat: "groceries" });
  for (let d = startOffset + 9; d <= -1; d += between(26, 33)) add({ acct: card, offset: d, cents: -between(18000, 29000), desc: "COSTCO WHSE #0123", cat: "groceries" });
  for (let d = startOffset + 2; d <= 0; d += between(5, 9)) add({ acct: card, offset: d, cents: -between(3800, 6400), desc: pick(["SHELL OIL 57444", "CIRCLE K 5123", "EXXON 412"]), cat: "car" });
  for (let d = startOffset + 1; d <= 0; d += between(4, 8)) add({ acct: card, offset: d, cents: -between(1500, 7800), desc: pick(["CHIPOTLE 2231", "CHICK-FIL-A #0412", "OLIVE GARDEN 1187", "SQ *LOCAL TACO", "PANERA BREAD #601"]), cat: "dining" });
  for (let d = startOffset + 4; d <= -2; d += between(12, 20)) add({ acct: card, offset: d, cents: -between(450, 900), desc: "SQ *COFFEE CART", cat: null });
  // One-offs.
  add({ acct: card, offset: -62, cents: -8943, desc: "TARGET 00012345", cat: "kids" });
  add({ acct: card, offset: -40, cents: -12000, desc: "YMCA YOUTH SPORTS", cat: "kids" });
  add({ acct: card, offset: -33, cents: -4599, desc: "SKY ZONE TRAMPOLINE", cat: "fun" });
  add({ acct: card, offset: -15, cents: -3299, desc: "OLD NAVY #4410", cat: "kids" });
  add({ acct: card, offset: -11, cents: 2499, desc: "AMAZON MKTPL*REFUND", cat: "shopping" });
  add({ acct: checking, offset: -6, cents: -2500, desc: "VENMO PAYMENT 1023", cat: null });
  add({ acct: card, offset: -10, cents: -4998, desc: "AMAZON MKTPL*9RB2K", cat: "shopping" });
  // Surprises: one each way.
  add({ acct: card, offset: -5, cents: -6400, desc: "ETSY.COM*HANDMADE", cat: "gifts", gift: { by: adminId, from: partnerId, revealIn: 70 } });
  add({ acct: card, offset: -3, cents: -18900, desc: "KAY JEWELERS #2209", cat: "gifts", gift: { by: partnerId, from: adminId, revealIn: 21 } });
  // Today's charges still pending.
  add({ acct: card, offset: 0, cents: -6812, desc: "PUBLIX #1234", cat: "groceries", pending: true });
  add({ acct: card, offset: 0, cents: -4410, desc: "SHELL OIL 57444", cat: "car", pending: true });

  // Grocery trips on the Publix charge nearest each trip.
  for (const t of trips) {
    const near = rows.filter((r) => r.desc.startsWith(t.storeName) && !r.purchaseId && r.offset >= t.offset && r.offset <= t.offset + 3);
    if (near[0]) near[0].purchaseId = t.id;
    else add({ acct: card, offset: t.offset, cents: -between(3000, 9000), desc: t.storeName === "COSTCO" ? "COSTCO WHSE #0123" : "PUBLIX #1234", cat: "groceries", purchaseId: t.id });
  }

  let n = 0;
  const created = new Map<string, string>();
  for (const r of rows.sort((a, b) => a.offset - b.offset)) {
    const externalId = `demo-${++n}`;
    const t = await prisma.finTransaction.create({
      data: {
        jarId: jar.id,
        accountId: r.acct.id,
        source: r.acct.source,
        externalId,
        postedOn: civil(r.offset),
        amountCents: r.cents,
        description: r.desc,
        pending: Boolean(r.pending),
        merchantKey: merchantKeyOf({ description: r.desc }) || "-",
        categoryId: r.cat ? cats.get(r.cat) : null,
        categorySource: r.cat ? "AUTO" : null,
        purchaseId: r.purchaseId ?? null,
        purchaseLinkedBy: r.purchaseId ? "AUTO" : null,
        giftById: r.gift?.by ?? null,
        giftHiddenFrom: r.gift ? [r.gift.from] : [],
        giftRevealOn: r.gift ? civil(r.gift.revealIn) : null,
        createdAt: at(r.offset, 7),
      },
    });
    created.set(r.desc + "@" + r.offset, t.id);
  }

  // Order emails: one on its Amazon charge, Apple's on its bill, and a 🎁 one still waiting for its charge.
  await prisma.mailOrder.create({
    data: {
      jarId: jar.id,
      personId: adminId,
      retailer: "AMAZON",
      orderNumber: "000-0000000-0000001",
      orderedOn: civil(-11),
      totalCents: 4998,
      label: "Kids' Clothing",
      items: [
        { name: "Rain boots, kids size 3", qty: 1, priceCents: 3499 },
        { name: "AA batteries (20 pack)", qty: 1, priceCents: 1499 },
      ],
      sourceHashes: ["demo-amz-1"],
      matchedTxnId: created.get("AMAZON MKTPL*9RB2K@-10"),
      matchedBy: "AUTO",
      matchedAt: at(-10, 8),
    },
  });
  const apple = rows.filter((r) => r.desc === "APPLE.COM/BILL").sort((a, b) => b.offset - a.offset)[0];
  await prisma.mailOrder.create({
    data: {
      jarId: jar.id,
      personId: partnerId,
      retailer: "APPLE",
      orderNumber: "MX7Q2DEMO",
      orderedOn: civil(apple.offset),
      totalCents: 299,
      label: "iCloud+",
      items: [{ name: "iCloud+ with 50 GB of storage (Monthly)", qty: 1, priceCents: 299 }],
      sourceHashes: ["demo-apple-1"],
      matchedTxnId: created.get(`APPLE.COM/BILL@${apple.offset}`),
      matchedBy: "AUTO",
      matchedAt: at(apple.offset, 9),
    },
  });
  await prisma.mailOrder.create({
    data: {
      jarId: jar.id,
      personId: adminId,
      retailer: "AMAZON",
      orderNumber: "000-0000000-0000002",
      orderedOn: civil(-1),
      totalCents: 3499,
      label: "Toys & Games",
      items: [{ name: "LEGO Classic Medium Creative Brick Box", qty: 1, priceCents: 3499 }],
      sourceHashes: ["demo-amz-2"],
      giftById: adminId,
      giftHiddenFrom: [partnerId],
      giftRevealOn: civil(45),
    },
  });

  // A little history, as the app would have written it.
  const ev = (actorId: string, kind: Prisma.JarEventCreateManyInput["kind"], data: Prisma.InputJsonValue, offset: number, txnId?: string) => ({ jarId: jar.id, actorId, kind, data, txnId: txnId ?? null, createdAt: at(offset, 20) });
  await prisma.jarEvent.createMany({
    data: [
      ev(adminId, "CONNECTED", { provider: "SIMPLEFIN" }, -180),
      ev(adminId, "MEMBER_ADDED", { name: partnerName }, -179),
      ev(adminId, "BUDGET_SET", { category: "Groceries", cents: 90000 }, -150),
      ev(partnerId, "BUDGET_SET", { category: "Dining", cents: 25000 }, -150),
      ev(adminId, "ROLLOVER_SET", { category: "Gifts", on: true }, -95),
      ev(adminId, "GOAL_SET", { category: "Gifts", cents: 60000, month: ym(2) }, -95),
      ev(adminId, "ACCOUNTS_SET", { count: 1 }, -40),
      ev(adminId, "CUSHION_SET", { cents: 50000 }, -40),
      ev(partnerId, "BILL_ANSWERED", { key: "spotify usa", label: "Spotify Usa", status: "KEEP" }, -20),
      ev(adminId, "ORDER_LINKED", { retailer: "Amazon" }, -10, created.get("AMAZON MKTPL*9RB2K@-10")),
    ],
  });
  await prisma.recurringMark.create({ data: { jarId: jar.id, key: "spotify usa", status: "KEEP", reviewedAt: at(-20, 20) } });

  // Bills added by hand (ones no card shows), and merchants the family filed themselves.
  await prisma.manualBill.createMany({
    data: [
      { jarId: jar.id, name: "Car registration", amountCents: 8500, cadence: "YEARLY", nextDue: civil(24), matchKey: "car registration", createdById: adminId },
      { jarId: jar.id, name: "Piano lessons", amountCents: 12000, cadence: "MONTHLY", nextDue: civil(4), matchKey: "piano lessons", createdById: partnerId },
      { jarId: jar.id, name: "Water softener salt", amountCents: 3200, cadence: "QUARTERLY", nextDue: civil(38), matchKey: "water softener salt", createdById: adminId },
    ],
  });
  await prisma.categoryRule.createMany({
    data: [
      { jarId: jar.id, key: "coffee cart", categoryId: cats.get("dining")! },
      { jarId: jar.id, key: "chipotle", categoryId: cats.get("dining")! },
    ],
  });
  console.log(`Money jar "Family": ${rows.length} transactions over 7 months.`);
}

// ---- Pets -----------------------------------------------------------------------------------

/** A fresh egg for one kid, ready to hatch; the other still gets to pick one. */
async function seedPets(householdId: string, kidAId: string, kidBId: string) {
  const kids = [kidAId, kidBId];
  await prisma.petItem.deleteMany({ where: { personId: { in: kids } } });
  await prisma.petDiscovery.deleteMany({ where: { personId: { in: kids } } });
  await prisma.petGift.deleteMany({ where: { personId: { in: kids } } });
  await prisma.petPlay.deleteMany({ where: { personId: { in: kids } } });
  await prisma.pet.deleteMany({ where: { personId: { in: kids } } });
  const bornAt = at(0, now.getHours(), Math.max(0, now.getMinutes() - 5));
  await prisma.pet.create({
    data: {
      householdId,
      personId: kidAId,
      name: "Sprout",
      seed: "demo-pet-1",
      state: newEgg("critter", epochMinute(bornAt.getTime())) as unknown as Prisma.InputJsonValue,
      bornAt,
      lastAdvancedAt: bornAt,
      shownStage: "egg",
      shownForm: 0,
      shownTricks: 0,
    },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
