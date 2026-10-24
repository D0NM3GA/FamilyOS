import { describe, expect, it } from "vitest";
import { parseCsv } from "./importers";
import { applyChoices, centsOf, checkChoices, dateOf, decodeStatement, guessChoices, householdDateOrder, layoutKey, readSheet, sniffSeparator } from "./statement-columns";

/** Phase 52: statement CSVs worked out. Every file here is made up: no real bank, merchant or amount. */

const read = (text: string, fallback: "MONTH_FIRST" | "DAY_FIRST" = "MONTH_FIRST") => {
  const sheet = readSheet(text);
  const guess = guessChoices(sheet, fallback);
  return { sheet, guess, ...applyChoices(sheet, guess.choices) };
};
const summary = (rows: { postedOn: string; amountCents: number; description: string }[]) => rows.map((r) => `${r.postedOn} ${r.amountCents} ${r.description}`);

describe("reading the file", () => {
  it("decodes UTF-8, Windows-1252 and UTF-16", () => {
    expect(decodeStatement(new TextEncoder().encode("\uFEFFCafé"))).toBe("Café");
    expect(decodeStatement(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from("Café", "utf16le")]);
    expect(decodeStatement(utf16)).toBe("Café");
  });

  it("finds the separator", () => {
    expect(sniffSeparator("a,b,c\n1,2,3")).toBe(",");
    expect(sniffSeparator("a;b;c\n1,50;2;3")).toBe(";");
    expect(sniffSeparator("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("skips account details above the header", () => {
    const { sheet, rows } = read(
      ["Account Name : Family Checking", "Account Number : XXXX0000", "", "Date,Description,Amount,Running Bal.", "10/03/2026,Corner Grocery,-45.20,954.80", "10/04/2026,Paycheck Example Co,1200.00,2154.80", "10/05/2026,Gas Station Example,-30.00,2124.80"].join("\n"),
    );
    expect(sheet.header).toEqual(["Date", "Description", "Amount", "Running Bal."]);
    expect(summary(rows)).toEqual(["2026-10-03 -4520 Corner Grocery", "2026-10-04 120000 Paycheck Example Co", "2026-10-05 -3000 Gas Station Example"]);
  });

  it("reads a file with no header by its contents", () => {
    const { sheet, guess, rows } = read(['"10/03/2026","-45.20","*","","CORNER GROCERY"', '"10/04/2026","1200.00","*","","PAYCHECK EXAMPLE CO"', '"10/05/2026","-30.00","*","","GAS STATION EXAMPLE"'].join("\n"));
    expect(sheet.header).toBeNull();
    expect(guess.choices).toMatchObject({ date: 0, amount: 1, description: 4 });
    expect(rows.map((r) => r.amountCents)).toEqual([-4520, 120000, -3000]);
  });

  it("keeps the same row ids as the old reader, so a file imported before adds nothing", () => {
    const text = "Date,Description,Amount\n10/03/2026,Corner Grocery,-45.20\n10/03/2026,Corner Grocery,-45.20\n";
    const old = parseCsv(text);
    expect(old.ok && old.rows.map((r) => r.externalId)).toEqual(read(text).rows.map((r) => r.externalId));
  });

  it("gives the same layout key to the same layout, and a different one otherwise", () => {
    const a = readSheet("Date,Description,Amount\n10/03/2026,A,-1.00\n10/04/2026,B,-2.00");
    const b = readSheet("Date,Description,Amount\n11/03/2026,C,-3.00\n11/04/2026,D,-4.00");
    const c = readSheet("Date,Payee,Amount\n10/03/2026,A,-1.00\n10/04/2026,B,-2.00");
    expect(layoutKey(a)).toBe(layoutKey(b));
    expect(layoutKey(a)).not.toBe(layoutKey(c));
  });
});

describe("cells", () => {
  it("reads every date form, in the order asked", () => {
    expect(dateOf("2026-10-03", "MONTH_FIRST")).toBe("2026-10-03");
    expect(dateOf("10/03/2026", "MONTH_FIRST")).toBe("2026-10-03");
    expect(dateOf("10/03/2026", "DAY_FIRST")).toBe("2026-03-10");
    expect(dateOf("3.10.2026", "DAY_FIRST")).toBe("2026-10-03");
    expect(dateOf("10-03-26", "MONTH_FIRST")).toBe("2026-10-03");
    expect(dateOf("Oct 3, 2026", "DAY_FIRST")).toBe("2026-10-03");
    expect(dateOf("3 October 2026", "MONTH_FIRST")).toBe("2026-10-03");
    expect(dateOf("03-Oct-26", "MONTH_FIRST")).toBe("2026-10-03");
    expect(dateOf("20261003", "MONTH_FIRST")).toBeNull();
    expect(dateOf("20261003", "MONTH_FIRST", true)).toBe("2026-10-03");
    expect(dateOf("02/30/2026", "MONTH_FIRST")).toBeNull();
  });

  it("reads money, with either decimal mark", () => {
    expect(centsOf("$1,234.56", false)).toBe(123456);
    expect(centsOf("(12.00)", false)).toBe(-1200);
    expect(centsOf("12.00 DR", false)).toBe(-1200);
    expect(centsOf("−12.00", false)).toBe(-1200);
    expect(centsOf("1.234,56", true)).toBe(123456);
    expect(centsOf("-1,50", true)).toBe(-150);
    expect(centsOf("abc", false)).toBeNull();
  });
});

describe("guessing the columns", () => {
  it("prefers the posting date, and takes a second text column as the memo", () => {
    const { guess, rows } = read(
      ["Transaction Date,Post Date,Description,Original Description,Amount", "10/01/2026,10/03/2026,Corner Grocery,CORNER GROCERY #12 SPRINGFIELD,-45.20", "10/02/2026,10/04/2026,Bakery Example,BAKERY EXAMPLE 0042,-6.50", "10/04/2026,10/05/2026,Bookstore Example,BOOKSTORE EXAMPLE,-18.00"].join("\n"),
    );
    expect(guess.choices).toMatchObject({ date: 1, description: 2, memo: 3, amount: 4 });
    expect(rows[0]).toMatchObject({ postedOn: "2026-10-03", memo: "CORNER GROCERY #12 SPRINGFIELD" });
  });

  it("isn't fooled by a balance, a reference number or a category column", () => {
    const { guess } = read(
      [
        ",,,,,,",
        "10/03/2026,100234,Groceries,Corner Grocery Springfield,-45.20,954.80,Posted",
        "10/04/2026,100235,Income,Paycheck Example Co,1200.00,2154.80,Posted",
        "10/05/2026,100236,Transport,Gas Station Example,-30.00,2124.80,Posted",
        "10/06/2026,100237,Groceries,Farmers Market Example,-12.75,2112.05,Posted",
        "10/07/2026,100238,Dining,Pizza Place Example,-22.40,2089.65,Posted",
      ].join("\n"),
    );
    expect(guess.choices).toMatchObject({ date: 0, description: 3, amount: 4 });
  });

  it("reads debit and credit columns, both positive or a credit written negative", () => {
    const both = read(["Date,Description,Debit,Credit,Balance", "10/03/2026,Corner Grocery,45.20,,954.80", "10/04/2026,Paycheck Example Co,,1200.00,2154.80", "10/05/2026,Gas Station Example,30.00,,2124.80"].join("\n"));
    expect(both.rows.map((r) => r.amountCents)).toEqual([-4520, 120000, -3000]);
    const negativeCredit = read(["Date,Description,Debit,Credit", "10/03/2026,Corner Grocery,45.20,", "10/04/2026,Card Payment Thank You,,-200.00"].join("\n"));
    expect(negativeCredit.rows.map((r) => r.amountCents)).toEqual([-4520, 20000]);
  });

  it("reads semicolons, comma decimals and the day first from the file's own dates", () => {
    const { guess, rows } = read(["Datum;Omschrijving;Bedrag", "03.10.2026;Bakkerij Voorbeeld;-4,50", "15.10.2026;Salaris Voorbeeld BV;1.250,00", "20.10.2026;Supermarkt Voorbeeld;-32,10"].join("\n"));
    expect(guess.choices).toMatchObject({ decimalComma: true, dateOrder: "DAY_FIRST" });
    expect(guess.dateOrderFrom).toBe("file");
    expect(summary(rows)).toEqual(["2026-10-03 -450 Bakkerij Voorbeeld", "2026-10-15 125000 Salaris Voorbeeld BV", "2026-10-20 -3210 Supermarkt Voorbeeld"]);
  });

  it("follows the household's setting when every date could be either", () => {
    const text = "Date,Description,Amount\n03/10/2026,A,-1.00\n04/10/2026,B,-2.00\n05/10/2026,C,-3.00";
    expect(read(text, "MONTH_FIRST").rows[0].postedOn).toBe("2026-03-10");
    expect(read(text, "DAY_FIRST").rows[0].postedOn).toBe("2026-10-03");
    expect(read(text).guess.dateOrderFrom).toBe("setting");
  });

  it("uses a Type column for the sign only when every amount is positive, and only for words it knows", () => {
    const allPositive = read(["Date,Description,Type,Amount", "10/03/2026,Corner Grocery,Debit,45.20", "10/04/2026,Paycheck Example Co,Credit,1200.00", "10/05/2026,Mystery Row,Pending,5.00"].join("\n"));
    expect(allPositive.rows.map((r) => r.amountCents)).toEqual([-4520, 120000, 500]);
    // Already signed, with Sale/Payment types: the types don't turn anything around a second time.
    const signed = read(["Transaction Date,Post Date,Description,Category,Type,Amount", "10/01/2026,10/02/2026,Corner Grocery,Groceries,Sale,-45.20", "10/03/2026,10/04/2026,Payment Thank You,,Payment,200.00", "10/05/2026,10/06/2026,Return Example,Shopping,Return,12.00"].join("\n"));
    expect(signed.rows.map((r) => r.amountCents)).toEqual([-4520, 20000, 1200]);
    expect(signed.guess.choices.description).toBe(2);
  });

  it("suggests turning a card file around when nearly every amount is positive, but never does it alone", () => {
    const card = read(
      ["Trans. Date,Post Date,Description,Amount,Category", ...["Corner Grocery", "Bakery Example", "Bookstore Example", "Gas Station Example", "Pizza Place Example", "Hardware Example"].map((d, i) => `10/0${i + 1}/2026,10/0${i + 2}/2026,${d},${(10 + i).toFixed(2)},Shopping`), "10/08/2026,10/09/2026,Payment Thank You,-100.00,Payment"].join("\n"),
    );
    expect(card.guess.suggestFlip).toBe(true);
    expect(card.guess.choices.flip).toBe(false);
    expect(card.rows[0].amountCents).toBe(1000);
    expect(applyChoices(card.sheet, { ...card.guess.choices, flip: true }).rows[0].amountCents).toBe(-1000);
  });

  it("reads compact dates and month names", () => {
    expect(read("Date,Description,Amount\n20261003,A,-1.00\n20261004,B,-2.00").rows.map((r) => r.postedOn)).toEqual(["2026-10-03", "2026-10-04"]);
    expect(read('Date,Description,Amount\n"Oct 3, 2026",A,-1.00\n"Oct 4, 2026",B,-2.00').rows.map((r) => r.postedOn)).toEqual(["2026-10-03", "2026-10-04"]);
  });

  it("counts rows that don't read, and reads none from a file that isn't a statement", () => {
    const some = read("Date,Description,Amount\n10/03/2026,A,-1.00\nnot a date,B,-2.00\n10/05/2026,,-3.00\n10/06/2026,C,-4.00");
    expect([some.rows.length, some.skipped]).toEqual([2, 2]);
    expect(read("hello\nworld").rows).toEqual([]);
  });
});

describe("the person's choices", () => {
  const sheet = readSheet("Date,Description,Amount,Note\n10/03/2026,A,-1.00,x\n10/04/2026,B,-2.00,y");
  it("are checked against the file", () => {
    expect(checkChoices({ date: 0, description: 1, amount: 2, dateOrder: "MONTH_FIRST" }, sheet)).toMatchObject({ date: 0, description: 1, amount: 2, debit: null });
    expect(checkChoices({ date: 9, description: 1, amount: 2, dateOrder: "MONTH_FIRST" }, sheet)).toBeNull();
    expect(checkChoices({ date: 0, description: 1, dateOrder: "MONTH_FIRST" }, sheet)).toBeNull();
    expect(checkChoices({ date: 0, description: 1, amount: 2, dateOrder: "SIDEWAYS" }, sheet)).toBeNull();
    expect(checkChoices("nope", sheet)).toBeNull();
  });

  it("override the guess", () => {
    const c = checkChoices({ date: 0, description: 3, amount: 2, dateOrder: "MONTH_FIRST" }, sheet)!;
    expect(applyChoices(sheet, c).rows.map((r) => r.description)).toEqual(["x", "y"]);
  });
});

describe("the household's date order", () => {
  it("is month first in the US, day first elsewhere, unless an admin chose", () => {
    expect(householdDateOrder("AUTO", "America/Chicago")).toBe("MONTH_FIRST");
    expect(householdDateOrder("AUTO", "Pacific/Honolulu")).toBe("MONTH_FIRST");
    expect(householdDateOrder("AUTO", "Europe/London")).toBe("DAY_FIRST");
    expect(householdDateOrder("AUTO", "America/Sao_Paulo")).toBe("DAY_FIRST");
    expect(householdDateOrder("AUTO", null)).toBe("MONTH_FIRST");
    expect(householdDateOrder("DAY_FIRST", "America/Chicago")).toBe("DAY_FIRST");
  });
});
