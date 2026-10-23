import { serveCsvExport } from "@/lib/export";
import { CHORE_EXPORTS } from "@/lib/chores/export";

// /chores/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "chores", CHORE_EXPORTS);
}
