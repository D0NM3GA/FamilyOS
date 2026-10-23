"use client";

import { useState, useTransition } from "react";
import { formatRelative } from "@/lib/format";
import type { OrderAction } from "@/lib/store/rules";
import { btn, btnPrimary, field } from "@/components/styles";
import { handleOrder } from "./actions";
import { RewardWord } from "@/components/family-look";

const okBtn =
  "inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-ink bg-lime px-3 text-sm font-extrabold text-ink transition disabled:opacity-50 sm:min-h-9";

export type OpenOrder = {
  id: string;
  title: string;
  emoji: string | null;
  cost: number;
  status: "WAITING_OK" | "TO_DO" | "DELIVERED" | "REFUNDED" | "DECLINED";
  createdAt: Date;
  who: string;
};

/**
 * Phase 20 grown-ups' "Orders to make happen". Needs-OK orders get OK / Not now; to-do
 * orders get Delivered / Refund. Decline and refund give the stickers back and take an
 * optional short note the kid sees on their tracker.
 */
export function OrdersPanel({ orders }: { orders: OpenOrder[] }) {
  if (orders.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">Nothing waiting. Everyone&apos;s rewards are handed out.</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {orders.map((o) => (
        <OrderRow key={o.id} order={o} />
      ))}
    </ul>
  );
}

function OrderRow({ order }: { order: OpenOrder }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<OrderAction | null>(null);
  const [note, setNote] = useState("");

  function act(action: OrderAction, withNote?: string) {
    setError(null);
    start(async () => {
      const res = await handleOrder(order.id, action, withNote);
      if (res.error) setError(res.error);
      setNoteFor(null);
    });
  }

  const waiting = order.status === "WAITING_OK";

  return (
    <li className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl" aria-hidden>
          {order.emoji ?? "🎁"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words">
            {order.who} {waiting ? "wants" : "bought"} {order.title}
          </p>
          <p className="text-xs text-muted-foreground">
            ⭐ {order.cost} · {formatRelative(order.createdAt)}
            {waiting && <> · needs your OK (<RewardWord /> on hold)</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {waiting ? (
            <>
              <button type="button" disabled={pending} onClick={() => act("approve")} className={okBtn}>
                OK
              </button>
              <button type="button" disabled={pending} onClick={() => setNoteFor("decline")} className={btn}>
                Not now
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => act("deliver")} className={okBtn}>
                Delivered
              </button>
              <button type="button" disabled={pending} onClick={() => setNoteFor("refund")} className={btn}>
                Refund
              </button>
            </>
          )}
        </div>
      </div>
      {noteFor && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(noteFor, note);
          }}
        >
          <label className="sr-only" htmlFor={`note-${order.id}`}>
            Note for {order.who} (optional)
          </label>
          <input
            id={`note-${order.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder={`A note for ${order.who} (optional)`}
            className={`${field} min-w-0 flex-1`}
          />
          <button type="submit" disabled={pending} className={btnPrimary}>
            {noteFor === "decline" ? <>Give <RewardWord /> back</> : <>Refund <RewardWord /></>}
          </button>
          <button type="button" onClick={() => setNoteFor(null)} className={btn}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
