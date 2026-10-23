import type { AppDef } from "@/lib/apps";

/** An app's emoji on its tinted sticker tile, the launcher's look, for Settings → Apps and the "turned off" page. */
export function AppTile({ app, size = "md", dim = false }: { app: AppDef; size?: "md" | "lg"; dim?: boolean }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: app.tint }}
      className={`grid shrink-0 place-items-center rounded-2xl border-2 border-ink shadow-[2px_2px_0_rgb(31_41_51/0.13)] transition ${
        size === "lg" ? "size-16 text-4xl" : "size-12 text-2xl"
      } ${dim ? "opacity-45 grayscale" : ""}`}
    >
      {app.emoji}
    </span>
  );
}
