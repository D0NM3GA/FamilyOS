"use client";

import { useState, useTransition } from "react";
import { addItem } from "./actions";

export type KidTile = { id: string; name: string; imageUrl: string | null; emoji: string };

/**
 * Phase 23: a kid's picture tiles. One tap puts it straight on the list, tagged for them,
 * and a grown-up can say "not this time". The tile hides at once and taps are ignored while
 * an add is on its way, so a double tap can't add two. Hidden tiles only stay hidden while
 * the server still leaves them out, so a vetoed pick comes back as a tile.
 */
export function KidTiles({ tiles }: { tiles: KidTile[] }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = tiles.filter((t) => !added.has(t.id));
  if (shown.length === 0 && !last) return null;

  function tap(t: KidTile) {
    if (pending) return;
    setAdded((s) => new Set(s).add(t.id));
    setLast(t.name);
    startTransition(async () => {
      try {
        await addItem({ productId: t.id });
      } catch {
        setAdded((s) => {
          const next = new Set(s);
          next.delete(t.id);
          return next;
        });
        setLast(null);
      }
    });
  }

  return (
    <section aria-labelledby="kid-tiles" className="mt-4 rounded-3xl border-2 border-ink bg-card p-4 dark:border-white/20">
      <h2 id="kid-tiles" className="font-hand text-2xl">
        Tap what you want!
      </h2>
      {last && (
        <p role="status" className="mt-1 text-sm font-bold">
          On the list: {last}. Added for you!
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => tap(t)}
                className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-ink/20 bg-background p-2 text-center text-sm font-bold transition active:scale-95 dark:border-white/20"
              >
                {t.imageUrl ? (
                  // Open Food Facts image; absolute https URL.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.imageUrl} alt="" width={48} height={48} loading="lazy" decoding="async" className="h-12 w-12 object-contain" />
                ) : (
                  <span className="text-4xl" aria-hidden>
                    {t.emoji}
                  </span>
                )}
                <span className="line-clamp-2">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
