"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { syncThemeColor } from "@/components/theme-toggle";
import { LOOKS_TO_CHOOSE, type Worn } from "@/lib/looks";
import { LookSheet } from "@/components/look-sheet";

type LookState = {
  available: boolean;
  worn: Worn;
  shown: Worn;
  tryOn: (next: Worn) => void;
  putBack: () => void;
  openSheet: () => void;
  closeSheet: () => void;
  welcoming: boolean;
};

const Ctx = createContext<LookState>({
  available: false,
  worn: { look: "sticker", color: "ink" },
  shown: { look: "sticker", color: "ink" },
  tryOn: () => {},
  putBack: () => {},
  openSheet: () => {},
  closeSheet: () => {},
  welcoming: false,
});

export const useLook = () => useContext(Ctx);

/**
 * Phase 58: the app's root element, which carries the look. The server says what's worn, so
 * there's no flash and a shared tablet changes with the person; trying one on is client state on
 * top, so React and the page can't disagree and nothing's saved until Keep it.
 */
export function AppRoot({
  worn,
  welcome,
  view,
  volume,
  className,
  children,
}: {
  worn: Worn;
  welcome: boolean;
  view: string;
  volume: string;
  className: string;
  children: ReactNode;
}) {
  const [tried, setTried] = useState<Worn | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [welcomed, setWelcomed] = useState(false);
  const pathname = usePathname();
  const shown = tried ?? worn;

  const putBack = useCallback(() => setTried(null), []);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setWelcomed(true);
  }, []);

  // Once only, on Home: not over setup, a game or a form someone's in the middle of.
  const welcoming = welcome && LOOKS_TO_CHOOSE && !welcomed;
  const showSheet = sheetOpen || (welcoming && pathname === "/");

  useEffect(() => {
    syncThemeColor();
    return () => document.getElementById("theme-color-override")?.remove();
  }, [shown.look, shown.color]);

  const value = useMemo(
    () => ({ available: true, worn, shown, tryOn: setTried, putBack, openSheet, closeSheet, welcoming }),
    [worn, shown, putBack, openSheet, closeSheet, welcoming],
  );

  return (
    <Ctx.Provider value={value}>
      {/* data-view drives the `big:` variant (globals.css); data-bunson-volume gates Bunson's
          moments in pure CSS; data-app-root scopes the one-Bunson-per-screen rule. */}
      <div data-app-root data-view={view} data-bunson-volume={volume} data-look={shown.look} data-color={shown.color} className={className}>
        {children}
        {showSheet && <LookSheet />}
      </div>
    </Ctx.Provider>
  );
}
