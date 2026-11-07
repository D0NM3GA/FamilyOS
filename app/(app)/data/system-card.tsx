import { BACKUP_HEARTBEAT, BACKUP_LATE_MS, JOB_LATE_MS, JOBS, heartbeatState, readHeartbeats, type HeartbeatRow, type HeartbeatState } from "@/lib/heartbeat";

/**
 * Phase 61: did the server's own work happen? Each background job's last good run and last
 * failure, and the host's nightly backup (scripts/backup-prod.sh writes its row). Admins only
 * (the page decides). Times in the household's zone; nothing here names a person.
 */
const STATE: Record<HeartbeatState, { label: string; tone: string }> = {
  ok: { label: "OK", tone: "bg-lime/40" },
  late: { label: "Late", tone: "bg-sun text-ink" },
  failing: { label: "Failing", tone: "bg-tomato text-ink" },
  never: { label: "Not run yet", tone: "bg-muted" },
};

export async function SystemCard({ timeZone }: { timeZone: string | undefined }) {
  const rows = new Map((await readHeartbeats()).map((r) => [r.name, r]));
  const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }) : null);
  const line = (label: string, row: HeartbeatRow | undefined, lateAfter: number) => {
    const state = heartbeatState(row, lateAfter);
    return (
      <li key={label} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
        <span className={`inline-block -rotate-1 rounded-md px-1.5 text-xs font-bold ${STATE[state].tone}`}>{STATE[state].label}</span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {row?.lastOkAt ? `last ran ${when(row.lastOkAt)}` : "no good run yet"}
          {row?.detail && ` · ${row.detail}`}
          {state === "failing" && row?.lastError && ` · failed ${when(row.lastErrorAt)}: ${row.lastError}`}
        </span>
      </li>
    );
  };
  return (
    <section id="system" className="mt-6 scroll-mt-6 rounded-lg bg-card p-4 shadow-sm ring-1 ring-border">
      <h2 className="text-sm font-semibold text-foreground">System</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The server&apos;s own work: jobs every 30 minutes, and the nightly backup on the server once it reports here. Late
        means it hasn&apos;t run when it should have.
      </p>
      <ul className="mt-2 divide-y divide-border text-sm">
        {line("Nightly backup", rows.get(BACKUP_HEARTBEAT), BACKUP_LATE_MS)}
        {JOBS.map((j) => line(j.label, rows.get(j.name), JOB_LATE_MS))}
      </ul>
    </section>
  );
}
