/**
 * Phase 23's Shop view, the pure parts: the offline check-off queue and how rows split into
 * "to get" and "in the cart". No React, no storage, so it's all unit-tested.
 *
 * Queue model: every tap appends an entry with its own unique id. A flush sends the
 * last op per item, and on success removes exactly the entries it sent (by id), so a tap
 * made while a flush was in flight is never lost. Entries stay until acknowledged, and the
 * page shows rows with pending entries applied on top of the server's rows.
 *
 * Phase 44.2: each entry keeps when it was tapped, and one older than 7 days is dropped when
 * the queue is read (the owner's call), like the Shop list saved for offline use, so a tick
 * can't land on a list weeks later.
 */

export type QueueEntry = { id: string; itemId: string; done: boolean; at: number };

export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Unique across tabs and page instances sharing one stored queue. */
export function newEntryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function enqueue(
  queue: QueueEntry[],
  itemId: string,
  done: boolean,
  id: string = newEntryId(),
  at: number = Date.now(),
): QueueEntry[] {
  return [...queue, { id, itemId, done, at }];
}

/** What goes over the wire: the latest op per item, plus which entries that covers. */
export function wirePayload(queue: QueueEntry[]): { ops: { itemId: string; done: boolean }[]; sentIds: string[] } {
  const last = new Map<string, boolean>();
  for (const e of queue) last.set(e.itemId, e.done);
  return { ops: [...last].map(([itemId, done]) => ({ itemId, done })), sentIds: queue.map((e) => e.id) };
}

export function acknowledge(queue: QueueEntry[], sentIds: string[]): QueueEntry[] {
  const sent = new Set(sentIds);
  return queue.filter((e) => !sent.has(e.id));
}

/** Server rows with the not-yet-synced taps applied. */
export function overlay<T extends { id: string; done: boolean }>(rows: T[], queue: QueueEntry[]): T[] {
  if (queue.length === 0) return rows;
  const last = new Map<string, boolean>();
  for (const e of queue) last.set(e.itemId, e.done);
  return rows.map((r) => (last.has(r.id) ? { ...r, done: last.get(r.id)! } : r));
}

/**
 * Reads a stored queue defensively: anything malformed is dropped, never thrown, and so is
 * anything older than 7 days. An entry stored before entries kept their time counts from now.
 */
export function parseQueue(raw: string | null, now: number = Date.now()): QueueEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (e): e is Omit<QueueEntry, "at"> & { at?: unknown } =>
          typeof e === "object" &&
          e !== null &&
          typeof e.id === "string" &&
          typeof e.itemId === "string" &&
          e.itemId.length > 0 &&
          e.itemId.length <= 64 &&
          typeof e.done === "boolean",
      )
      .map((e) => ({ id: e.id, itemId: e.itemId, done: e.done, at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : now }))
      .filter((e) => now - e.at < QUEUE_MAX_AGE_MS);
  } catch {
    return [];
  }
}

export type ShopRow = {
  id: string;
  name: string;
  size: string | null;
  amount: string;
  emoji: string;
  storeName: string;
  sectionOrder: number;
  forName: string | null;
  done: boolean;
};

export const ALL_STORES = "";

/**
 * Where finishing a trip lands, from the Shop view or the list's own Finish button: the list,
 * with the "Trip saved! 📸 Snap the receipt" note pointing at that trip. Nothing saved (another
 * phone finished first) is just the list.
 */
export function tripSavedHref(purchaseId: string | null): string {
  return purchaseId ? `/groceries?trip=saved&purchase=${encodeURIComponent(purchaseId)}` : "/groceries";
}

/** Splits rows for one store (or all): unchecked in the order you walk, checked in the cart. */
export function splitForShop(rows: ShopRow[], store: string): { toGet: ShopRow[]; inCart: ShopRow[] } {
  const here = store === ALL_STORES ? rows : rows.filter((r) => r.storeName === store);
  const walk = (a: ShopRow, b: ShopRow) => a.sectionOrder - b.sectionOrder || a.name.localeCompare(b.name);
  return {
    toGet: here.filter((r) => !r.done).sort(walk),
    inCart: here.filter((r) => r.done).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The kid's picture tiles: things this kid picked before (most often first), then what the
 * family bought recently, skipping anything already waiting on the list. Ids only; the
 * caller looks the products up.
 */
export function rankKidTiles(opts: {
  kidPicks: string[];
  recent: string[];
  onList: Set<string>;
  limit?: number;
}): string[] {
  const { kidPicks, recent, onList, limit = 12 } = opts;
  const counts = new Map<string, number>();
  for (const id of kidPicks) counts.set(id, (counts.get(id) ?? 0) + 1);
  const mine = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const out: string[] = [];
  for (const id of [...mine, ...recent]) {
    if (onList.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
