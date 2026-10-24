"use client";

import { useId, useState, useTransition } from "react";
import { btn, btnPrimary, field } from "@/components/styles";
import { ConfirmAction } from "@/components/submit";
import type { Choices } from "@/lib/finance/statement-columns";
import type { StatementCheck } from "@/lib/finance/statement-import";

type FormState = { error?: string; ok?: string };
type Account = { id: string; name: string };
type RecentImport = { id: string; when: string; added: number; account: string; by: string | null };

/**
 * Phase 52: a statement file, checked then imported. The page keeps the chosen file and sends the
 * same one with each step (a plain form post would clear the file field after it returns), so
 * nothing of it is kept on the server in between. A CSV shows what the app understood, on 5 rows,
 * with every guess changeable; OFX and QFX just say how many rows they have.
 */
export function StatementImport({
  accounts,
  recent,
  check,
  importFile,
  removeImport,
}: {
  accounts: Account[];
  recent: RecentImport[];
  check: (fd: FormData) => Promise<StatementCheck>;
  importFile: (fd: FormData) => Promise<FormState>;
  removeImport: (importId: string) => Promise<FormState>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [result, setResult] = useState<StatementCheck | null>(null);
  // A changed choice shows at once while the rows are read again with it.
  const [draft, setDraft] = useState<Choices | null>(null);
  const [message, setMessage] = useState<FormState>({});
  const [pending, start] = useTransition();
  // Bumped after an import, so the file field starts empty for the next statement.
  const [fileKey, setFileKey] = useState(0);
  const ids = { file: useId(), account: useId(), name: useId() };

  const form = (choices?: Choices) => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("accountId", accountId);
    fd.set("newAccount", newAccount);
    if (choices) fd.set("choices", JSON.stringify(choices));
    return fd;
  };
  const runCheck = (choices?: Choices) => {
    setDraft(choices ?? null);
    start(async () => {
      setMessage({});
      setResult(await check(form(choices)));
      setDraft(null);
    });
  };
  const runImport = () =>
    start(async () => {
      const outcome = await importFile(form(result?.kind === "csv" ? result.choices : undefined));
      setMessage(outcome);
      if (outcome.ok) {
        setResult(null);
        setFile(null);
        setFileKey((k) => k + 1);
      }
    });

  return (
    <div className="mt-2 flex flex-col gap-3">
      <label htmlFor={ids.file} className="text-sm font-semibold">
        Statement file
      </label>
      <input
        key={fileKey}
        id={ids.file}
        type="file"
        accept=".ofx,.qfx,.csv,.txt,text/csv"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setResult(null);
          setMessage({});
        }}
        className="max-w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-muted file:px-3 file:font-bold sm:file:min-h-9"
      />
      <div className="flex flex-wrap gap-2">
        {accounts.length > 0 && (
          <>
            <label htmlFor={ids.account} className="sr-only">
              Into account
            </label>
            <select
              id={ids.account}
              value={accountId}
              onChange={(e) => {
                // Another account may remember other choices for this file: check again.
                setAccountId(e.target.value);
                setResult(null);
              }} className={`${field} max-w-full min-w-0`}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="">A new account…</option>
            </select>
          </>
        )}
        {!accountId && (
          <>
            <label htmlFor={ids.name} className="sr-only">
              New account name
            </label>
            <input id={ids.name} value={newAccount} onChange={(e) => setNewAccount(e.target.value)} maxLength={60} placeholder="New account name" className={`${field} min-w-0 flex-1`} />
          </>
        )}
      </div>
      {!result && (
        <button type="button" className={`${btnPrimary} self-start`} disabled={!file || pending} onClick={() => runCheck()}>
          {pending ? "Reading…" : "Check it"}
        </button>
      )}

      <div className="flex flex-col gap-3">
        <div aria-live="polite">
          {result?.kind === "error" && <p className="text-sm font-semibold text-tomato">{result.error}</p>}
          {result?.kind === "ofx" && (
            <p className="text-sm">
              {result.rows} transaction{result.rows === 1 ? "" : "s"} in that file, each with the bank&apos;s own id.
            </p>
          )}
        </div>
        {result?.kind === "csv" && <CsvCheck result={result} choices={draft ?? result.choices} pending={pending} onChange={runCheck} />}
        {result && result.kind !== "error" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={pending || (result.kind === "csv" && result.willAdd === 0)} onClick={runImport}>
              {pending ? "Importing…" : "Import"}
            </button>
            <button type="button" className={btn} disabled={pending} onClick={() => setResult(null)}>
              Cancel
            </button>
          </div>
        )}
        <div aria-live="polite">
          {message.error && <p className="text-sm font-semibold text-tomato">{message.error}</p>}
          {message.ok && <p className="text-sm font-semibold">{message.ok}</p>}
        </div>
      </div>

      {recent.length > 0 && <RecentImports recent={recent} removeImport={removeImport} />}
    </div>
  );
}

function CsvCheck({
  result,
  choices: c,
  pending,
  onChange,
}: {
  result: Extract<StatementCheck, { kind: "csv" }>;
  choices: Choices;
  pending: boolean;
  onChange: (c: Choices) => void;
}) {
  const set = (patch: Partial<Choices>) => onChange({ ...c, ...patch });
  const id = useId();
  const columnSelect = (key: "date" | "description" | "memo" | "amount" | "debit" | "credit" | "type", label: string, optional = false) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className="text-xs font-semibold">
        {label}
      </label>
      <select
        id={`${id}-${key}`}
        value={c[key] ?? ""}
        disabled={pending}
        onChange={(e) => set({ [key]: e.target.value === "" ? null : Number(e.target.value) } as Partial<Choices>)}
        className={`${field} min-w-0`}
      >
        {optional && <option value="">None</option>}
        {result.columns.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
  const split = c.amount == null;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3">
      <p className="text-sm font-semibold">
        Here&apos;s what the app understood{result.dateOrderFrom === "remembered" ? ", the way you set it for this account last time" : ""}. Change anything that&apos;s off, then
        import.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {columnSelect("date", "Date")}
        {columnSelect("description", "Description")}
        {columnSelect("memo", "More detail (optional)", true)}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-split`} className="text-xs font-semibold">
            Amounts
          </label>
          <select
            id={`${id}-split`}
            value={split ? "split" : "one"}
            disabled={pending}
            onChange={(e) =>
              e.target.value === "split"
                ? set({ amount: null, debit: c.debit ?? 0, credit: c.credit ?? Math.min(1, result.columns.length - 1) })
                : set({ amount: c.debit ?? c.amount ?? 0, debit: null, credit: null })
            }
            className={`${field} min-w-0`}
          >
            <option value="one">One column</option>
            <option value="split">Money out and money in</option>
          </select>
        </div>
        {split ? (
          <>
            {columnSelect("debit", "Money out")}
            {columnSelect("credit", "Money in")}
          </>
        ) : (
          <>
            {columnSelect("amount", "Amount")}
            {columnSelect("type", "Debit or credit column (optional)", true)}
          </>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-order`} className="text-xs font-semibold">
            Dates like 03/10
          </label>
          <select
            id={`${id}-order`}
            value={c.dateOrder}
            disabled={pending}
            onChange={(e) => set({ dateOrder: e.target.value as Choices["dateOrder"] })}
            className={`${field} min-w-0`}
          >
            <option value="MONTH_FIRST">Month first (March 10)</option>
            <option value="DAY_FIRST">Day first (3 October)</option>
          </select>
        </div>
      </div>
      {!split && (
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" className="size-5" checked={c.flip} disabled={pending} onChange={(e) => set({ flip: e.target.checked })} />
          Money out shows as a positive number in this file (some card statements)
        </label>
      )}
      {result.suggestFlip && (
        <p className="text-sm font-semibold">Nearly every amount here is positive, which is how some card statements show charges. If these are charges, tick the box above.</p>
      )}
      <table aria-live="polite" className="w-full text-left text-sm">
        <caption className="text-left text-xs text-muted-foreground">
          The first {result.preview.length} of {result.willAdd} transactions read from the file, as they&apos;d be saved (any already here are folded in)
          {result.skipped ? `; ${result.skipped} row${result.skipped === 1 ? "" : "s"} can't be read and will be skipped` : ""}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col" className="text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {result.preview.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="py-1 pr-2 whitespace-nowrap">{r.day}</td>
              <td className="py-1 pr-2">{r.description}</td>
              <td className="py-1 text-right whitespace-nowrap">
                {r.amount} {r.direction === "out" ? "out" : "in"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentImports({ recent, removeImport }: { recent: RecentImport[]; removeImport: (importId: string) => Promise<FormState> }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-extrabold">Recent imports</h3>
      <ul className="flex flex-col gap-2">
        {recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">
              {r.added} into {r.account}, {r.when}
              {r.by ? ` by ${r.by}` : ""}
            </span>
            <ConfirmAction
              question={`Remove the ${r.added} transaction${r.added === 1 ? "" : "s"} this import added to ${r.account}?`}
              yes="Remove"
              pending={pending}
              onConfirm={() => start(async () => setMessage(await removeImport(r.id)))}
              className={btn}
            >
              Remove this import
            </ConfirmAction>
          </li>
        ))}
      </ul>
      {message.error && <p className="text-sm font-semibold text-tomato">{message.error}</p>}
      {message.ok && <p className="text-sm font-semibold">{message.ok}</p>}
    </div>
  );
}
