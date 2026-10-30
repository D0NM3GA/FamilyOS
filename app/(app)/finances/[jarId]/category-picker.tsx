"use client";

import { useState, useTransition } from "react";
import { btn, btnDanger, btnPrimary } from "@/components/styles";
import { Picker } from "@/components/picker";
import { forgetRule, setCategory, type FormState } from "../actions";
import { useSheet } from "./txn-sheet";

type Category = { id: string; name: string; emoji: string | null };

/**
 * Phase 26: a charge's category, inside its row's sheet. Picking asks "just this one" or
 * "always for <merchant>": only the second teaches the app (so one gift from Amazon doesn't
 * make all of Amazon Gifts). A save that worked closes the sheet with the answer under the
 * row; one that didn't says why here and leaves the sheet open.
 */
export function CategoryPicker({
  jarId,
  txnId,
  current,
  merchant,
  merchantLabel,
  categories,
  bySomeone,
  byRule = false,
}: {
  jarId: string;
  txnId: string;
  current: Category | null;
  /** The merchant key ("" when the charge has none: then there's no "always"). */
  merchant: string;
  /** The merchant as people read it ("Blue Bottle Coffee"), never the bank's raw text. */
  merchantLabel: string;
  categories: Category[];
  /** Set by hand by someone in the jar. */
  bySomeone: boolean;
  /** Set by an "always for <merchant>" rule. */
  byRule?: boolean;
}) {
  const [picked, setPicked] = useState(current?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const sheet = useSheet();

  function run(task: () => Promise<FormState>) {
    setError(null);
    setOk(null);
    start(async () => {
      let answer: FormState;
      try {
        answer = await task();
      } catch {
        answer = { error: "Couldn't save that. Check the connection and try again." };
      }
      if (answer.error) setError(answer.error);
      else if (sheet) sheet.close(answer.ok);
      else setOk(answer.ok ?? "Saved.");
    });
  }

  const how = bySomeone
    ? "Set by hand."
    : byRule
      ? `Always ${current?.name ?? "this"} for ${merchantLabel}.`
      : current
        ? "A guess. Pick another if it's wrong."
        : "Not in a category yet.";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{how}</p>
      <Picker
        label="Category"
        options={[{ value: "", label: "No category" }, ...categories.map((c) => ({ value: c.id, label: c.name, emoji: c.emoji }))]}
        value={picked}
        onChange={setPicked}
        placeholder="Type a category"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => setCategory(jarId, txnId, picked, "one"))} className={btn}>
          Just this one
        </button>
        {picked && merchant && (
          <button type="button" disabled={pending} onClick={() => run(() => setCategory(jarId, txnId, picked, "always"))} className={btnPrimary}>
            Always for {merchantLabel}
          </button>
        )}
      </div>
      {byRule && merchant && (
        <button type="button" disabled={pending} onClick={() => run(() => forgetRule(jarId, merchant))} className={`${btnDanger} self-start`}>
          Stop &quot;always&quot; for {merchantLabel}
        </button>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-tomato">
          {error}
        </p>
      )}
      {ok && (
        <p role="status" className="text-sm font-semibold">
          ✓ {ok}
        </p>
      )}
    </div>
  );
}
