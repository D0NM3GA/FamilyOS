import Link from "next/link";
import { getVehicleRecalls } from "@/lib/vehicles/queries";

const sticker = "inline-flex min-h-11 items-center rounded-full px-3 text-xs font-extrabold text-ink hover:underline sm:min-h-7";

/**
 * The board's per-vehicle recall chip. An async server component rendered inside
 * <Suspense fallback={null}> by the board, so an NHTSA round-trip (up to lib/vehicles/
 * nhtsa.ts's 4s timeout, once a day per vehicle) streams in after the board rather than
 * holding the whole page. Visible to kids too (owner's call). Renders nothing when there's
 * nothing to act on — a missing year/make/model or an NHTSA outage isn't worth a chip.
 */
export async function RecallChip({
  vehicle,
}: {
  vehicle: { id: string; householdId: string; year: number | null; make: string | null; model: string | null };
}) {
  const recalls = await getVehicleRecalls(vehicle);
  const href = `/vehicles/${vehicle.id}#recalls`;

  if (recalls.status === "unknown-make" || recalls.status === "unknown-model") {
    return (
      <Link href={href} className={`${sticker} bg-sun`}>
        Can&apos;t check recalls
      </Link>
    );
  }

  if (recalls.status !== "ok" || recalls.open.length === 0) return null;

  const doNotDrive = recalls.open.some((r) => r.parkIt);
  const parkOutside = recalls.open.some((r) => r.parkOutSide);
  const n = recalls.open.length;

  return (
    <Link href={href} className={`${sticker} bg-tomato`}>
      ⚠ {n} open recall{n === 1 ? "" : "s"}
      {doNotDrive ? " · Do not drive" : parkOutside ? " · Park outside" : ""}
    </Link>
  );
}
