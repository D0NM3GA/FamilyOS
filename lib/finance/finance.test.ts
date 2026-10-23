import { describe, expect, it, vi } from "vitest";
import { checkAccessUrl, claimSetupToken, claimUrlFromToken, fetchAccounts, parseAccounts, utcDay } from "./simplefin";
import { parsePage } from "./privacy";
import { parseCsv, parseOfx, parseStatement, splitCsv } from "./importers";
import { dupKey, findDuplicates, matchPrivacy, supersededPending } from "./reconcile";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("SimpleFIN", () => {
  it("only trusts SimpleFIN's own hosts", () => {
    expect(claimUrlFromToken(b64("https://beta-bridge.simplefin.org/simplefin/claim/ABC"))?.hostname).toBe("beta-bridge.simplefin.org");
    for (const bad of ["https://evil.com/claim", "http://bridge.simplefin.org/claim", "https://bridge.simplefin.org:8443/x", "https://bridge.simplefin.org.evil.com/x", "https://x.bridge.simplefin.org/c"]) {
      expect(claimUrlFromToken(b64(bad))).toBeNull();
    }
    expect(claimUrlFromToken("not base64 !!")).toBeNull();
    expect(checkAccessUrl("https://user:pass@bridge.simplefin.org/simplefin")).not.toBeNull();
    expect(checkAccessUrl("https://bridge.simplefin.org/simplefin")).toBeNull();
    expect(checkAccessUrl("https://user:pass@evil.com/simplefin")).toBeNull();
  });

  it("claims once; a used token says so", async () => {
    const token = b64("https://bridge.simplefin.org/simplefin/claim/X");
    const ok = vi.fn(async () => new Response("https://u:p@bridge.simplefin.org/simplefin")) as unknown as typeof fetch;
    expect(await claimSetupToken(token, ok)).toBe("https://u:p@bridge.simplefin.org/simplefin");
    const used = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(claimSetupToken(token, used)).rejects.toMatchObject({ kind: "used" });
    const sneaky = vi.fn(async () => new Response("https://u:p@evil.com/x")) as unknown as typeof fetch;
    await expect(claimSetupToken(token, sneaky)).rejects.toMatchObject({ kind: "failed" });
  });

  it("sends the credentials as a header, never in the URL", async () => {
    let seen: { url: string; auth: string | null } = { url: "", auth: null };
    const fetchFn = vi.fn(async (url: URL | string, init?: RequestInit) => {
      seen = { url: String(url), auth: (init?.headers as Record<string, string>).Authorization };
      return Response.json({ errors: [], accounts: [] });
    }) as unknown as typeof fetch;
    await fetchAccounts("https://u%40x:p@bridge.simplefin.org/simplefin", { start: new Date(0), end: new Date(86_400_000) }, fetchFn);
    expect(seen.url).toBe("https://bridge.simplefin.org/simplefin/accounts?start-date=0&end-date=86400&pending=1");
    expect(seen.auth).toBe(`Basic ${b64("u@x:p")}`);
  });

  it("parses accounts: decimal strings to cents, UTC days, pending with posted 0", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const { accounts, messages } = parseAccounts(
      {
        errors: ["Connection to Chase may need attention"],
        accounts: [
          {
            id: "A1",
            name: "Checking",
            currency: "USD",
            balance: "1234.56",
            "balance-date": 1759622400,
            org: { name: "Chase" },
            transactions: [
              { id: "T1", posted: 1759622400, amount: "-54.99", description: "PWP*NETFLIX.COM PRIVACY.COM" },
              { id: "T2", posted: 0, transacted_at: 1759660000, amount: "-4.50", description: "COFFEE", pending: true },
              { id: "T3", posted: 1759622400, amount: "1.234", description: "bad amount" },
            ],
          },
        ],
      },
      now,
    );
    expect(messages).toEqual(["Connection to Chase may need attention"]);
    expect(accounts[0]).toMatchObject({ id: "A1", org: "Chase", balanceCents: 123456 });
    expect(accounts[0].transactions).toEqual([
      { id: "T1", postedOn: "2025-10-05", amountCents: -5499, description: "PWP*NETFLIX.COM PRIVACY.COM", payee: null, memo: null, pending: false },
      { id: "T2", postedOn: utcDay(1759660000), amountCents: -450, description: "COFFEE", payee: null, memo: null, pending: true },
    ]);
  });
});

describe("Privacy.com", () => {
  it("keeps only allowlisted fields of settled charges", () => {
    const { txns } = parsePage({
      data: [
        { token: "p1", amount: 1599, settled_amount: 1599, status: "SETTLED", created: "2025-10-04T10:00:00Z", merchant: { descriptor: "NETFLIX.COM" }, card: { token: "c1", memo: "Netflix", last_four: "4242", pan: "4111111111111111", cvv: "123" } },
        { token: "p2", amount: 500, status: "PENDING", created: "2025-10-04T10:00:00Z" },
        { token: "p3", amount: 500, status: "DECLINED", created: "2025-10-04T10:00:00Z" },
      ],
      total_pages: 1,
    });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ token: "p1", cardMemo: "Netflix", cardLast4: "4242", merchant: "NETFLIX.COM", amountCents: 1599 });
    expect(JSON.stringify(txns)).not.toMatch(/4111|cvv|pan/);
  });
});

describe("statement files", () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20251004120000[-5:EST]<TRNAMT>-54.99<FITID>2025100401<NAME>PWP*NETFLIX.COM<MEMO>PRIVACY.COM
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20251003<TRNAMT>1500.00<FITID>2025100302<NAME>PAYROLL &amp; CO
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads OFX/QFX by FITID with the civil day", () => {
    const r = parseOfx(ofx);
    expect(r).toEqual({
      ok: true,
      format: "ofx",
      skipped: 0,
      rows: [
        { externalId: "ofx:2025100401", postedOn: "2025-10-04", amountCents: -5499, description: "PWP*NETFLIX.COM", memo: "PRIVACY.COM" },
        { externalId: "ofx:2025100302", postedOn: "2025-10-03", amountCents: 150000, description: "PAYROLL & CO", memo: null },
      ],
    });
    expect(parseStatement(ofx).ok).toBe(true);
  });

  it("reads CSV with amount, or debit and credit; identical rows get distinct, stable ids", () => {
    const a = parseCsv('Date,Description,Amount\n10/04/2025,"COFFEE, INC",-4.50\n10/04/2025,"COFFEE, INC",-4.50\n2025-10-05,Refund,($2.00)\n');
    expect(a.ok && a.rows.map((r) => [r.postedOn, r.amountCents, r.description])).toEqual([
      ["2025-10-04", -450, "COFFEE, INC"],
      ["2025-10-04", -450, "COFFEE, INC"],
      ["2025-10-05", -200, "Refund"],
    ]);
    const again = parseCsv('Date,Description,Amount\n10/04/2025,"COFFEE, INC",-4.50\n10/04/2025,"COFFEE, INC",-4.50\n');
    expect(a.ok && again.ok && again.rows.map((r) => r.externalId)).toEqual(a.ok && a.rows.slice(0, 2).map((r) => r.externalId));
    expect(a.ok && new Set(a.rows.map((r) => r.externalId)).size).toBe(3);

    const dc = parseCsv("Posted Date,Payee,Debit,Credit\n10/04/2025,Store,12.00,\n10/05/2025,Paycheck,,100.00\n");
    const odd = parseCsv("Date,Description,Amount\n10/04/2025,A,−4.50\n10/04/2025,B,4.50 DR\n10/04/2025,C,1.234\n");
    expect(odd.ok && [odd.rows.map((r) => r.amountCents), odd.skipped]).toEqual([[-450, -450], 1]);
    expect(dc.ok && dc.rows.map((r) => r.amountCents)).toEqual([-1200, 10000]);
  });

  it("refuses files it can't read rather than guessing", () => {
    expect(parseCsv("Foo,Bar\n1,2\n").ok).toBe(false);
    expect(parseCsv("Date,Description,Amount\n13/45/2025,X,1\n").ok).toBe(false);
    expect(splitCsv('a,"b\nc",d\n')).toEqual([["a", "b\nc", "d"]]);
  });
});

describe("reconciler", () => {
  it("pending rows the feed stopped reporting are superseded, inside the window only", () => {
    const pending = [
      { id: "1", externalId: "P1", postedOn: "2025-10-04", amountCents: -500 },
      { id: "2", externalId: "P2", postedOn: "2025-10-04", amountCents: -600 },
      { id: "3", externalId: "P3", postedOn: "2025-06-01", amountCents: -700 },
    ];
    expect(supersededPending(pending, new Set(["P2"]), "2025-09-01")).toEqual(["1"]);
  });

  it("same amount same day is the same money; within 3 days is a question; answered pairs stay quiet", () => {
    const manual = [
      { id: "m1", postedOn: "2025-10-04", amountCents: -5499 },
      { id: "m2", postedOn: "2025-10-01", amountCents: -1200 },
      { id: "m3", postedOn: "2025-10-01", amountCents: -999 },
    ];
    const feed = [
      { id: "f1", postedOn: "2025-10-04", amountCents: -5499 },
      { id: "f2", postedOn: "2025-10-03", amountCents: -1200 },
      { id: "f3", postedOn: "2025-10-02", amountCents: -999 },
    ];
    expect(findDuplicates(manual, feed, new Set([dupKey("f3", "m3")]))).toEqual({ same: [["m1", "f1"]], possible: [["m2", "f2"]] });
    expect(dupKey("b", "a")).toBe(dupKey("a", "b"));
  });

  it("Privacy charges enrich the nearest matching bank row, one to one", () => {
    const bank = [
      { id: "t1", postedOn: "2025-10-06", amountCents: -1599, description: "PWP*NETFLIX PRIVACY.COM" },
      { id: "t2", postedOn: "2025-10-04", amountCents: -1599, description: "PWP*NETFLIX PRIVACY.COM" },
      { id: "t3", postedOn: "2025-10-04", amountCents: -1599, description: "NETFLIX DIRECT" },
    ];
    expect(matchPrivacy([{ id: "c1", amountCents: 1599, occurredOn: "2025-10-04" }], bank)).toEqual([["c1", "t2"]]);
  });
});
