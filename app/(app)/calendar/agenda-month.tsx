import Link from "next/link";
import { dayKey, weekStartOf, type AgendaDay } from "@/lib/calendar/agenda";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN = 3;

/** A month at a glance: what's happening each day, each cell opening that day in its week. */
export function AgendaMonth({ days, month, notes = [], whoQuery = "" }: { days: AgendaDay[]; month: Date; notes?: React.ReactNode[]; whoQuery?: string }) {
  // No row that's all next month.
  const lastInMonth = days.findLastIndex((day) => day.date.getMonth() === month.getMonth());
  const shown = days.slice(0, (Math.floor(lastInMonth / 7) + 1) * 7);
  return (
    <>
      {notes.map((note, i) => (
        <p key={i} className="mt-3 text-xs text-muted-foreground">
          {note}
        </p>
      ))}
      <div aria-hidden className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-bold text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <ul className="mt-1 grid grid-cols-7 gap-1">
        {shown.map((day) => {
          const inMonth = day.date.getMonth() === month.getMonth();
          const count = day.items.length;
          const titles = day.items.map((item) => item.title).join(", ");
          const label = `${day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${titles || "nothing"}`;
          return (
            <li key={day.key} className="min-w-0">
              <Link
                href={`/calendar?week=${dayKey(weekStartOf(day.date))}${whoQuery}#day-${day.key}`}
                aria-label={label}
                aria-current={day.isToday ? "date" : undefined}
                className={`flex h-full min-h-14 flex-col rounded-lg p-1 ring-1 ring-border transition hover:bg-muted aria-[current=date]:ring-2 aria-[current=date]:ring-ink dark:aria-[current=date]:ring-sun sm:min-h-24 ${inMonth ? "bg-card" : "bg-transparent"}`}
              >
                <span className={`text-xs font-bold ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>{day.date.getDate()}</span>
                {count > 0 && (
                  <span aria-hidden className="mt-auto text-xs font-bold text-brand-text sm:hidden">
                    {count}
                  </span>
                )}
                <span aria-hidden className="mt-0.5 hidden min-w-0 flex-col gap-0.5 sm:flex">
                  {day.items.slice(0, SHOWN).map((item) => (
                    <span key={item.key} className="truncate text-xs text-foreground">
                      {item.emoji} {item.title}
                    </span>
                  ))}
                  {count > SHOWN && <span className="text-xs font-bold text-muted-foreground">+{count - SHOWN}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
