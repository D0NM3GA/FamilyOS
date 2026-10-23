"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { btn, btnDanger, btnPrimary, field } from "./styles";

/**
 * Phase 37: the pieces of a list a family edits by hand (Groceries' store sections, a money
 * jar's categories): a row's name and emoji edited in place, "remove, and move what's in it
 * to…", and the add row. Each takes a server action answering an EditState; ids are bound
 * into the action, never read from the form.
 */

/** What a list-editing action answers: a problem to show, or a line saying what happened. */
export type EditState = { error?: string; ok?: string };
type EditAction = (prev: EditState, formData: FormData) => Promise<EditState>;

function Problem({ state }: { state: EditState }) {
  return state.error ? (
    <p role="alert" className="basis-full text-sm font-semibold text-tomato">
      {state.error}
    </p>
  ) : null;
}

/**
 * A row's emoji and name, edited in place. Save shows up once something changed (Enter saves,
 * Escape puts it back). Give it a `key` of the saved name and emoji, so a save that worked
 * starts it fresh from what the server now has.
 */
export function RenameFields({ action, name, emoji, label }: { action: EditAction; name: string; emoji: string | null; label: string }) {
  const [state, run, pending] = useActionState(action, {});
  const [typedName, setTypedName] = useState(name);
  const [typedEmoji, setTypedEmoji] = useState(emoji ?? "");
  const changed = typedName.trim() !== name || typedEmoji.trim() !== (emoji ?? "");
  const undo = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setTypedName(name);
    setTypedEmoji(emoji ?? "");
  };
  return (
    // basis-44: narrow enough to share a phone's line with a section's ↑ ↓; the count and
    // Remove wrap under it.
    <form action={run} className="flex min-w-0 flex-1 basis-44 flex-wrap items-center gap-2">
      <input
        name="emoji"
        value={typedEmoji}
        onChange={(e) => setTypedEmoji(e.target.value)}
        onKeyDown={undo}
        maxLength={32}
        aria-label={`Emoji for ${label}`}
        className={`${field} w-14 text-center`}
      />
      <input
        name="name"
        value={typedName}
        onChange={(e) => setTypedName(e.target.value)}
        onKeyDown={undo}
        required
        maxLength={40}
        aria-label={`Name of ${label}`}
        className={`${field} min-w-0 flex-1 font-bold`}
      />
      {changed && (
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
      )}
      <Problem state={state} />
    </form>
  );
}

/**
 * "Remove": the first tap asks, in place, where what's in it should go (a select inside the
 * question), with the remove button and "Keep it". Only the remove button submits. Keep it
 * puts focus back on the button it replaced.
 */
export function RemoveAndMove({
  action,
  trigger,
  question,
  options,
  defaultValue,
  yes,
  note,
}: {
  action: EditAction;
  /** The first button: "Remove", "Remove…". */
  trigger: string;
  /** Read before the select: "Remove Produce? Its 18 items move to". */
  question: string;
  /** `note`: what happens with this pick in particular (a budget added up, saving up taken over). */
  options: { value: string; label: string; note?: string | null }[];
  defaultValue: string;
  /** The button that does it: "Remove", "Move and remove". */
  yes: string;
  /** A line under the question, for a side effect worth knowing whatever is picked. */
  note?: string | null;
}) {
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState(defaultValue);
  const [state, run, pending] = useActionState(action, {});
  const pickedNote = options.find((o) => o.value === picked)?.note;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  useEffect(() => {
    if (asking || !kept.current) return;
    kept.current = false;
    triggerRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button ref={triggerRef} type="button" className={btnDanger} onClick={() => setAsking(true)}>
        {trigger}
      </button>
    );
  }
  return (
    <form action={run} className="flex basis-full flex-col gap-2 rounded-xl bg-tomato/10 p-3">
      <label className="flex flex-col gap-1.5 text-sm font-semibold sm:flex-row sm:flex-wrap sm:items-center">
        <span>{question}</span>
        {/* Focus moves to the choice so the question is read out with it. */}
        <select name="to" value={picked} onChange={(e) => setPicked(e.target.value)} className={`${field} max-w-full`} autoFocus>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {/* Always there (hidden while empty), so a screen reader reads it out as the pick changes it. */}
      <p aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
        {pickedNote}
      </p>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnDanger}>
          {pending ? "Working…" : yes}
        </button>
        <button
          type="button"
          disabled={pending}
          className={btn}
          onClick={() => {
            kept.current = true;
            setAsking(false);
          }}
        >
          Keep it
        </button>
      </div>
      <Problem state={state} />
    </form>
  );
}

/**
 * The add row: emoji, name, an optional pick (a category's kind) and Add. What was typed stays
 * when the action says no (a name already used), and clears when it worked.
 */
export function AddRow({
  action,
  namePlaceholder,
  nameLabel,
  choice,
}: {
  action: EditAction;
  namePlaceholder: string;
  nameLabel: string;
  choice?: { name: string; label: string; options: { value: string; label: string }[] };
}) {
  const [typedName, setTypedName] = useState("");
  const [typedEmoji, setTypedEmoji] = useState("");
  const [picked, setPicked] = useState(choice?.options[0]?.value ?? "");
  const [state, run, pending] = useActionState(async (prev: EditState, formData: FormData) => {
    const answer = await action(prev, formData);
    if (answer.ok) {
      setTypedName("");
      setTypedEmoji("");
    }
    return answer;
  }, {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input
        name="emoji"
        value={typedEmoji}
        onChange={(e) => setTypedEmoji(e.target.value)}
        maxLength={32}
        placeholder="🙂"
        aria-label="Emoji (optional)"
        className={`${field} w-14 text-center`}
      />
      <input
        name="name"
        value={typedName}
        onChange={(e) => setTypedName(e.target.value)}
        required
        maxLength={40}
        placeholder={namePlaceholder}
        aria-label={nameLabel}
        className={`${field} min-w-0 flex-1 basis-40`}
      />
      {choice && (
        <select name={choice.name} value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={choice.label} className={field}>
          {choice.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Adding…" : "+ Add"}
      </button>
      <Problem state={state} />
      {state.ok && (
        <p role="status" className="basis-full text-sm font-semibold">
          {state.ok}
        </p>
      )}
    </form>
  );
}
