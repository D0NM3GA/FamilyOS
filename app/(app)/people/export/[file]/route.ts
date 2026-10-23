import { serveCsvExport } from "@/lib/export";
import { PEOPLE_EXPORTS } from "../files";

// /people/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "people", PEOPLE_EXPORTS);
}
