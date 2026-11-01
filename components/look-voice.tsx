"use client";

import { usePathname } from "next/navigation";
import { useLook } from "@/components/look";
import { APPS } from "@/lib/apps";
import { lookOf, VOICE_KICKERS, type VoiceKicker } from "@/lib/looks";

const isKicker = (id: string): id is VoiceKicker => (VOICE_KICKERS as readonly string[]).includes(id);

/**
 * Phase 58: a line in the worn look's voice. Decoration beside the app's plain words, so a screen
 * reader skips it. Sticker Book has none. Follows what's being tried on.
 */
export function LookKicker({ id, className = "" }: { id: VoiceKicker; className?: string }) {
  const { shown } = useLook();
  const line = lookOf(shown.look).voice?.kickers[id];
  if (!line) return null;
  return (
    <span aria-hidden="true" className={`ui-kicker ${className}`}>
      {line}
    </span>
  );
}

/** Above a page's title, on an app's own page only: a page deeper in has its own title's job to do. */
export function PageKicker() {
  const pathname = usePathname();
  const app = APPS.find((a) => a.href === pathname);
  if (!app || !isKicker(app.id)) return null;
  return <LookKicker id={app.id} className="w-full" />;
}

/** Beside "Nothing due today." */
export function LookQuiet() {
  const { shown } = useLook();
  const line = lookOf(shown.look).voice?.quiet;
  if (!line) return null;
  return (
    <span aria-hidden="true" className="ui-quiet">
      {" "}
      {line}
    </span>
  );
}
