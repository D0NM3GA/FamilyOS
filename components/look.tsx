"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  /** `returnTo` takes focus when it closes: by default whatever has it now. */
  openSheet: (returnTo?: HTMLElement | null) => void;
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
  const returnFocus = useRef<HTMLElement | null>(null);
  const openSheet = useCallback((returnTo?: HTMLElement | null) => {
    returnFocus.current = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setWelcomed(true);
    returnFocus.current?.focus();
    returnFocus.current = null;
  }, []);

  // Once only, on Home: not over setup, a game or a form someone's in the middle of.
  const welcoming = welcome && LOOKS_TO_CHOOSE && !welcomed;
  const showSheet = sheetOpen || (welcoming && pathname === "/");

  useEffect(() => {
    syncThemeColor();
  }, [shown.look, shown.color]);
  // Leaving the shell: the root is gone, so this falls back to the family's or the pinned mode's.
  useEffect(() => () => syncThemeColor(), []);

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
