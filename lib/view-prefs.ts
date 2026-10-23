import type { BunsonVolume, ViewMode } from "@/app/generated/prisma/enums";

/**
 * Phase 19.5: a person's view, Big buttons or Full app. Null means the role default: kids
 * (and role-less members) start on Big buttons, grown-ups on the full app. Client-safe on
 * purpose (type-only Prisma import), so callers pass `isAdult` in.
 */
export function resolveViewMode(stored: ViewMode | null, isAdult: boolean): ViewMode {
  return stored ?? (isAdult ? "FULL" : "BIG");
}

export const VIEW_MODES: { value: ViewMode; label: string; hint: string }[] = [
  { value: "BIG", label: "Big buttons", hint: "just my stuff" },
  { value: "FULL", label: "Full app", hint: "everything I can use" },
];

export const BUNSON_VOLUMES: { value: BunsonVolume; label: string }[] = [
  { value: "CHATTY", label: "Chatty" },
  { value: "CHEERS", label: "Just cheers" },
  { value: "OFF", label: "Off" },
];
