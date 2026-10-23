import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { getHouseholdRow, serverTimeZone } from "@/lib/household-settings";
import { epochMinute, isCareMinute, MINUTE_MS, type CareHours } from "./care-hours";
import { play, type CareResult } from "./care";
import { effectOf, PAYOUT_MINUTES, type GameId } from "./games/catalog";
import { giftHint, isTreat, openTreat, pickGift, TREAT_NAMES, withinDailyCap } from "./gifts";
import { fitsPlace, ITEMS, itemDef, unlockedItems, type Place } from "./items";
import { personalityFromSeed, type Personality } from "./personality";
import { advance, type AdvanceContext, type PetEvent } from "./sim";
import { isAlive, newEgg, STAGES, type PetState, type Species, type Stage } from "./state";
import { unlockedTricks, type TrickId } from "./tricks";
import { readCareHours, readPetState } from "./stored";

/**
 * Phase 47: the pet's database side. Every read catches the pet up to now and saves it, so
 * the screen always shows the pet as it is, and a pet that's gone is moved to the memory book
 * in the same transaction. Every write goes through `changeMyPet`: catch up, apply the care,
 * save only if nobody else saved in between (two tabs can't both feed it).
 *
 * Everything is keyed by the signed-in profile's own id: there's no way to name someone
 * else's pet. Nothing here touches points, stickers or the Store.
 */

type Tx = Prisma.TransactionClient;
type Profile = { id: string; householdId: string };

export type PetRecord = {
  id: string;
  name: string;
  seed: string;
  state: PetState;
  personality: Personality;
  awake: boolean;
  minute: number;
  /** What the kid has already seen (Phase 54): null on a pet from before then. */
  shown: { stage: string | null; form: number | null; tricks: number | null };
};

/** Phase 54: the growing-up reveal waiting to be seen (from null: a hatching). */
export type Reveal = { from: { stage: Stage; form: number } | null; to: { stage: Stage; form: number } } | null;

export type PetItemRecord = { id: string; itemId: string; place: Place };

export type Goodbye = { name: string; species: string; stage: string; form: number; cause: string; ageMinutes: number };

type CareSettings = { careHours: CareHours; timeZone: string };

/**
 * The household's care hours and time zone, from the row the layout already read this request
 * (React `cache`). Read before a transaction starts, never inside one: a read through the shared
 * client mid-transaction would need a second pool connection while the first is held.
 */
export async function getCareHours(householdId: string): Promise<CareSettings> {
  const row = await getHouseholdRow(householdId);
  return { careHours: readCareHours(row?.petCareHours), timeZone: row?.timezone ?? serverTimeZone() };
}

function toJson(state: PetState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

/**
 * Hands out what growing up and bond have earned. One write, no read: items are one of each
 * (unique person and item), so what's already owned is skipped by the database.
 */
async function grantUnlocks(tx: Tx, profile: Profile, state: PetState): Promise<void> {
  const earned = unlockedItems(state.stage, state.bond);
  if (earned.length === 0) return;
  await tx.petItem.createMany({
    data: earned.map((itemId) => ({ householdId: profile.householdId, personId: profile.id, itemId })),
    skipDuplicates: true,
  });
}

/** How many chores one look reads at most, and how far before the last look it starts. */
const GIFT_SCAN_LIMIT = 100;
const GIFT_LOOKBACK_MS = 10 * MINUTE_MS;

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** A date's day in a time zone, as "2026-10-23". */
function dayIn(date: Date, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(timeZone, format);
  }
  return format.format(date);
}

/**
 * Phase 47.4, the secret: finds this person's chores finished since the pet hatched that
 * haven't been looked at yet, and leaves a present for each, up to the day's cap. The person
 * a chore counts for is the same as for stickers: whoever it was assigned to, or whoever did
 * an "Anyone" chore. Each chore is looked at once (unique instanceId), present or not, so
 * undoing and redoing it brings nothing more, and undoing it takes nothing back.
 */
async function findNewChores(
  tx: Tx,
  profile: Profile,
  pet: { bornAt: Date; giftsCheckedAt: Date | null },
  now: Date,
): Promise<{ chores: { id: string; completedAt: Date | null }[]; checkedThrough: Date }> {
  // Only chores finished since the last look (a little before it, for a chore whose save was
  // still finishing then; `petGift: null` keeps those from counting twice), never before birth.
  const since = pet.giftsCheckedAt ? new Date(Math.max(pet.bornAt.getTime(), pet.giftsCheckedAt.getTime() - GIFT_LOOKBACK_MS)) : pet.bornAt;
  const chores = await tx.taskInstance.findMany({
    where: {
      status: "DONE",
      completedAt: { gte: since },
      petGift: { is: null },
      definition: { householdId: profile.householdId, domain: "CHORE" },
      OR: [{ assignedToId: profile.id }, { assignedToId: null, completedById: profile.id }],
    },
    select: { id: true, completedAt: true },
    orderBy: { completedAt: "asc" },
    take: GIFT_SCAN_LIMIT,
  });
  // A full batch may have more behind it: checked only as far as the last one read.
  const checkedThrough = chores.length === GIFT_SCAN_LIMIT ? (chores.at(-1)?.completedAt ?? now) : now;
  return { chores, checkedThrough };
}

/** A present (or, past the day's cap, a note that it was looked at) for each chore found. */
async function leaveGifts(tx: Tx, profile: Profile, seed: string, chores: { id: string; completedAt: Date | null }[], timeZone: string) {
  if (chores.length === 0) return;
  const withDays = chores.map((chore) => ({ id: chore.id, day: dayIn(chore.completedAt ?? new Date(), timeZone) }));
  const days = [...new Set(withDays.map((chore) => chore.day))];
  const [earlier, owned] = await Promise.all([
    tx.petGift.groupBy({ by: ["day"], where: { personId: profile.id, day: { in: days }, itemId: { not: null } }, _count: true }),
    tx.petItem.findMany({ where: { personId: profile.id }, select: { itemId: true } }),
  ]);
  const lucky = withinDailyCap(withDays, new Map(earlier.map((row) => [row.day, row._count])));
  const have = owned.map((item) => item.itemId);
  await tx.petGift.createMany({
    data: withDays.map((chore) => {
      const itemId = lucky.has(chore) ? pickGift(seed, chore.id, have) : null;
      if (itemId && !isTreat(itemId)) have.push(itemId);
      return { householdId: profile.householdId, personId: profile.id, instanceId: chore.id, day: chore.day, itemId };
    }),
    skipDuplicates: true,
  });
}

/** Thrown inside a transaction to roll it back and still answer with `result`. */
class Undo<T> extends Error {
  constructor(readonly result: T) {
    super("undo");
  }
}

/** Runs `work` in a transaction; an `Undo` rolls everything back and returns its result. */
async function undoUnless<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    if (error instanceof Undo) return error.result as T;
    throw error;
  }
}

type CatchUp =
  | { kind: "none" }
  | { kind: "gone"; goodbye: Goodbye }
  | { kind: "pet"; pet: PetRecord; events: PetEvent[]; saved: boolean; lastAdvancedAt: Date };

/**
 * Reads this person's pet and plays it forward to `now`. A pet that's gone is written to the
 * memory book and removed; otherwise the caught-up state is saved under the `lastAdvancedAt`
 * guard (`saved` is false if another request got there first; the caller decides).
 */
async function catchUp(tx: Tx, profile: Profile, settings: CareSettings, now: Date, persist: boolean): Promise<CatchUp> {
  const row = await tx.pet.findUnique({ where: { personId: profile.id } });
  if (!row) return { kind: "none" };
  const stored = readPetState(row.state);
  if (!stored) throw new Error("A pet's saved state couldn't be read.");

  const context: AdvanceContext = { seed: row.seed, ...settings };
  const { state, events } = advance(stored, row.lastAdvancedAt.getTime(), now.getTime(), context);
  const personality = personalityFromSeed(row.seed);
  // Before the alive-or-gone split, so a pet that grows and then goes in one catch-up still
  // counts in the book. Only when it grew, a reveal is still waiting, or the pet is from before
  // the book, so a plain view writes nothing here.
  const unseen = row.shownStage !== state.stage || row.shownForm !== state.form;
  if (unseen || events.some(isGrowth)) await recordDiscoveries(tx, profile, state, events);

  if (!isAlive(state)) {
    const goneMinute = events.findLast((event) => event.kind === "gone")?.minute ?? epochMinute(now.getTime());
    const goodbye: Goodbye = {
      name: row.name,
      species: state.species,
      stage: state.stage,
      form: state.form,
      cause: state.cause ?? "old-age",
      ageMinutes: state.ageMinutes,
    };
    const { count } = await tx.pet.deleteMany({ where: { id: row.id, lastAdvancedAt: row.lastAdvancedAt } });
    if (count === 1) {
      await tx.petMemorial.create({
        data: {
          householdId: profile.householdId,
          personId: profile.id,
          ...goodbye,
          favoriteToy: personality.favoriteToy,
          bornAt: row.bornAt,
          goneAt: new Date(goneMinute * MINUTE_MS),
        },
      });
    }
    return { kind: "gone", goodbye };
  }

  let saved = false;
  if (persist) {
    // Look for new chores first, so the save that claims this catch-up also moves the bookmark.
    const { chores, checkedThrough } = await findNewChores(tx, profile, row, now);
    // Same minute and nothing new: catching up changed nothing, so there's nothing to save. (A
    // refresh, or the page re-render right after an action, would otherwise write every time.)
    const idle = chores.length === 0 && epochMinute(now.getTime()) === epochMinute(row.lastAdvancedAt.getTime());
    const { count } = idle ? { count: 0 } : await tx.pet.updateMany({
      where: { id: row.id, lastAdvancedAt: row.lastAdvancedAt },
      data: { state: toJson(state), lastAdvancedAt: now, giftsCheckedAt: checkedThrough },
    });
    saved = count === 1;
    if (saved) {
      await grantUnlocks(tx, profile, state);
      await leaveGifts(tx, profile, row.seed, chores, context.timeZone);
    }
  }

  const minute = epochMinute(now.getTime());
  return {
    kind: "pet",
    events,
    saved,
    lastAdvancedAt: saved ? now : row.lastAdvancedAt,
    pet: {
      id: row.id,
      name: row.name,
      seed: row.seed,
      state,
      personality,
      awake: state.stage === "egg" || isCareMinute(minute, context.careHours, context.timeZone),
      minute,
      shown: { stage: row.shownStage, form: row.shownForm, tricks: row.shownTricks },
    },
  };
}

function isGrowth(event: PetEvent): boolean {
  return event.kind === "hatched" || event.kind === "grew";
}

/**
 * Phase 54: every form this pet has reached, into the collection book: the ones it grew into
 * along the way and the one it's in now (never the egg). Writing a form again changes nothing,
 * so this needs no guard and can run on any path, saved or not.
 */
async function recordDiscoveries(tx: Tx, profile: Profile, state: PetState, events: PetEvent[]) {
  const forms = [...events.filter(isGrowth).map(({ stage, form }) => ({ stage, form })), { stage: state.stage, form: state.form }].filter(
    (found): found is { stage: Stage; form: number } => found.stage !== undefined && found.stage !== "egg" && found.form !== undefined,
  );
  if (forms.length === 0) return;
  await tx.petDiscovery.createMany({
    data: forms.map(({ stage, form }) => ({ householdId: profile.householdId, personId: profile.id, species: state.species, stage, form })),
    skipDuplicates: true,
  });
}

export type MyPet = {
  pet: PetRecord | null;
  goodbye: Goodbye | null;
  items: PetItemRecord[];
  /** Presents waiting by the door. */
  presents: string[];
  /** Phase 54: the tricks it knows, the ones learned since last seen, and the growth reveal. */
  tricks: TrickId[];
  newTricks: TrickId[];
  reveal: Reveal;
};

/** This person's pet as it is right now, their items, and a goodbye if it just went. */
export async function getMyPet(profile: Profile, now = new Date()): Promise<MyPet> {
  const settings = await getCareHours(profile.householdId);
  const result = await prisma.$transaction((tx) => catchUp(tx, profile, settings, now, true));
  const [items, presents] = await Promise.all([
    getMyItems(profile.id),
    result.kind === "pet"
      ? prisma.petGift.findMany({ where: { personId: profile.id, openedAt: null, itemId: { not: null } }, orderBy: { grantedAt: "asc" }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const ids = presents.map((present) => present.id);
  if (result.kind === "pet") return { pet: result.pet, goodbye: null, items, presents: ids, ...(await whatsNew(profile, result.pet)) };
  // The goodbye stays up until a new egg is picked, not just for the one view that found it gone.
  const goodbye = result.kind === "gone" ? result.goodbye : await lastGoodbye(profile.id);
  return { pet: null, goodbye, items, presents: [], tricks: [], newTricks: [], reveal: null };
}

/**
 * Phase 54: the tricks it knows, and what the kid hasn't seen yet: a new form, new tricks. A
 * pet from before then (nothing shown yet) gets its bookmark set now, with no reveal.
 */
async function whatsNew(profile: Profile, pet: PetRecord): Promise<Pick<MyPet, "tricks" | "newTricks" | "reveal">> {
  const { state, shown } = pet;
  const tricks = unlockedTricks(state.bond);
  if (shown.stage === null || shown.form === null || shown.tricks === null) {
    await markSeen(profile);
    return { tricks, newTricks: [], reveal: null };
  }
  const grew = state.stage !== "egg" && (shown.stage !== state.stage || shown.form !== state.form);
  const from = shown.stage === "egg" || !(STAGES as readonly string[]).includes(shown.stage) ? null : { stage: shown.stage as Stage, form: shown.form };
  return {
    tricks,
    newTricks: tricks.slice(shown.tricks),
    reveal: grew ? { from, to: { stage: state.stage, form: state.form } } : null,
  };
}

/**
 * Marks the pet's current form and tricks as seen. Its own plain update, read from the saved
 * pet on the server (never what the browser says), with no `lastAdvancedAt` guard: it works
 * while the pet is asleep, and can't race a care action or the minute refresh.
 */
export async function markSeen(profile: Profile): Promise<boolean> {
  const row = await prisma.pet.findUnique({ where: { personId: profile.id }, select: { state: true } });
  const state = row && readPetState(row.state);
  if (!state) return false;
  const { count } = await prisma.pet.updateMany({
    where: { personId: profile.id },
    data: { shownStage: state.stage, shownForm: state.form, shownTricks: unlockedTricks(state.bond).length },
  });
  return count === 1;
}

/**
 * The collection book: every form this person's pets have reached. Pets that went before the
 * book existed are filled in from the memory book (which kept their final form) first.
 */
export async function getMyDiscoveries(profile: Profile) {
  const memories = await prisma.petMemorial.findMany({ where: { personId: profile.id }, select: { species: true, stage: true, form: true } });
  const known = memories.filter((memory) => (STAGES as readonly string[]).includes(memory.stage) && memory.stage !== "egg");
  if (known.length > 0) {
    await prisma.petDiscovery.createMany({
      data: known.map((memory) => ({ householdId: profile.householdId, personId: profile.id, ...memory })),
      skipDuplicates: true,
    });
  }
  return prisma.petDiscovery.findMany({ where: { personId: profile.id }, select: { species: true, stage: true, form: true } });
}

async function lastGoodbye(personId: string): Promise<Goodbye | null> {
  return prisma.petMemorial.findFirst({
    where: { personId },
    orderBy: { goneAt: "desc" },
    select: { name: true, species: true, stage: true, form: true, cause: true, ageMinutes: true },
  });
}

/** One of this person's items by its row id, or null if it isn't theirs. */
export async function getMyItem(personId: string, itemRowId: string): Promise<PetItemRecord | null> {
  const row = await prisma.petItem.findFirst({ where: { id: itemRowId, personId }, select: { id: true, itemId: true, place: true } });
  return row && itemDef(row.itemId) ? { ...row, place: row.place as Place } : null;
}

export async function getMyItems(personId: string): Promise<PetItemRecord[]> {
  const rows = await prisma.petItem.findMany({
    where: { personId },
    orderBy: { createdAt: "asc" },
    select: { id: true, itemId: true, place: true },
  });
  return rows.filter((row) => itemDef(row.itemId)).map((row) => ({ ...row, place: row.place as Place }));
}

export type ChangeResult =
  | { ok: true; result: CareResult; events: PetEvent[] }
  | { ok: false; reason: "no-pet" | "gone" | "asleep" | "busy" };

/** Catches the pet up, applies one kind of care and saves it, all or nothing. */
export async function changeMyPet(
  profile: Profile,
  apply: (state: PetState, minute: number, personality: Personality) => CareResult,
  now = new Date(),
): Promise<ChangeResult> {
  const settings = await getCareHours(profile.householdId);
  return prisma.$transaction((tx) => changeInTx(tx, profile, settings, apply, now));
}

/**
 * A finished mini-game round. It pays out (`effectOf`, capped whatever the score) once per
 * game per hour; a round inside the hour is just for fun and changes nothing. The payout
 * record and the pet are saved together.
 */
export async function finishMyGame(
  profile: Profile,
  game: GameId,
  score: number,
  now = new Date(),
): Promise<ChangeResult | { ok: false; reason: "played-recently" }> {
  const settings = await getCareHours(profile.householdId);
  return undoUnless(async (tx) => {
    // Claim this hour's payout first: the insert or the conditional update takes the row's lock,
    // so a second round finishing at the same moment waits, then finds it claimed.
    const fresh = await tx.petPlay.createMany({ data: [{ personId: profile.id, game, paidAt: now }], skipDuplicates: true });
    if (fresh.count === 0) {
      const due = new Date(now.getTime() - PAYOUT_MINUTES * MINUTE_MS);
      const claimed = await tx.petPlay.updateMany({ where: { personId: profile.id, game, paidAt: { lte: due } }, data: { paidAt: now } });
      if (claimed.count === 0) return { ok: false, reason: "played-recently" } as const;
    }
    const change = await changeInTx(tx, profile, settings, (state) => play(state, effectOf(game, score)), now);
    // A round that changed nothing (asleep, too tired) doesn't use up the hour.
    if (!change.ok || change.result.outcome !== "ok") throw new Undo(change);
    return change;
  });
}

async function changeInTx(
  tx: Tx,
  profile: Profile,
  settings: CareSettings,
  apply: (state: PetState, minute: number, personality: Personality) => CareResult,
  now: Date,
): Promise<ChangeResult> {
  const caught = await catchUp(tx, profile, settings, now, false);
  if (caught.kind === "none") return { ok: false, reason: "no-pet" };
  if (caught.kind === "gone") return { ok: false, reason: "gone" };
  const { pet, events, lastAdvancedAt } = caught;
  if (!pet.awake) return { ok: false, reason: "asleep" };

  const result = apply(pet.state, pet.minute, pet.personality);
  const { count } = await tx.pet.updateMany({
    where: { id: pet.id, lastAdvancedAt },
    data: { state: toJson(result.state), lastAdvancedAt: now },
  });
  if (count === 0) return { ok: false, reason: "busy" };
  // Only when this care earned something new (a page view also checks, every time).
  if (unlockedItems(result.state.stage, result.state.bond).length > unlockedItems(pet.state.stage, pet.state.bond).length) {
    await grantUnlocks(tx, profile, result.state);
  }
  return { ok: true, result, events };
}

export type OpenedPresent = { ok: true; hint: string; gift: string } | { ok: false; reason: "no-present" | "no-pet" | "gone" | "asleep" | "busy" };

/** Unwraps one of this person's presents: a treat goes to the pet, a keepsake to the toy box. */
export async function openMyPresent(profile: Profile, presentId: string, now = new Date()): Promise<OpenedPresent> {
  const settings = await getCareHours(profile.householdId);
  return undoUnless(async (tx) => {
    const present = await tx.petGift.findFirst({ where: { id: presentId, personId: profile.id, openedAt: null, itemId: { not: null } } });
    if (!present?.itemId) return { ok: false, reason: "no-present" } as const;
    // Claim it before giving anything: two taps at once can't open it twice.
    const claimed = await tx.petGift.updateMany({ where: { id: present.id, openedAt: null }, data: { openedAt: now } });
    if (claimed.count === 0) return { ok: false, reason: "no-present" } as const;

    const owned = await tx.petItem.findFirst({ where: { personId: profile.id, itemId: present.itemId } });
    // A keepsake already owned (a second pet, say) becomes a feast instead.
    const treat = isTreat(present.itemId) ? present.itemId : owned ? "feast" : null;
    if (treat) {
      const change = await changeInTx(tx, profile, settings, (state) => ({ state: openTreat(state, treat), outcome: "ok" }), now);
      // Asleep or busy: put the present back by the door for later.
      if (!change.ok) throw new Undo({ ok: false, reason: change.reason } as const);
    } else {
      await tx.petItem.createMany({
        data: [{ householdId: profile.householdId, personId: profile.id, itemId: present.itemId }],
        skipDuplicates: true,
      });
    }
    const openedBefore = await tx.petGift.count({ where: { personId: profile.id, openedAt: { not: null }, NOT: { id: present.id } } });
    return {
      ok: true,
      hint: giftHint(openedBefore, present.id),
      gift: treat ? TREAT_NAMES[treat] : (ITEMS.find((item) => item.id === present.itemId)?.name ?? "something nice"),
    } as const;
  });
}

/** A new egg for someone without a pet. False if they already have one. */
export async function hatchEgg(profile: Profile, species: Species, name: string, now = new Date()): Promise<boolean> {
  try {
    await prisma.pet.create({
      data: {
        householdId: profile.householdId,
        personId: profile.id,
        name,
        seed: randomUUID(),
        state: toJson(newEgg(species, epochMinute(now.getTime()))),
        bornAt: now,
        lastAdvancedAt: now,
        // Seen as an egg: hatching is the first reveal.
        shownStage: "egg",
        shownForm: 0,
        shownTricks: 0,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/**
 * Moves one of this person's items. Whatever was in that slot (or worn) goes back to the toy
 * box, so a slot holds one thing and the pet wears one hat. False if they don't own it or it
 * doesn't fit there.
 */
export async function placeMyItem(profile: Profile, itemRowId: string, place: Place): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.petItem.findFirst({ where: { id: itemRowId, personId: profile.id } });
    if (!item || !fitsPlace(item.itemId, place)) return false;
    if (place !== null && place !== "out") {
      await tx.petItem.updateMany({ where: { personId: profile.id, place, NOT: { id: item.id } }, data: { place: null } });
    }
    await tx.petItem.update({ where: { id: item.id }, data: { place } });
    return true;
  });
}

export async function renameMyPet(profile: Profile, name: string): Promise<boolean> {
  const { count } = await prisma.pet.updateMany({ where: { personId: profile.id }, data: { name } });
  return count === 1;
}

/** The memory book, newest first. Capped so a very long book can't make a very slow page. */
const MEMORIES_SHOWN = 200;

export async function getMyMemories(personId: string) {
  return prisma.petMemorial.findMany({
    where: { personId },
    orderBy: { goneAt: "desc" },
    take: MEMORIES_SHOWN,
    select: { id: true, name: true, species: true, stage: true, form: true, cause: true, ageMinutes: true, favoriteToy: true, goneAt: true },
  });
}
