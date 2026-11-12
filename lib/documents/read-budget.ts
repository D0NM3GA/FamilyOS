/**
 * How many documents a household may send to Document Intelligence in an hour (after the
 * 2026-11-11 review): each read is billed by Azure, and a stuck retry loop or a script on a
 * grown-up's session could otherwise run up the bill. Thirty an hour is far more than a
 * family's receipts. Kept in memory: the app runs as one server, and a restart only resets
 * the count.
 */
export const READS_PER_HOUR = 30;
const HOUR = 60 * 60_000;

const reads = new Map<string, number[]>();

/** Counts one read for `key` if it fits in the last hour's budget; false when it doesn't. */
export function takeRead(key: string, now: number = Date.now()): boolean {
  const recent = (reads.get(key) ?? []).filter((t) => t > now - HOUR);
  if (recent.length >= READS_PER_HOUR) {
    reads.set(key, recent);
    return false;
  }
  recent.push(now);
  reads.set(key, recent);
  return true;
}

/** Tests only. */
export function resetReadBudget() {
  reads.clear();
}
