"use client";

import { createContext, useContext } from "react";

const HouseholdZoneContext = createContext<string | undefined>(undefined);

/**
 * Phase 49: the household's zone for client components, set once by the app layout. The server
 * already keeps the household's time; a client component formats with this zone so the browser
 * shows the same day and time as the server's render, wherever the device is.
 */
export function HouseholdZoneProvider({ zone, children }: { zone: string; children: React.ReactNode }) {
  return <HouseholdZoneContext.Provider value={zone}>{children}</HouseholdZoneContext.Provider>;
}

/** The household's zone, or undefined outside the app layout (the device's then). */
export function useHouseholdZone(): string | undefined {
  return useContext(HouseholdZoneContext);
}
