import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Phase 52 against a real database (`npm run test:db`): a CSV checked then imported, its columns
 * remembered for the account, re-importing it adds nothing, a wrong choice undone with Remove this
 * import, and a row another import already brought folded in. Made-up statements only.
 */
const RUN = import.meta.env.MODE === "db";
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const bytes = (text: string) => new TextEncoder().encode(text);
// A card file: charges positive, a payment negative, a posting date and a transaction date.
const CARD = [
  "Trans. Date,Post Date,Description,Amount,Category",
  "10/01/2026,10/02/2026,Corner Grocery,45.20,Groceries",
  "10/02/2026,10/03/2026,Bakery Example,6.50,Dining",
  "10/03/2026,10/04/2026,Bookstore Example,18.00,Shopping",
  "10/04/2026,10/05/2026,Gas Station Example,30.00,Transport",
  "10/05/2026,10/06/2026,Pizza Place Example,22.40,Dining",
  "10/07/2026,10/08/2026,Payment Thank You,-100.00,Payment",
].join("\n");

describe.skipIf(!RUN)("statement imports (database)", { timeout: 60_000 }, () => {
  const ids = { h: "", dad: "", jar: "", account: "" };

  beforeAll(async () => {
    const h = await prisma.household.create({ data: { name: `e2e-statements-${Date.now()}`, timezone: "America/Chicago" } });
    const dad = await prisma.person.create({ data: { householdId: h.id, firstName: "Dad", role: "ADMIN", isHouseholdMember: true } });
    const jar = await prisma.moneyJar.create({ data: { householdId: h.id, name: "Family", members: { create: [{ personId: dad.id }] } } });
    const account = await prisma.finAccount.create({ data: { jarId: jar.id, source: "MANUAL", externalId: `card-${h.id}`, name: "Card" } });
    Object.assign(ids, { h: h.id, dad: dad.id, jar: jar.id, account: account.id });
  });
  afterAll(async () => {
    await prisma.household.deleteMany({ where: { id: ids.h } });
  });

  const amounts = () =>
    prisma.finTransaction.findMany({ where: { accountId: ids.account, state: "ACTIVE" }, orderBy: [{ postedOn: "asc" }, { amountCents: "asc" }], select: { amountCents: true, description: true } });

  test("a card file is checked, imported the way the person confirmed, and remembered", async () => {
    const { checkStatement, importStatementFile } = await import("./statement-import");
    const check = await checkStatement(ids.h, ids.account, bytes(CARD));
    expect(check.kind).toBe("csv");
    if (check.kind !== "csv") return;
    expect(check.suggestFlip).toBe(true);
    expect(check.columns[check.choices.date]).toBe("Post Date");
    expect(check.preview[0]).toEqual({ day: "2026-10-02", description: "Corner Grocery", amount: "$45.20", direction: "in" });

    // The person ticks "money out shows as positive".
    const choices = { ...check.choices, flip: true };
    const again = await checkStatement(ids.h, ids.account, bytes(CARD), choices);
    expect(again.kind === "csv" && again.preview[0].direction).toBe("out");
    expect(await importStatementFile({ id: ids.jar }, ids.account, ids.dad, bytes(CARD), choices)).toEqual({ ok: true, added: 6, already: 0, skipped: 0 });
    expect((await amounts()).map((r) => r.amountCents)).toEqual([-4520, -650, -1800, -3000, -2240, 10000]);

    // Next month's file with the same layout comes back with the choices already set.
    const next = await checkStatement(ids.h, ids.account, bytes(CARD.replace(/10\/0(\d)\/2026/g, "11/0$1/2026")));
    expect(next.kind === "csv" && [next.choices.flip, next.dateOrderFrom]).toEqual([true, "remembered"]);
  });

  test("importing the same file again adds nothing", async () => {
    const { checkStatement, importStatementFile } = await import("./statement-import");
    const check = await checkStatement(ids.h, ids.account, bytes(CARD));
    if (check.kind !== "csv") throw new Error("not csv");
    expect(await importStatementFile({ id: ids.jar }, ids.account, ids.dad, bytes(CARD), check.choices)).toEqual({ ok: true, added: 0, already: 6, skipped: 0 });
    expect(await prisma.finImport.count({ where: { accountId: ids.account } })).toBe(1);
  });

  test("a wrong choice is one Remove this import away", async () => {
    const { checkStatement, importStatementFile, recentImports, removeImport } = await import("./statement-import");
    const check = await checkStatement(ids.h, ids.account, bytes(CARD));
    if (check.kind !== "csv") throw new Error("not csv");
    // Imported with the sign the wrong way round: six new rows (their ids differ).
    const wrong = await importStatementFile({ id: ids.jar }, ids.account, ids.dad, bytes(CARD), { ...check.choices, flip: false });
    expect(wrong).toMatchObject({ ok: true, added: 6 });
    expect(await amounts()).toHaveLength(12);
    const [latest] = await recentImports(ids.jar);
    expect(latest).toMatchObject({ added: 6, account: { name: "Card" }, by: { firstName: "Dad" } });
    expect(await removeImport(ids.jar, latest.id)).toBe(6);
    expect(await amounts()).toHaveLength(6);
    expect(await removeImport(ids.jar, latest.id)).toBeNull();
    // Another jar can't remove this jar's import.
    const [first] = await recentImports(ids.jar);
    expect(await removeImport("someone-elses-jar", first.id)).toBeNull();
  });

  test("a row another import already brought (an OFX of the same days) is folded in", async () => {
    const { importStatementFile } = await import("./statement-import");
    const ofx = [
      "OFXHEADER:100",
      "<OFX><BANKTRANLIST>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261002<TRNAMT>-45.20<FITID>F1<NAME>Corner Grocery</STMTTRN>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261009<TRNAMT>-9.99<FITID>F2<NAME>Streaming Example</STMTTRN>",
      "</BANKTRANLIST></OFX>",
    ].join("\n");
    expect(await importStatementFile({ id: ids.jar }, ids.account, ids.dad, bytes(ofx), null)).toEqual({ ok: true, added: 1, already: 1, skipped: 0 });
    expect((await amounts()).filter((r) => r.description === "Corner Grocery")).toHaveLength(1);
  });

  test("a CSV without confirmed choices isn't imported", async () => {
    const { importStatementFile } = await import("./statement-import");
    expect(await importStatementFile({ id: ids.jar }, ids.account, ids.dad, bytes(CARD), null)).toEqual({ ok: false, error: "Check the file first, then import." });
  });
});
