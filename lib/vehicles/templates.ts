/**
 * Common maintenance items offered as one-click starters for a new vehicle. Generic
 * defaults, not manufacturer schedules — the templates page says to check the owner's
 * manual, and every item is editable after it's created. A static list, not a DB model:
 * there's nothing per-household to store until someone edits a created item, at which
 * point it's an ordinary VehicleMaintenanceItem.
 */
export type MaintenanceTemplate = {
  key: string;
  title: string;
  intervalMiles: number | null;
  intervalMonths: number | null;
};

export const MAINTENANCE_TEMPLATES: readonly MaintenanceTemplate[] = [
  { key: "oil", title: "Oil change", intervalMiles: 5000, intervalMonths: 6 },
  { key: "rotation", title: "Tire rotation", intervalMiles: 7500, intervalMonths: null },
  { key: "engine-air", title: "Engine air filter", intervalMiles: 15000, intervalMonths: 12 },
  { key: "cabin-air", title: "Cabin air filter", intervalMiles: 15000, intervalMonths: 12 },
  { key: "wipers", title: "Wiper blades", intervalMiles: null, intervalMonths: 12 },
  { key: "battery", title: "Battery check", intervalMiles: null, intervalMonths: 12 },
  { key: "brake-fluid", title: "Brake fluid", intervalMiles: null, intervalMonths: 24 },
  { key: "coolant", title: "Coolant flush", intervalMiles: 60000, intervalMonths: 60 },
  { key: "transmission", title: "Transmission fluid", intervalMiles: 60000, intervalMonths: null },
  { key: "spark-plugs", title: "Spark plugs", intervalMiles: 60000, intervalMonths: null },
];

/**
 * The templates to create from a submitted selection, skipping any whose title the vehicle
 * already has (case-insensitive, trimmed) and any unknown key. Pure, so the "don't
 * duplicate an existing item" rule is testable without Prisma.
 */
export function selectTemplates(keys: readonly string[], existingTitles: readonly string[]): MaintenanceTemplate[] {
  const wanted = new Set(keys);
  const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return MAINTENANCE_TEMPLATES.filter((t) => wanted.has(t.key) && !existing.has(t.title.toLowerCase()));
}
