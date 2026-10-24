import { describe, expect, it } from "vitest";
import type {
  CategoryRuleModel,
  FinAccountModel,
  FinBalanceDayModel,
  FinCategoryModel,
  FinHoldingModel,
  FinHoldingValueModel,
  FinTransactionModel,
  ManualBillModel,
  MoneyJarMemberModel,
  MoneyJarModel,
  PrivacyChargeModel,
  RecurringMarkModel,
} from "@/app/generated/prisma/models";
import { FORBIDDEN_BACKUP_KEYS, backupSchema } from "@/lib/backup/schema";
import { MoneySealError, moneySectionSchema, peopleDigest, planMoneyRestore, sealSection, unsealMoney, type MoneySection } from "./backup";
import type { MoneyRestoreContext } from "@/lib/backup/build";
import type { Backup } from "@/lib/backup/schema";

/**
 * Phase 28: the sealed money section. Same compile-time coverage check as
 * lib/backup/coverage.test.ts (a column added to a money model later fails tsc until it's
 * sealed or listed here), plus the seal itself.
 */
type Uncovered<Model, Exported, Allowed extends string> = Exclude<keyof Model, keyof Exported | Allowed>;
type Covered<Model, Exported, Allowed extends string = never> =
  Uncovered<Model, Exported, Allowed> extends never ? true : { uncoveredColumn: Uncovered<Model, Exported, Allowed> };
type Jar = MoneySection["jars"][number];
type Of<K extends keyof Jar> = Jar[K] extends (infer R)[] ? R : never;

const checks = {
  // Phase 30: the shared Teams chat is a setting, not money: pasted again after a restore.
  jar: true satisfies Covered<MoneyJarModel, Jar, "householdId" | "teamsChatId" | "teamsChatName" | "teamsChatError">,
  member: true satisfies Covered<MoneyJarMemberModel, Of<"members">, "jarId">,
  // Phase 52: a statement file's remembered columns are a setting, chosen again after a restore.
  account: true satisfies Covered<FinAccountModel, Of<"accounts">, "jarId" | "importLayouts">,
  category: true satisfies Covered<FinCategoryModel, Of<"categories">, "jarId">,
  rule: true satisfies Covered<CategoryRuleModel, Of<"rules">, "jarId">,
  recurring: true satisfies Covered<RecurringMarkModel, Of<"recurring">, "jarId">,
  // updatedAt is bookkeeping; jarId is implied by nesting.
  // Phase 52: which import brought a row is only for undoing it, which a restore doesn't carry.
  transaction: true satisfies Covered<FinTransactionModel, Of<"transactions">, "jarId" | "updatedAt" | "importId">,
  privacy: true satisfies Covered<PrivacyChargeModel, Of<"privacyCharges">, "jarId">,
  // Who added a bill isn't kept (people are remapped on restore and it only labels the row).
  manualBill: true satisfies Covered<ManualBillModel, Of<"manualBills">, "jarId" | "createdById" | "updatedAt">,
  // Phase 34: Net worth. Values and balance days sit at the jar level, pointing at their parents.
  balanceDay: true satisfies Covered<FinBalanceDayModel, Of<"balanceDays">>,
  holding: true satisfies Covered<FinHoldingModel, Of<"holdings">, "jarId">,
  holdingValue: true satisfies Covered<FinHoldingValueModel, Of<"holdingValues">>,
};

const section: MoneySection = {
  version: 3,
  peopleDigest: "0".repeat(64),
  jars: [
    {
      id: "j1",
      name: "Family",
      emoji: null,
      cushionCents: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      members: [{ personId: "p1", signInEmail: "p1@x.example", createdAt: "2026-10-01T00:00:00.000Z", alertBills: true, alertSync: true, alertOverBudget: false, alertLowBalance: true }],
      accounts: [],
      categories: [],
      rules: [{ id: "r1", key: "lego store", categoryId: "c1", createdAt: "2026-10-01T00:00:00.000Z" }],
      recurring: [],
      transactions: [],
      privacyCharges: [],
      manualBills: [],
      balanceDays: [],
      holdings: [],
      holdingValues: [],
    },
  ],
};

const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
};

describe("sealed money", () => {
  it("every money column is sealed or deliberately left out", () => {
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });

  it("round-trips, and nothing readable is left in the box", () => {
    const box = sealSection(section);
    expect(box).toMatchObject({ version: 1, cipher: "aes-256-gcm", encoding: "gzip+json", keyVersion: 1, jarCount: 1 });
    expect(JSON.stringify(box)).not.toMatch(/lego|Family/);
    expect(unsealMoney(box)).toEqual(section);
  });

  it("long bank text and odd currencies still seal and open (the schema only guards the way back in)", () => {
    const long: MoneySection = structuredClone(section);
    long.jars[0].accounts.push({
      id: "a1",
      source: "SIMPLEFIN",
      externalId: "x".repeat(200),
      name: "n",
      org: null,
      currency: "https://example.com/points".padEnd(64, "x"),
      balanceCents: 1,
      availableCents: null,
      balanceAt: null,
      spending: false,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(unsealMoney(sealSection(long)).jars[0].accounts[0].currency).toHaveLength(64);
  });

  it("a changed file or another server's key doesn't open", () => {
    const box = sealSection(section);
    const flipped = Buffer.from(box.sealed, "base64");
    flipped[0] ^= 1;
    expect(() => unsealMoney({ ...box, sealed: flipped.toString("base64") })).toThrow(MoneySealError);
    expect(() => unsealMoney({ ...box, tag: Buffer.alloc(16).toString("base64") })).toThrow(MoneySealError);
  });

  it("the household file stays free of forbidden keys with money inside, and v6 files still read", () => {
    const keys = keysOf({ sealedMoney: sealSection(section) });
    for (const k of FORBIDDEN_BACKUP_KEYS) expect(keys.has(k)).toBe(false);
    expect(keysOf(moneySectionSchema.parse(section)).has("encryptedValue")).toBe(false);
    expect(backupSchema.shape.schemaVersion.safeParse(6).success).toBe(true);
    expect(backupSchema.shape.sealedMoney.parse(undefined)).toBeNull();
  });
});

describe("Phase 28.5: planMoneyRestore", () => {
  type P = Backup["people"][number];
  const fp = (id: string, over: Partial<P> = {}): P => ({
    id,
    firstName: id,
    lastName: null,
    isHouseholdMember: true,
    role: "ADULT",
    email: `${id}@x.example`,
    phone: null,
    notes: null,
    notesAdultsOnly: false,
    contactCadenceDays: null,
    lastContactedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  // "auto" is an adult who never filled in a profile email (auto-provisioned at sign-in).
  const people = [fp("dad", { role: "ADMIN" }), fp("grandma"), fp("gone"), fp("kid", { role: "KID" }), fp("auto", { email: null })];
  const T = "2026-10-01T00:00:00.000Z";
  const txn = (id: string, over: Partial<MoneySection["jars"][number]["transactions"][number]> = {}) => ({
    id,
    accountId: "a1",
    source: "SIMPLEFIN" as const,
    externalId: id,
    postedOn: "2026-10-01",
    amountCents: -100,
    description: "X",
    payee: null,
    memo: null,
    pending: false,
    state: "ACTIVE" as const,
    duplicateOfId: null,
    merchantName: null,
    privacyCardMemo: null,
    merchantKey: "x",
    categoryId: null,
    categorySource: null,
    purchaseId: null,
    purchaseLinkedBy: null,
    giftById: null,
    giftHiddenFrom: [] as string[],
    giftRevealOn: null,
    giftCopiedFromId: null,
    createdAt: T,
    ...over,
  });
  const member = (personId: string, signInEmail: string | null = `${personId}@x.example`) => ({ personId, signInEmail, createdAt: T, alertBills: true, alertSync: true, alertOverBudget: false, alertLowBalance: true });
  const account = { id: "a1", source: "SIMPLEFIN" as const, externalId: "acct", name: "Checking", org: null, currency: "USD", balanceCents: 0, availableCents: null, balanceAt: null, spending: false, createdAt: T };
  const sec = (): MoneySection => ({
    version: 3,
    peopleDigest: peopleDigest(people),
    jars: [
      {
        id: "family",
        name: "Family",
        emoji: null,
        cushionCents: 25000,
        createdAt: T,
        members: [member("dad"), member("grandma"), member("gone"), member("kid"), member("stranger"), member("auto", "auto@sign.example")],
        accounts: [account],
        categories: [],
        rules: [],
        recurring: [],
        // ofx is a duplicate of t3, listed first: t3 must be inserted first.
        transactions: [
          txn("t1", { giftById: "dad", giftHiddenFrom: ["grandma", "stranger"], giftRevealOn: "2026-12-25", purchaseId: "trip1", purchaseLinkedBy: "AUTO" }),
          txn("t2", { state: "DUPLICATE", duplicateOfId: "t3", source: "MANUAL", externalId: "ofx" }),
          txn("t3", { giftById: "dad", giftHiddenFrom: ["auto"], giftRevealOn: "2026-12-25", purchaseId: "gone-trip", purchaseLinkedBy: "PERSON" }),
          txn("t4", { giftById: "dad", giftHiddenFrom: ["gone"], giftRevealOn: "2026-12-25" }),
        ],
        privacyCharges: [],
        manualBills: [],
        balanceDays: [{ accountId: "a1", day: "2026-09-30", balanceCents: 1234 }],
        holdings: [{ id: "house", name: "House", kind: "HOME", createdAt: T }],
        holdingValues: [
          { holdingId: "house", valuedOn: "2019-06-01", valueCents: 30_000_000, createdAt: T },
          { holdingId: "house", valuedOn: "2026-10-01", valueCents: 45_000_000, createdAt: T },
        ],
      },
      {
        id: "kids",
        name: "Kids",
        emoji: null,
        cushionCents: null,
        createdAt: T,
        members: [member("kid")],
        accounts: [],
        categories: [],
        rules: [],
        recurring: [],
        transactions: [],
        privacyCharges: [],
        manualBills: [],
        balanceDays: [],
        holdings: [],
        holdingValues: [],
      },
    ],
  });
  // Signed in here: Dad, Gone (left the household) and Auto. Grandma hasn't signed in here yet.
  const ctx = (): MoneyRestoreContext => ({
    filePeople: people,
    people: new Map(people.map((p) => [p.id, ["dad", "gone"].includes(p.id) ? `live-${p.id}` : `new-${p.id}`])),
    purchases: new Map([["trip1", "new-trip1"]]),
    matched: new Map([
      ["dad", { isHouseholdMember: true, role: "ADMIN" }],
      ["gone", { isHouseholdMember: false, role: null }],
    ]),
    linked: [
      { id: "live-dad", authEmail: "DAD@x.example", isHouseholdMember: true, role: "ADMIN" },
      { id: "live-gone", authEmail: "gone@x.example", isHouseholdMember: false, role: null },
      { id: "live-auto", authEmail: "auto@sign.example", isHouseholdMember: true, role: "ADULT" },
    ],
  });
  let n = 0;
  const plan = (c = ctx()) => {
    const r = planMoneyRestore(sec(), c, { householdId: "h", newId: () => `id${++n}` });
    if (!r.ok) throw new Error(r.errors.join());
    return r;
  };

  it("members are who they sign in as: signed in here, waiting for a first sign-in, or dropped", () => {
    const r = plan();
    expect(r.counts).toEqual({ jars: 1, jarsSkipped: 1, membersKept: 3, membersWaiting: 1, membersDropped: 4 });
    // Auto has no profile email but signs in as auto@sign.example: found by that, not lost.
    expect(r.rows.members.map((m) => m.personId).sort()).toEqual(["live-auto", "live-dad", "new-grandma"]);
  });

  it("Phase 32: the cushion, spending accounts and the low-balance switch come back", () => {
    const s = sec();
    s.jars[0].accounts[0].spending = true;
    s.jars[0].members[0].alertLowBalance = false;
    const r = planMoneyRestore(s, ctx(), { householdId: "h", newId: () => `id${++n}` });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.rows.jars[0].cushionCents).toBe(25000);
    expect(r.rows.accounts[0]).toMatchObject({ name: "Checking", spending: true });
    expect(r.rows.members.find((m) => m.personId === "live-dad")?.alertLowBalance).toBe(false);
  });

  it("Phase 34: balance days and things valued by hand come back, pointing at the new ids", () => {
    const r = plan();
    const [account] = r.rows.accounts as { id: string }[];
    const [house] = r.rows.holdings as { id: string; jarId: string; name: string; kind: string }[];
    expect(r.rows.balanceDays).toEqual([{ accountId: account.id, day: new Date("2026-09-30T00:00:00Z"), balanceCents: 1234 }]);
    expect(house).toMatchObject({ name: "House", kind: "HOME", jarId: r.rows.jars[0].id });
    expect(house.id).not.toBe("house");
    expect(r.rows.holdingValues).toEqual([
      { holdingId: house.id, valuedOn: new Date("2019-06-01T00:00:00Z"), valueCents: 30_000_000, createdAt: new Date(T) },
      { holdingId: house.id, valuedOn: new Date("2026-10-01T00:00:00Z"), valueCents: 45_000_000, createdAt: new Date(T) },
    ]);
  });

  it("Phase 34: a backup from before Net worth still reads, with none", () => {
    const old = structuredClone(sec()) as unknown as { jars: Record<string, unknown>[] };
    for (const j of old.jars) for (const k of ["balanceDays", "holdings", "holdingValues"]) delete j[k];
    const parsed = moneySectionSchema.parse(old);
    expect(parsed.jars[0]).toMatchObject({ balanceDays: [], holdings: [], holdingValues: [] });
  });

  it("Phase 34: refuses a balance day or value pointing nowhere, or two values on one day", () => {
    const stray = sec();
    stray.jars[0].balanceDays[0].accountId = "nope";
    expect(planMoneyRestore(stray, ctx(), { householdId: "h" }).ok).toBe(false);
    const orphan = sec();
    orphan.jars[0].holdingValues[0].holdingId = "nope";
    expect(planMoneyRestore(orphan, ctx(), { householdId: "h" }).ok).toBe(false);
    const twice = sec();
    twice.jars[0].holdingValues[1].valuedOn = "2019-06-01";
    expect(planMoneyRestore(twice, ctx(), { householdId: "h" }).ok).toBe(false);
    const valueless = sec();
    valueless.jars[0].holdingValues = [];
    expect(planMoneyRestore(valueless, ctx(), { householdId: "h" }).ok).toBe(false);
  });

  it("a profile email changed to grandma's doesn't inherit her jar", () => {
    // Dad edited his live profile email to grandma's, so the people plan matched file-grandma to him.
    const c = ctx();
    c.matched.set("grandma", { isHouseholdMember: true, role: "ADMIN" });
    c.people.set("grandma", "live-dad");
    const r = plan(c);
    expect(r.rows.members.filter((m) => m.personId === "live-dad")).toHaveLength(1);
    expect(r.counts.membersWaiting).toBe(0);
  });

  it("on a rebuilt server, a member with no profile email gets their sign-in address so they can be adopted", () => {
    const c = ctx();
    c.linked = [{ id: "live-dad", authEmail: "dad@x.example", isHouseholdMember: true, role: "ADMIN" }];
    const r = plan(c);
    expect(r.rows.emailFixes).toEqual([{ personId: "new-auto", email: "auto@sign.example" }]);
    expect(r.counts.membersWaiting).toBe(2);
  });

  it("re-points surprises (dropping people who aren't members), trips and duplicates", () => {
    const r = plan();
    const all = r.rows.transactionPasses.flat() as { externalId: string; giftById: string | null; giftHiddenFrom: string[]; giftRevealOn: Date | null; purchaseId: string | null; purchaseLinkedBy: string | null; duplicateOfId: string | null; id: string }[];
    const by = (e: string) => all.find((t) => t.externalId === e)!;
    expect(by("t1")).toMatchObject({ giftById: "live-dad", giftHiddenFrom: ["new-grandma"], purchaseId: "new-trip1" });
    expect(by("t3")).toMatchObject({ giftHiddenFrom: ["live-auto"], purchaseId: null, purchaseLinkedBy: "PERSON" });
    // Hidden only from someone no longer a member: hidden from nobody, so the mark goes.
    expect(by("t4")).toMatchObject({ giftById: null, giftHiddenFrom: [], giftRevealOn: null });
    const passOf = (e: string) => r.rows.transactionPasses.findIndex((p) => (p as { externalId: string }[]).some((t) => t.externalId === e));
    expect(passOf("t3")).toBeLessThan(passOf("ofx"));
    expect(by("ofx").duplicateOfId).toBe(by("t3").id);
  });

  it("refuses an edited people list, broken references, and boxes from before 28.5", () => {
    const edited = ctx();
    edited.filePeople = people.map((p) => (p.id === "grandma" ? { ...p, email: "dad@x.example" } : p));
    expect(planMoneyRestore(sec(), edited, { householdId: "h" }).ok).toBe(false);
    const broken = sec();
    broken.jars[0].transactions[0].accountId = "nope";
    expect(planMoneyRestore(broken, ctx(), { householdId: "h" }).ok).toBe(false);
    const old = sealSection({ ...sec(), version: 2 } as unknown as MoneySection);
    expect(() => unsealMoney(old)).toThrow(/Make a fresh backup/);
  });
});
