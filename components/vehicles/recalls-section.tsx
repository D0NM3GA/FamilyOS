import Link from "next/link";
import { getVehicleRecalls } from "@/lib/vehicles/queries";
import { formatFullDate, formatISODate } from "@/lib/vehicles/format";
import type { Recall } from "@/lib/vehicles/nhtsa";
import { acknowledgeRecall, unacknowledgeRecall } from "@/app/(app)/vehicles/actions";
import { SmallActionButton } from "./small-action-button";
import { VinRecallCheck } from "./vin-recall-check";

type Vehicle = { id: string; householdId: string; year: number | null; make: string | null; model: string | null; vin?: string | null };

/**
 * The detail page's NHTSA recalls section — async, rendered inside <Suspense> so the rest
 * of the page doesn't wait on NHTSA. The one hard rule (see lib/vehicles/nhtsa.ts): never
 * say "no open recalls" unless the lookup actually ran against a model NHTSA recognizes.
 */
export async function RecallsSection({
  vehicle,
  viewerIsAdult,
  canAcknowledge,
}: {
  vehicle: Vehicle;
  viewerIsAdult: boolean;
  /** Adult AND the vehicle is active — inactive vehicles are read-only. */
  canAcknowledge: boolean;
}) {
  const recalls = await getVehicleRecalls(vehicle);
  const editLink = viewerIsAdult ? (
    <>
      {" "}
      <Link href={`/vehicles/${vehicle.id}/edit`} className="font-medium text-brand-text hover:underline">
        Edit vehicle
      </Link>
    </>
  ) : null;

  switch (recalls.status) {
    case "not-configured":
      return <Note>Add the year, make, and model to check for NHTSA safety recalls.{editLink}</Note>;
    case "unavailable":
      return <Note>Couldn&apos;t reach NHTSA to check recalls right now — try again later.</Note>;
    case "unknown-make":
      return (
        <Note tone="warn">
          NHTSA doesn&apos;t recognize the make &ldquo;{vehicle.make}&rdquo; for {vehicle.year}, so recalls
          couldn&apos;t be checked.{editLink}
        </Note>
      );
    case "unknown-model":
      return (
        <Note tone="warn">
          NHTSA doesn&apos;t list a {vehicle.year} {vehicle.make} &ldquo;{vehicle.model}&rdquo;, so recalls
          couldn&apos;t be checked — NHTSA uses its own model names.
          {recalls.suggestions.length > 0 && (
            <> Did you mean: {recalls.suggestions.map((s) => `“${s}”`).join(", ")}?</>
          )}
          {editLink}
        </Note>
      );
  }

  const { open, handled } = recalls;
  return (
    <div className="space-y-3">
      {open.length === 0 ? (
        <Note tone="ok">No open NHTSA recalls for the {vehicle.year} {vehicle.make} {vehicle.model}.</Note>
      ) : (
        <ul className="space-y-2">
          {open.map((r) => (
            <RecallCard
              key={r.campaignNumber}
              recall={r}
              action={
                canAcknowledge ? (
                  <SmallActionButton
                    action={acknowledgeRecall.bind(null, vehicle.id, r.campaignNumber)}
                    label="Mark handled"
                    ariaLabel={`Mark handled: NHTSA #${r.campaignNumber}`}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}

      {handled.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-3 text-sm font-bold sm:py-1">Marked handled ({handled.length})</summary>
          <ul className="mt-2 space-y-2">
            {handled.map((r) => (
              <RecallCard
                key={r.campaignNumber}
                recall={r}
                muted
                footnote={`Marked handled ${formatFullDate(r.acknowledgedAt)}`}
                action={
                  canAcknowledge ? (
                    <SmallActionButton
                      action={unacknowledgeRecall.bind(null, vehicle.id, r.campaignNumber)}
                      label="Un-mark"
                      ariaLabel={`Un-mark NHTSA #${r.campaignNumber}`}
                    />
                  ) : null
                }
              />
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted-foreground">
        Recalls are listed by model, not by your specific car — &ldquo;Mark handled&rdquo; is the family&apos;s own
        note that it&apos;s been fixed or doesn&apos;t apply. Source: NHTSA.
      </p>
      {vehicle.vin && <VinRecallCheck vin={vehicle.vin} />}
    </div>
  );
}

function RecallCard({
  recall,
  action,
  muted,
  footnote,
}: {
  recall: Recall;
  action: React.ReactNode;
  muted?: boolean;
  footnote?: string;
}) {
  return (
    <li className={`rounded-xl bg-card p-3 shadow-sm ring-1 ring-border ${muted ? "opacity-70" : ""}`}>
      {/* The button drops under the text on a phone instead of squeezing it into a sliver. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
            {recall.component || "Recall"}
            {recall.parkIt && <Badge>Do not drive</Badge>}
            {!recall.parkIt && recall.parkOutSide && <Badge>Park outside</Badge>}
            {recall.overTheAirUpdate && (
              <span className="inline-block -rotate-1 rounded-md bg-muted px-1.5 text-xs font-bold text-muted-foreground">
                Over-the-air fix
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            NHTSA #{recall.campaignNumber}
            {recall.reportReceivedDate ? ` · ${formatISODate(recall.reportReceivedDate)}` : ""}
            {footnote ? ` · ${footnote}` : ""}
          </p>
          {recall.summary && <p className="mt-1 text-xs text-foreground">{recall.summary}</p>}
          {recall.consequence && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Risk:</span> {recall.consequence}
            </p>
          )}
          {recall.remedy && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Fix:</span> {recall.remedy}
            </p>
          )}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
    </li>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-block -rotate-1 rounded-md bg-tomato px-1.5 text-xs font-bold text-ink">{children}</span>;
}

function Note({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "ok" }) {
  const toneClass =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-300"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-muted-foreground";
  return <p className={`text-sm ${toneClass}`}>{children}</p>;
}
