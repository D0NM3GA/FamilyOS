import type { DesiredEvent } from "./events";

/** What's known about an event the app already manages. */
export type LinkState = { sourceKey: string; graphEventId: string | null; contentHash: string; transactionId: string };

export type SyncOp =
  | { kind: "create"; event: DesiredEvent; transactionId: string | null }
  | { kind: "update"; event: DesiredEvent; graphEventId: string }
  | { kind: "delete"; sourceKey: string; graphEventId: string | null };

/**
 * The difference between what the calendar should hold and what the app last put there.
 * A link with no Graph id is a create that never finished (a crash between saving the link
 * and hearing back from Graph): it's retried with its original transactionId, which Graph
 * uses to de-duplicate. Deletes go first, so a capped run frees stale events before adding.
 */
export function planSync(desired: DesiredEvent[], links: LinkState[], maxOps: number): { ops: SyncOp[]; remaining: number } {
  const want = new Map(desired.map((e) => [e.sourceKey, e]));
  const have = new Map(links.map((l) => [l.sourceKey, l]));
  const ops: SyncOp[] = [];

  for (const link of links) {
    if (!want.has(link.sourceKey)) ops.push({ kind: "delete", sourceKey: link.sourceKey, graphEventId: link.graphEventId });
  }
  for (const event of desired) {
    const link = have.get(event.sourceKey);
    if (!link) ops.push({ kind: "create", event, transactionId: null });
    else if (!link.graphEventId) ops.push({ kind: "create", event, transactionId: link.transactionId });
    else if (link.contentHash !== event.hash) ops.push({ kind: "update", event, graphEventId: link.graphEventId });
  }
  return { ops: ops.slice(0, maxOps), remaining: Math.max(0, ops.length - maxOps) };
}

/** Graph account scopes as better-auth stores them (comma-joined; space-joined tolerated). */
export function hasCalendarWriteScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope
    .split(/[\s,]+/)
    .some((s) => s.toLowerCase() === "calendars.readwrite" || s.toLowerCase().endsWith("/calendars.readwrite"));
}
