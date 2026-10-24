"use client";

import { useActionState, useId } from "react";
import { btn, btnPrimary, field, fieldLabel } from "@/components/styles";
import type { FeedFormState, FindState } from "./actions";

const box = `mt-1 w-full ${field}`;

type Students = { id: string; name: string }[];

/**
 * Phase 51: the school's web address in, the calendars its site offers out, each ready to add.
 * The found addresses stay sealed (only the server can open them); the list shows names, hosts
 * and what's coming up, so the right one is easy to tell.
 */
export function FindCalendarsForm({
  find,
  add,
  students,
}: {
  find: (prev: FindState, fd: FormData) => Promise<FindState>;
  add: (prev: FeedFormState, fd: FormData) => Promise<FeedFormState>;
  students: Students;
}) {
  const [state, formAction, pending] = useActionState<FindState, FormData>(find, {});
  const hintId = useId();
  return (
    <div className="max-w-lg space-y-3">
      <form action={formAction} className="space-y-2">
        <label className="block">
          <span className={fieldLabel}>The school&apos;s website</span>
          <input
            name="site"
            required
            inputMode="url"
            autoComplete="off"
            placeholder="lincoln-elementary.example"
            className={box}
            aria-describedby={hintId}
          />
        </label>
        <p id={hintId} className="text-xs text-muted-foreground">
          The app looks at the site and its calendar pages for calendars you can subscribe to, and checks each one.
        </p>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Looking… (it can take up to a minute)" : "Find calendars"}
        </button>
      </form>
      <div aria-live="polite" className="space-y-3">
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.outcome === "none" && (
          <p className="text-sm">
            No calendar link on that site that the app could read. Look on its calendar page for &ldquo;Subscribe&rdquo;,
            &ldquo;iCal&rdquo; or &ldquo;Add to calendar&rdquo;, and paste that link below.
          </p>
        )}
        {state.outcome === "blocked" && (
          <p className="text-sm">
            That site only opens in a full browser, so the app can&apos;t look at it. Open its calendar page, copy the
            &ldquo;Subscribe&rdquo; or &ldquo;iCal&rdquo; link, and paste it below.
          </p>
        )}
        {state.outcome === "found" && state.calendars && state.sealed && (
          <>
            <p className="text-sm font-semibold">
              Found {state.calendars.length === 1 ? "one calendar" : `${state.calendars.length} calendars`}. Add the ones you want:
            </p>
            <ul className="space-y-3">
              {state.calendars.map((c, i) => (
                <li key={`${state.sealed}-${i}`} className="rounded-xl bg-card p-3 shadow-sm ring-1 ring-border">
                  <AddFound sealed={state.sealed!} index={i} calendar={c} add={add} students={students} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AddFound({
  sealed,
  index,
  calendar,
  add,
  students,
}: {
  sealed: string;
  index: number;
  calendar: NonNullable<FindState["calendars"]>[number];
  add: (prev: FeedFormState, fd: FormData) => Promise<FeedFormState>;
  students: Students;
}) {
  const [state, formAction, pending] = useActionState<FeedFormState, FormData>(add, {});
  const nameId = useId();
  const forId = useId();
  if (state.notice) return <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.notice}</p>;
  return (
    <form action={formAction} className="space-y-2">
      <p className="text-sm font-bold">{calendar.name}</p>
      <p className="text-xs text-muted-foreground">
        {calendar.host} · {calendar.upcoming} upcoming
      </p>
      {calendar.next.length > 0 && (
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {calendar.next.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <input type="hidden" name="sealed" value={sealed} />
      <input type="hidden" name="index" value={index} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block" htmlFor={nameId}>
          <span className={fieldLabel}>Name</span>
          <input id={nameId} name="name" defaultValue={calendar.name} maxLength={80} className={box} />
        </label>
        <label className="block" htmlFor={forId}>
          <span className={fieldLabel}>For</span>
          <select id={forId} name="kidPersonId" defaultValue="" className={box}>
            <option value="">The whole family</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={pending} className={btn}>
        {pending ? "Adding…" : "Add"}
      </button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
