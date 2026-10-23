import { serveCsvExport } from "@/lib/export";
import { VEHICLE_EXPORTS } from "@/lib/vehicles/export";

// /vehicles/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "vehicles", VEHICLE_EXPORTS);
}
