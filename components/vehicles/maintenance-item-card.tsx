"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import type { VehicleFormState } from "@/app/(app)/vehicles/actions";
import { btn, btnPrimary, field, fieldLabel, iconBtn } from "@/components/styles";

export type MaintenanceItem = {
  id: string;
  title: string;
  notes: string | null;
  status: "OVERDUE" | "UPCOMING" | "OK" | "UNKNOWN";
  intervalLabel: string;
  lastDoneLabel: string;
  /** Precomputed server-side (see lib/vehicles/format.ts) — never format dates in here. */
  dueDetail: string | null;
  /** Whether at least one service log exists — gates showing the Undo control. */
  hasHistory: boolean;
  currentMileageLabel: string;
  /** What one service uses from the garage supplies (Phase 12.5), pre-formatted. */
  supplies: { label: string; onHand: string | null; low: boolean }[];
  /** Phase 65b: paperwork is renewed, not serviced: no miles, and its due day moves on. */
  paperwork?: boolean;
};

const sticker = "inline-block -rotate-1 rounded-md px-1.5 text-xs font-bold";

const STATUS_STYLE: Record<MaintenanceItem["status"], { pill: string; label: string }> = {
  OVERDUE: { pill: "bg-tomato text-ink", label: "Overdue" },
  UPCOMING: { pill: "bg-sun text-ink", label: "Due soon" },
  OK: { pill: "bg-lime/40", label: "OK" },
  UNKNOWN: { pill: "bg-muted", label: "Not logged yet" },
};

type LogDoneAction = (prevState: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

/**
 * One maintenance item on the vehicle board. Not a fork of components/tasks/task-instance-card.tsx
 * — that card's shape (dueDate/status/assignedTo/points) doesn't fit a mileage-driven item
 * with no assignee, so this is its own small component (viewer-gated the same way: only an
 * adult sees the log/undo controls, mirroring viewerIsAdult on that card).
 */
export function MaintenanceItemCard({
  item,
  viewerIsAdult,
  logDone,
  undoLast,
  todayInputValue,
  prefill,
}: {
  item: MaintenanceItem;
  viewerIsAdult: boolean;
  logDone: LogDoneAction;
  undoLast: () => Promise<void>;
  /** "YYYY-MM-DD" for today, precomputed server-side for the date input's default. */
  todayInputValue: string;
  /** Phase 63b: a Money charge sent to Cars: the service form opens with its cost and day. */
  prefill?: { cost: string; date: string };
}) {
  const [formOpen, setFormOpen] = useState(false);
  // Bumped every time the form re-opens and used as the form's key, so each open gets a
  // fresh LogServiceForm instance (fresh useActionState) instead of carrying a stale error
  // over from a previous attempt this same card session.
  const [formInstance, setFormInstance] = useState(0);
  // "Logged ✓", or what else it did (low supplies onto the grocery list), for a moment.
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const [undoPending, startUndoTransition] = useTransition();

  useEffect(() => {
    if (!justLogged) return;
    const t = setTimeout(() => setJustLogged(null), justLogged === "Logged ✓" ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [justLogged]);

  function openForm() {
    setFormInstance((n) => n + 1);
    setFormOpen(true);
  }

  const style = STATUS_STYLE[item.status];

  return (
    <li className="ui-card rounded-xl bg-card p-3 shadow-sm ring-1 ring-border">
      {/* The buttons drop under the text on a phone instead of squeezing the title. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
            {item.title}
            <span className={`${sticker} ${style.pill}`}>{style.label}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.intervalLabel} · {item.lastDoneLabel}
          </p>
          {item.dueDetail && <p className="mt-0.5 text-xs text-muted-foreground">{item.dueDetail}</p>}
          {item.notes && <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>}
          {item.supplies.length > 0 && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>Uses</span>
              {item.supplies.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1">
                  {s.label}
                  {s.onHand != null && <span>({s.onHand} on hand)</span>}
                  {s.low && <span className={`${sticker} bg-sun text-ink`}>Low</span>}
                </span>
              ))}
            </p>
          )}
          {justLogged && (
            <p role="status" className="mt-1 text-xs font-bold text-emerald-600">
              {justLogged}
            </p>
          )}
        </div>

        {viewerIsAdult && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={formOpen}
              onClick={() => (formOpen ? setFormOpen(false) : openForm())}
              className={item.status === "OK" ? btn : btnPrimary}
            >
              {item.paperwork ? "Renewed" : "Log service"}
              <span className="sr-only"> {item.title}</span>
            </button>
            {item.hasHistory && (
              <button
                type="button"
                title={item.paperwork ? "Undo the last renewal (its due day moves back)" : "Undo last logged service (does not revert the vehicle's odometer if it was bumped)"}
                aria-label={item.paperwork ? `Undo the last ${item.title} renewal` : `Undo last ${item.title} service`}
                disabled={undoPending}
                onClick={() => {
                  const question = item.paperwork
                    ? `Undo the last ${item.title} renewal? Its due day moves back.`
                    : `Undo the last ${item.title} service? Supplies it used go back on the shelf; the odometer stays as it is.`;
                  if (!window.confirm(question)) return;
                  startUndoTransition(() => undoLast());
                }}
                className={`${iconBtn} ring-1 ring-border disabled:opacity-50`}
              >
                <Undo2 size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {formOpen && viewerIsAdult && (
        <LogServiceForm
          key={formInstance}
          logDone={logDone}
          todayInputValue={todayInputValue}
          prefill={prefill}
          currentMileageLabel={item.currentMileageLabel}
          usesSupplies={item.supplies.length > 0}
          paperwork={item.paperwork}
          onCancel={() => setFormOpen(false)}
          onSuccess={(notice) => {
            setFormOpen(false);
            setJustLogged(notice ?? "Logged ✓");
          }}
        />
      )}
    </li>
  );
}

/**
 * Split out from MaintenanceItemCard so it can be remounted (via the `key` on its usage
 * above) each time the log form re-opens — a fresh `useActionState` per mount is the
 * simplest way to guarantee a previous attempt's `{ error }` never survives into the next.
 */
function LogServiceForm({
  logDone,
  todayInputValue,
  prefill,
  currentMileageLabel,
  usesSupplies,
  paperwork,
  onCancel,
  onSuccess,
}: {
  logDone: LogDoneAction;
  todayInputValue: string;
  prefill?: { cost: string; date: string };
  currentMileageLabel: string;
  usesSupplies: boolean;
  paperwork?: boolean;
  onCancel: () => void;
  onSuccess: (notice?: string) => void;
}) {
  const [state, formAction, pending] = useActionState(logDone, {});
  // Phase 12.5 (owner's call): a service done today takes its supplies from stock; one typed
  // in from an old receipt usually didn't use today's oil. Follows the date, overridable.
  const [takeSupplies, setTakeSupplies] = useState(!prefill || prefill.date === todayInputValue);
  const wasPending = useRef(false);
  const id = useId();

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) onSuccess(state.notice);
    }
    // onSuccess is a fresh closure each render; only re-run this effect off pending/error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error]);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <div>
        <label htmlFor={`${id}-date`} className={`block ${fieldLabel}`}>
          Date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          name="doneAt"
          defaultValue={prefill?.date ?? todayInputValue}
          max={todayInputValue}
          onChange={(e) => setTakeSupplies(e.target.value === todayInputValue)}
          className={`mt-1 ${field}`}
        />
      </div>
      {!paperwork && (
      <div>
        <label htmlFor={`${id}-mileage`} className={`block ${fieldLabel}`}>
          Mileage
        </label>
        <input
          id={`${id}-mileage`}
          type="number"
          name="mileage"
          placeholder={currentMileageLabel}
          className={`mt-1 w-28 ${field}`}
        />
      </div>
      )}
      <div>
        <label htmlFor={`${id}-cost`} className={`block ${fieldLabel}`}>
          Cost (optional)
        </label>
        <input
          id={`${id}-cost`}
          type="text"
          name="cost"
          inputMode="decimal"
          placeholder="$0.00"
          defaultValue={prefill?.cost}
          className={`mt-1 w-24 ${field}`}
        />
      </div>
      <div className="min-w-[8rem] flex-1">
        <label htmlFor={`${id}-notes`} className={`block ${fieldLabel}`}>
          Notes (optional)
        </label>
        <input
          id={`${id}-notes`}
          type="text"
          name="notes"
          placeholder="e.g. Parker Auto receipt"
          className={`mt-1 w-full ${field}`}
        />
      </div>
      {usesSupplies && (
        <label className="flex min-h-11 w-full items-center gap-2 text-sm text-muted-foreground sm:min-h-0">
          <input
            type="checkbox"
            name="takeSupplies"
            value="1"
            checked={takeSupplies}
            onChange={(e) => setTakeSupplies(e.target.checked)}
            className="size-4"
          />
          Took its supplies from the garage stock
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={btn}>
          Cancel
        </button>
      </div>
      {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
