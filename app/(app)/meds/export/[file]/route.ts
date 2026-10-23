import { serveCsvExport } from "@/lib/export";
import { MED_EXPORTS } from "@/lib/meds/export";

// /meds/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "meds", MED_EXPORTS);
}
