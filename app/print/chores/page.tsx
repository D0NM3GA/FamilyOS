import type { Metadata } from "next";
import { requireActiveProfile } from "@/lib/active-profile";
import { getHouseholdSettings } from "@/lib/household-settings";
import { getHouseholdMembers } from "@/lib/people";
import { prisma } from "@/lib/prisma";
import { addDays, atMidnight } from "@/lib/tasks/schedule";
import { ensureInstancesGenerated } from "@/lib/tasks/instances";
import { formatMonthDay } from "@/lib/format";
import { buildHouseholdGrid, buildPersonCharts, type ChartCell } from "@/lib/chores/chart";
import { getFamilyLook } from "@/lib/household-settings";
import type { FamilyLook } from "@/lib/family-look";
import {
  CheckBox,
  PrintEmpty,
  PrintRow,
  PrintSection,
  PrintShell,
  PrintTable,
  PrintToolbarLink,
  Td,
} from "@/components/print/print-shell";
import { requireAppOn } from "@/lib/app-guard";
import { mascotArt } from "@/lib/bunson-art";

export const metadata: Metadata = { title: "Chore chart" };

const DAYS = 7;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Fridge chore chart for the next 7 days (owner's call: forward-looking, like the board),
 * as one sheet per person (default) or one household grid (?view=grid) — the owner asked for
 * both. Kid-viewable: the chores board has no adult gate and already shows everyone's
 * chores. Built from generated instances (see lib/chores/chart.ts for why not rules), so it
 * generates its own horizon first — the same upsert the board runs on every load —
 * otherwise a chart printed when nobody had opened /chores lately would come out blank.
 */
export default async function ChoresPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; person?: string }>;
}) {
  await requireAppOn("chores");
  const profile = await requireActiveProfile();
  const look = await getFamilyLook(profile.householdId);
  const { view: rawView, person } = await searchParams;
  const view = rawView === "grid" ? "grid" : "kids";

  const start = atMidnight(new Date());
  const end = addDays(start, DAYS);
  await ensureInstancesGenerated(profile.householdId, end, "CHORE");

  const [household, members, instances] = await Promise.all([
    getHouseholdSettings(profile.householdId),
    getHouseholdMembers(profile.householdId),
    prisma.taskInstance.findMany({
      where: {
        definition: { householdId: profile.householdId, domain: "CHORE", active: true },
        dueDate: { gte: start, lt: end },
      },
      // Narrowed: nothing about a Person beyond id + first name belongs on paper.
      select: {
        dueDate: true,
        status: true,
        assignedTo: { select: { id: true, firstName: true } },
        definition: { select: { id: true, title: true, points: true } },
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const dayHead = days.map((d) => (
    <span key={d.getTime()} className="block text-center">
      {DAY_NAMES[d.getDay()]}
      <span className="block font-normal text-stone-500">{formatMonthDay(d.getMonth() + 1, d.getDate())}</span>
    </span>
  ));

  // One kid's sheet still includes the unassigned "Anyone" chores — up for grabs for points.
  const personCharts = buildPersonCharts(instances, start, DAYS).filter(
    (c) => !person || c.personId === person || c.personId == null,
  );
  const grid = view === "grid" ? buildHouseholdGrid(instances, start, DAYS) : [];

  const toolbar = (
    <>
      <PrintToolbarLink href="/print/chores" active={view === "kids" && !person}>
        Everyone, one sheet each
      </PrintToolbarLink>
      {members.map((m) => (
        <PrintToolbarLink key={m.id} href={`/print/chores?person=${m.id}`} active={view === "kids" && person === m.id}>
          {m.firstName}
        </PrintToolbarLink>
      ))}
      <PrintToolbarLink href="/print/chores?view=grid" active={view === "grid"}>
        Household grid
      </PrintToolbarLink>
    </>
  );

  const range = `${formatMonthDay(days[0].getMonth() + 1, days[0].getDate())} – ${formatMonthDay(
    days[DAYS - 1].getMonth() + 1,
    days[DAYS - 1].getDate(),
  )}`;

  return (
    <PrintShell title="Chore chart" subtitle={range} householdName={household.name} backHref="/chores" toolbar={toolbar}>
      <BunsonBanner mascot={look.mascot} rewards={look.reward.many} />

      {view === "grid" ? (
        grid.length === 0 ? (
          <NoChores />
        ) : (
          <PrintSection title="Everyone">
            <PrintTable head={["Chore", ...dayHead]}>
              {grid.map((row) => (
                <PrintRow key={row.definitionId}>
                  <Td className="font-medium">
                    {row.title}
                    {row.points > 0 && <span className="block text-[10px] text-stone-500">{row.points} ⭐</span>}
                  </Td>
                  {row.cells.map((cell, i) => (
                    <Td key={i} className="text-center">
                      {cell.map((c, j) => (
                        <span key={j} className="block whitespace-nowrap">
                          <CheckBox checked={c.done} /> {c.name}
                        </span>
                      ))}
                    </Td>
                  ))}
                </PrintRow>
              ))}
            </PrintTable>
          </PrintSection>
        )
      ) : personCharts.length === 0 ? (
        <NoChores />
      ) : (
        personCharts.map((chart, index) => (
          <PrintSection
            key={chart.personId ?? "anyone"}
            title={chart.personId == null ? "Up for grabs — anyone can do these" : `${chart.name}'s chores`}
            breakBefore={index > 0}
            keepTogether
          >
            <PrintTable head={["Chore", ...dayHead]}>
              {chart.rows.map((row) => (
                <PrintRow key={row.definitionId}>
                  <Td className="font-medium">
                    {row.title}
                    {row.points > 0 && <span className="block text-[10px] text-stone-500">{row.points} ⭐</span>}
                  </Td>
                  {row.cells.map((cell, i) => (
                    <Td key={i} className="text-center">
                      <Boxes cell={cell} />
                    </Td>
                  ))}
                </PrintRow>
              ))}
            </PrintTable>
          </PrintSection>
        ))
      )}
    </PrintShell>
  );
}

function Boxes({ cell }: { cell: ChartCell }) {
  if (cell == null) return null;
  return (
    <span className="inline-flex gap-1">
      {Array.from({ length: cell.due }, (_, i) => (
        <CheckBox key={i} checked={i < cell.done} />
      ))}
    </span>
  );
}

/** The mascot's sign-off, in the family's words; just the tip when the family turned him off. */
function BunsonBanner({ mascot, rewards }: { mascot: FamilyLook["mascot"]; rewards: string }) {
  const tip = `tick a box when it's done — every box earns ${rewards}!`;
  if (!mascot.on) return <p className="mt-4 text-sm text-stone-700">{tip[0].toUpperCase() + tip.slice(1)}</p>;
  return (
    <div className="mt-4 flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- small local pixel art; next/image's srcset blurs it */}
      <img
        src={mascotArt("bunson-idle")}
        alt=""
        width={48}
        height={48}
        className="[image-rendering:pixelated]"
      />
      <p className="text-sm text-stone-700">
        {mascot.name} says: {tip}
      </p>
    </div>
  );
}

function NoChores() {
  return (
    <div className="mt-6">
      <PrintEmpty>No chores scheduled in the next 7 days.</PrintEmpty>
    </div>
  );
}
