/**
 * Phase 19.5: Bunson showing up at a moment (a greeting, an empty page, an oops page).
 * Server-renderable, no client JS — a static sprite plus a speech bubble.
 *
 * Volume gating is pure CSS (app/globals.css), keyed off the (app) layout's
 * `data-bunson-volume`: "chatty" moments need Chatty, "cheer" moments need Chatty or Just
 * cheers. When Bunson is hidden, the same words still show as plain text (the fallback
 * <p>), so turning him off never deletes a page's real content. Outside the (app) layout
 * (no volume attribute) he always shows.
 *
 * Only the sprites that exist today are used (sit and stand-up); new poses wait on art.
 */
import { mascotArt } from "@/lib/bunson-art";

const POSES = {
  // Alpha bounding boxes measured in components/bunson.tsx (136x136 canvases).
  idle: { src: mascotArt("bunson-idle"), top: 53, left: 48, width: 38, height: 43 },
  stand: { src: mascotArt("bunson-periscope"), top: 52, left: 48, width: 38, height: 44 },
} as const;

// Whole-number scale only: pixel art scaled by a fraction gets uneven pixels.
const SCALE = 2;

export function BunsonMoment({
  kind,
  pose = "idle",
  text,
  className = "",
}: {
  kind: "chatty" | "cheer";
  pose?: keyof typeof POSES;
  text: string;
  className?: string;
}) {
  const p = POSES[pose];
  return (
    <div className={className}>
      <div data-bunson-moment={kind} className="flex items-end gap-3">
        <span
          aria-hidden
          className="relative block shrink-0 overflow-hidden"
          style={{ width: p.width * SCALE, height: p.height * SCALE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size pixel sprite cropped by offset; next/image adds nothing here */}
          <img
            src={p.src}
            alt=""
            width={136 * SCALE}
            height={136 * SCALE}
            className="absolute max-w-none [image-rendering:pixelated]"
            style={{ left: -p.left * SCALE, top: -p.top * SCALE }}
          />
        </span>
        <p className="relative mb-6 max-w-xs rounded-2xl border-2 border-ink bg-card px-4 py-2 font-hand text-xl leading-tight text-card-foreground shadow-[3px_3px_0_rgb(31_41_51/0.12)] dark:border-white/25">
          {text}
          <span
            aria-hidden
            className="absolute -left-2 bottom-3 size-3 rotate-45 border-b-2 border-l-2 border-ink bg-card dark:border-white/25"
          />
        </p>
      </div>
      <p data-bunson-fallback={kind} className="text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
