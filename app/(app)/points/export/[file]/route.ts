import { serveCsvExport } from "@/lib/export";
import { POINTS_EXPORTS } from "../files";

// /points/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "points", POINTS_EXPORTS);
}
