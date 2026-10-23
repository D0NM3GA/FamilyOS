"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acknowledge, enqueue, overlay, parseQueue, wirePayload, type QueueEntry } from "@/lib/groceries/shop";
import { syncChecks } from "./actions";

const SEND_TIMEOUT_MS = 10_000;
const RETRY_MS = 15_000;
// After a failure that isn't plain bad signal, keep trying, just less often.
const SLOW_RETRY_MS = 60_000;

export type SyncProblem = null | "waiting" | "stuck";

class SendTimeout extends Error {}

/**
 * The stored queue is the one source of truth when storage works: every page instance and
 * tab reads it fresh before changing it, so a tab (or a page left mid-send) can't overwrite
 * taps it never saw. Storage can be missing or throw (private mode, quota, blocked site
 * data); the queue then lives in this page's memory, which still covers a dead spot.
 */
function storage(key: string) {
  let memory: QueueEntry[] = [];
  const available = (() => {
    try {
      const probe = `${key}.probe`;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  })();
  return {
    read(): QueueEntry[] {
      if (!available) return memory;
      try {
        return parseQueue(localStorage.getItem(key));
      } catch {
        return memory;
      }
    },
    write(queue: QueueEntry[]) {
      memory = queue;
      if (!available) return;
      try {
        if (queue.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(queue));
      } catch {
        // memory only
      }
    },
  };
}

/**
 * Phase 23's offline check-offs. Taps apply instantly (on top of the server's rows) and are
 * queued per household on this device; the queue is sent on load, after a tap, on coming
 * back online or to the foreground, and on a timer while anything waits. See
 * lib/groceries/shop.ts for the queue rules. The action's own revalidation refreshes the
 * page's rows, so no extra refresh is needed here.
 *
 * Plain bad signal (a network error, or a send that hangs past 10 s) just waits. Any other
 * failure (a server hiccup, the app updated while the page sat open, a signed-out profile)
 * shows "couldn't sync yet" with a reload button, and keeps retrying more slowly.
 */
export function useShopQueue<T extends { id: string; done: boolean }>(householdId: string, rows: T[]) {
  const key = `familyos.shopQueue.${householdId}`;
  const [store] = useState(() => storage(key));
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [problem, setProblem] = useState<SyncProblem>(null);
  // Entries just acknowledged keep showing until the refreshed server rows arrive, so a
  // checked item doesn't flicker back for a frame. Successive acks on the same rows add up.
  const [settling, setSettling] = useState<{ rows: T[]; entries: QueueEntry[] } | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const rowsRef = useRef(rows);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const write = useCallback(
    (next: QueueEntry[]) => {
      store.write(next);
      setQueue(next);
    },
    [store],
  );

  const flush = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const pending = store.read();
    setQueue(pending);
    if (pending.length === 0) return;
    inFlight.current = true;
    const { ops, sentIds } = wirePayload(pending);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        syncChecks(ops),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new SendTimeout()), SEND_TIMEOUT_MS);
        }),
      ]);
      const sent = pending;
      setSettling((prev) =>
        prev && prev.rows === rowsRef.current
          ? { rows: prev.rows, entries: [...prev.entries, ...sent] }
          : { rows: rowsRef.current, entries: sent },
      );
      // Re-read: other taps (this page or another tab) may have landed during the send.
      write(acknowledge(store.read(), sentIds));
      setProblem(null);
    } catch (err) {
      // fetch's network failure is a TypeError in every browser (its message differs).
      setProblem(err instanceof TypeError || err instanceof SendTimeout ? "waiting" : "stuck");
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void flushRef.current();
      }
    }
  }, [store, write]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Pick up what an earlier visit left behind (storage is client-only, so after hydration).
  useEffect(() => {
    void flush();
  }, [flush]);

  useEffect(() => {
    const kick = () => {
      if (document.visibilityState === "visible") void flush();
    };
    // Another tab changed the queue: show what's stored now.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setQueue(store.read());
    };
    window.addEventListener("online", kick);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("online", kick);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [flush, key, store]);

  useEffect(() => {
    if (queue.length === 0) return;
    const t = setInterval(() => void flush(), problem === "stuck" ? SLOW_RETRY_MS : RETRY_MS);
    return () => clearInterval(t);
  }, [queue.length, problem, flush]);

  const record = useCallback(
    (itemId: string, done: boolean) => {
      write(enqueue(store.read(), itemId, done));
      void flush();
    },
    [store, write, flush],
  );

  const shown = overlay(rows, settling && settling.rows === rows ? [...settling.entries, ...queue] : queue);
  return { rows: shown, record, pending: queue.length, problem, flush };
}

/** /groceries' quiet reminder: store check-offs still on this phone get sent from here too. */
export function QueueStatus({ householdId }: { householdId: string }) {
  const { pending, problem } = useShopQueue(householdId, []);
  if (pending === 0) return null;
  return (
    <p role="status" className="mt-3 flex flex-wrap items-center gap-x-2 rounded-xl bg-sun/30 px-3 py-2 text-sm font-semibold">
      {pending} check-off{pending === 1 ? "" : "s"} from the store still syncing…
      {problem === "stuck" && (
        <button type="button" onClick={() => location.reload()} className="inline-flex min-h-11 items-center underline sm:min-h-9">
          Reload to try again
        </button>
      )}
    </p>
  );
}
