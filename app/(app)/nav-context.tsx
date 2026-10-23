"use client";

import { createContext, useContext, useState } from "react";
import type { AppDef } from "@/lib/apps";

type NavState = {
  personId: string;
  /** The apps this person can open, in the fixed order (lib/apps.ts). */
  apps: AppDef[];
  launcherOpen: boolean;
  setLauncherOpen: (open: boolean) => void;
};

const NavContext = createContext<NavState | null>(null);

/** Shared by the launcher (top bar), the rail and the phone bottom bar. */
export function NavProvider({ personId, apps, children }: { personId: string; apps: AppDef[]; children: React.ReactNode }) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  return <NavContext.Provider value={{ personId, apps, launcherOpen, setLauncherOpen }}>{children}</NavContext.Provider>;
}

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used inside NavProvider");
  return ctx;
}
