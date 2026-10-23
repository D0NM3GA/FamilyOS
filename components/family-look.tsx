"use client";

import { createContext, useContext } from "react";
import { wordmarkParts } from "@/lib/app-name";
import { DEFAULT_LOOK, type FamilyLook } from "@/lib/family-look";
import { capitalized, type RewardWords } from "@/lib/reward-words";

const FamilyLookContext = createContext<FamilyLook>(DEFAULT_LOOK);

/** Set once in app/(app)/layout.tsx from the household's Settings → Make it yours. */
export function FamilyLookProvider({ look, children }: { look: FamilyLook; children: React.ReactNode }) {
  return <FamilyLookContext.Provider value={look}>{children}</FamilyLookContext.Provider>;
}

export function useFamilyLook(): FamilyLook {
  return useContext(FamilyLookContext);
}

/** The family's name for the app, for client components' copy ("Sign out of FamilyOS?"). */
export function useAppName(): string {
  return useContext(FamilyLookContext).appName;
}

/** What the kids earn and the store's name ("5 stickers", "Sticker Store"). */
export function useRewardWords(): RewardWords {
  return useContext(FamilyLookContext).reward;
}

/**
 * The family's reward word inside server-rendered copy, which can't read this context
 * itself: `<RewardWord />` "stickers", `form="one"` "sticker", `form="store"` "Sticker
 * Store", `cap` for the start of a sentence. Server code that needs the words as a string
 * (titles, messages) uses getRewardWords instead.
 */
export function RewardWord({ form = "many", cap = false }: { form?: keyof RewardWords; cap?: boolean }) {
  const word = useContext(FamilyLookContext).reward[form];
  return <>{cap ? capitalized(word) : word}</>;
}

/** The name as a logo: a trailing "OS" takes the accent color (lib/app-name.ts wordmarkParts). */
export function Wordmark({ name, accentClassName }: { name: string; accentClassName: string }) {
  const { lead, accent } = wordmarkParts(name);
  return (
    <>
      {lead}
      {accent && <span className={accentClassName}>{accent}</span>}
    </>
  );
}
