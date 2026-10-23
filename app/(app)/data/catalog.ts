import type { CsvExport } from "@/lib/export";
import { CHORE_EXPORTS } from "@/lib/chores/export";
import { GROCERY_EXPORTS } from "@/lib/groceries/export";
import { MED_EXPORTS } from "@/lib/meds/export";
import { VEHICLE_EXPORTS } from "@/lib/vehicles/export";
import { SCHOOL_EXPORTS } from "@/lib/school/export";
import { PEOPLE_EXPORTS } from "@/app/(app)/people/export/files";
import { POINTS_EXPORTS } from "@/app/(app)/points/export/files";

/**
 * Every CSV export in the app, for the /data page (Phase 16). A cross-domain aggregator
 * like lib/search.ts: it imports every domain's export registry on purpose, so it's left
 * out of eslint.config.mjs's domain zones and listed in AGGREGATOR_IMPORT_PATTERNS instead
 * (no single domain may import it back).
 */
export type ExportGroup = { domain: string; title: string; files: { name: string; href: string; entry: CsvExport }[] };

const DOMAINS: { domain: string; title: string; registry: Record<string, CsvExport> }[] = [
  { domain: "people", title: "People", registry: PEOPLE_EXPORTS },
  { domain: "chores", title: "Chores", registry: CHORE_EXPORTS },
  { domain: "points", title: "Store", registry: POINTS_EXPORTS },
  { domain: "meds", title: "Meds", registry: MED_EXPORTS },
  { domain: "groceries", title: "Groceries", registry: GROCERY_EXPORTS },
  { domain: "vehicles", title: "Vehicles", registry: VEHICLE_EXPORTS },
  { domain: "school", title: "School", registry: SCHOOL_EXPORTS },
];

export function exportCatalog(): ExportGroup[] {
  return DOMAINS.map(({ domain, title, registry }) => ({
    domain,
    title,
    files: Object.entries(registry).map(([name, entry]) => ({ name, href: `/${domain}/export/${name}.csv`, entry })),
  }));
}
