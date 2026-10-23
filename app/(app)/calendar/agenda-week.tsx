import { Fragment } from "react";
import Link from "next/link";
import { formatMonthDay } from "@/lib/format";
import { AwayTime } from "@/components/away-time";
import { emptyDayLine, isLate, timeLabel, type AgendaDay, type AgendaItem, type AgendaKind } from "@/lib/calendar/agenda";

/**
 * One week of the family agenda: a day-by-day list on phones that becomes seven columns
 * on wide screens. The same markup either way, so there's one list to keep right. Server
 * rendered, no client JS.
 */

/** A stripe colour per kind, so a busy day can be scanned by what's on it. */
const KIND_LOOK: Record<AgendaKind, { stripe: string; label: string }> = {
  date: { stripe: "border-l-pink-400", label: "Important date" },
  outlook: { stripe: "border-l-grape", label: "Outlook" },
  schoolEvent: { stripe: "border-l-orange-400", label: "School calendar" },
  school: { stripe: "border-l-orange-400", label: "School to-do" },
  homework: { stripe: "border-l-sky", label: "Homework" },
  vehicle: { stripe: "border-l-teal-400", label: "Car" },
  med: { stripe: "border-l-tomato", label: "Med" },
  chore: { stripe: "border-l-sun", label: "Chore" },
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function AgendaWeek({ days, notes = [] }: { days: AgendaDay[]; notes?: React.ReactNode[] }) {
  return (
    <>
      {notes.length > 0 && (
        <div className="mt-3 space-y-1" aria-live="polite">
          {notes.map((note, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-7 xl:gap-2">
        {days.map((day) => (
          <DayCard key={day.key} day={day} />
        ))}
      </div>
    </>
  );
}

function DayCard({ day }: { day: AgendaDay }) {
  const weekday = WEEKDAYS[day.date.getDay()];
  const headingId = `day-${day.key}`;
  return (
    <section
      id={day.isToday ? "today" : undefined}
      aria-labelledby={headingId}
      className={`min-w-0 scroll-mt-4 rounded-2xl p-3 ${
        day.isToday
          ? "border-2 border-ink bg-card shadow-[3px_3px_0_var(--color-ink)] dark:border-sun dark:shadow-none"
          : `ring-1 ring-border ${day.isPast ? "bg-card/60" : "bg-card"}`
      }`}
    >
      <h3 id={headingId} className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-heading text-lg font-extrabold leading-tight ${day.isPast ? "text-muted-foreground" : "text-foreground"}`}>
          <span className="xl:hidden">{weekday}</span>
          <span className="hidden xl:inline">{weekday.slice(0, 3)}</span>
        </span>
        <span className="text-sm font-bold text-muted-foreground">{formatMonthDay(day.date.getMonth() + 1, day.date.getDate())}</span>
        {day.isToday && <span className="ml-auto -rotate-2 rounded-md bg-sun px-2 text-xs font-extrabold text-ink">Today</span>}
      </h3>
      {day.items.length === 0 ? (
        <p className="mt-1 font-hand text-lg leading-snug text-muted-foreground">{emptyDayLine(day)}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {day.items.map((item) => (
            <ItemRow key={item.key} item={item} late={isLate(item, day)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A household day and clock time as an instant: the server keeps the household's time (Phase 49). */
function atClock(day: string, minutes: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

function ItemRow({ item, late }: { item: AgendaItem; late: boolean }) {
  const look = KIND_LOOK[item.kind];
  const meta: React.ReactNode[] = [];
  if (item.minutes != null) {
    meta.push(
      <span className="font-bold text-foreground">
        {timeLabel(item.minutes)}
        <AwayTime at={atClock(item.day, item.minutes)} />
      </span>,
    );
  }
  if (item.who) meta.push(item.who);
  if (item.note) meta.push(item.note);
  if (item.status === "done") meta.push("done ✓");
  if (item.status === "skipped") meta.push("skipped");
  if (late) meta.push(<span className="font-bold text-destructive">not done</span>);

  const body = (
    <>
      <span aria-hidden className="text-base leading-6">
        {item.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{look.label}: </span>
        <span className={`block break-words font-bold leading-snug text-foreground ${item.status === "done" ? "line-through decoration-2" : ""}`}>
          {item.title}
        </span>
        {meta.length > 0 && (
          <span className="block break-words text-xs text-muted-foreground">
            {meta.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {part}
              </Fragment>
            ))}
          </span>
        )}
      </span>
    </>
  );
  const className = `flex min-h-11 items-start gap-2 rounded-lg border-l-4 ${look.stripe} bg-muted/60 px-2 py-1.5 text-sm sm:min-h-9 ${
    item.status === "open" ? "" : "opacity-60"
  } ${item.href ? "transition hover:bg-muted" : ""}`;

  return (
    <li>
      {!item.href ? (
        <div className={className}>{body}</div>
      ) : item.external ? (
        <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
          {body}
          <span className="sr-only"> (opens in Outlook)</span>
        </a>
      ) : (
        <Link href={item.href} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}
