import { serveCsvExport } from "@/lib/export";
import { SCHOOL_EXPORTS } from "@/lib/school/export";

// /school/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "school", SCHOOL_EXPORTS);
}
