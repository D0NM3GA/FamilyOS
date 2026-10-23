import { notFound } from "next/navigation";
import { visibleApps } from "@/lib/apps";
import { personColor } from "@/lib/person-color";
import { NavProvider } from "@/app/(app)/nav-context";
import { AppLauncher } from "@/app/(app)/app-launcher";
import { BottomBar, NavRail } from "@/app/(app)/nav-rail";
import { TopBar } from "@/app/(app)/top-bar";
import { BigHome } from "@/app/(app)/big-home";
import { BunsonMoment } from "@/components/bunson-moment";
import { MOMENT_LINES } from "@/lib/bunson-moments";
import { previewNoop as noop } from "./actions";

const sampleChore = (id: string, title: string, status: "PENDING" | "DONE", who: string) => ({
  id,
  dueDate: new Date("2026-10-03T12:00:00Z"),
  status,
  completedAt: status === "DONE" ? new Date("2026-10-03T13:00:00Z") : null,
  definition: { title, points: 5 },
  assignedTo: { id: who, firstName: "Ivy", lastName: null },
  completedBy: status === "DONE" ? { id: who, firstName: "Ivy" } : null,
});

// Phase 19 harness: the app shell (launcher, rail, bottom bar) with fake data, for
// screenshots without the Entra sign-in round-trip. Dev only, like dev-preview/bunson.
// Render-only: pinning here calls the real server action, which needs a signed-in profile.
export default async function ShellPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; view?: string; bunson?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const kid = params.kid === "1";
  const big = params.view === "big";
  const volume = params.bunson === "off" ? "OFF" : params.bunson === "cheers" ? "CHEERS" : "CHATTY";
  const id = kid ? "preview-kid" : "preview-mom";

  return (
    <NavProvider personId={id} apps={visibleApps(!kid, [])}>
      <div
        data-app-root
        data-view={big ? "BIG" : "FULL"}
        data-bunson-volume={volume}
        className={`flex h-dvh flex-col overflow-hidden [--bottom-bar-h:0px] max-md:pb-[var(--bottom-bar-h)] ${
          big ? "max-md:[--bottom-bar-h:5rem]" : "max-md:[--bottom-bar-h:4.25rem]"
        }`}
      >
        <TopBar
          personId={id}
          activeName={kid ? "Ivy" : "Mom"}
          hasPhoto={false}
          color={personColor({ id, color: kid ? "SKY" : "TOMATO" })}
        />
        <AppLauncher />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NavRail />
          <main id="main" className="min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted">
            {big ? (
              <BigHome
                viewerId={id}
                viewerIsAdult={!kid}
                greeting="Morning, Ivy! 2 stickers to grab today."
                choresOn
                stickers={42}
                chores={[
                  sampleChore("c1", "Feed the cat", "PENDING", id),
                  sampleChore("c2", "Make your bed", "PENDING", id),
                  sampleChore("c3", "Unload dishwasher", "DONE", id),
                ]}
                meds={[sampleChore("m1", "Vitamin D", "PENDING", id)]}
                medTimes={{ m1: "8:00 AM" }}
                overdueMedIds={[]}
                school={[]}
                onCompleteChore={noop}
                onUndoChore={noop}
                onCompleteMed={noop}
                onUndoMed={noop}
              />
            ) : (
              <div className="p-6">
                <BunsonMoment kind="chatty" text="Afternoon, Mom! 3 stickers to grab today." />
                <div className="mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
                  {["Today", "This week"].map((t) => (
                    <div key={t} className="rounded-2xl bg-card p-4 shadow-[3px_3px_0_rgb(31_41_51/0.12)] ring-1 ring-border">
                      <h2 className="text-lg font-bold">{t}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">Sample card on the graph paper.</p>
                      <button className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
                        Primary action
                      </button>
                    </div>
                  ))}
                </div>
                <BunsonMoment kind="cheer" text={MOMENT_LINES.choresDone} className="mt-6" />
              </div>
            )}
          </main>
        </div>
        <BottomBar />
      </div>
    </NavProvider>
  );
}
