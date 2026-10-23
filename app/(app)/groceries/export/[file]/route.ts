import { serveCsvExport } from "@/lib/export";
import { GROCERY_EXPORTS } from "@/lib/groceries/export";

// /groceries/export/<name>.csv — see lib/export.ts for auth (adults only) and headers.
export function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  return serveCsvExport(request, params, "groceries", GROCERY_EXPORTS);
}
