import type { Prisma } from "@/app/generated/prisma/client";
import type { WorkItemType } from "./types";

/**
 * Phase 59.1c: the history of a chore, a piece of schoolwork or a school form (WorkItemEvent).
 * Written inside the same transaction as the change it records, so a change and its history
 * can't part. `itemId` has no foreign key, so whatever deletes an item deletes its events too
 * (deleteEventsFor); lib/work-items/events-guard.test.ts finds every delete and checks.
 */

export type EventAction = "STATUS" | "ASSIGN" | "MOVE" | "EDIT" | "GRADE" | "APPROVE" | "PUT_BACK";

export type EventInput = {
  householdId: string;
  itemType: WorkItemType;
  itemId: string;
  actorId: string | null;
  action: EventAction;
  /** For EDIT: which field. */
  field?: string;
  fromValue?: string | null;
  toValue?: string | null;
};

/** Display text only, and never long: a title can be 200 characters, a note never goes in at all. */
export const EVENT_VALUE_MAX = 200;

export function eventValue(v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  // By character, not UTF-16 unit, so an emoji at the cut isn't split in half.
  const chars = Array.from(v);
  return chars.length > EVENT_VALUE_MAX ? `${chars.slice(0, EVENT_VALUE_MAX - 1).join("")}…` : v;
}

type Tx = Pick<Prisma.TransactionClient, "workItemEvent">;

export async function recordEvents(tx: Tx, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  await tx.workItemEvent.createMany({
    data: events.map((e) => ({
      householdId: e.householdId,
      itemType: e.itemType,
      itemId: e.itemId,
      actorId: e.actorId,
      action: e.action,
      field: e.field ?? null,
      fromValue: eventValue(e.fromValue),
      toValue: eventValue(e.toValue),
    })),
  });
}

export async function recordEvent(tx: Tx, event: EventInput): Promise<void> {
  await recordEvents(tx, [event]);
}

/** Every event for these items. Call it in the transaction that deletes them. */
export async function deleteEventsFor(tx: Tx, itemType: WorkItemType, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await tx.workItemEvent.deleteMany({ where: { itemType, itemId: { in: itemIds } } });
}

/** "2026-11-07": a due date in an event, in the family's own day (the server keeps its zone). */
export function eventDate(d: Date | null): string | null {
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
