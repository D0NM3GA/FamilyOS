"use client";

/** Phase 47: the pet screen's big care buttons and toy icons. */

export function BigButton({
  id,
  emoji,
  label,
  onClick,
  disabled,
  pressed,
}: {
  id?: string;
  emoji: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-ink bg-card text-sm font-extrabold shadow-[0_3px_0_#1f2933] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 aria-pressed:bg-sun aria-pressed:text-ink dark:border-white/20"
    >
      <span aria-hidden="true" className="text-3xl">
        {emoji}
      </span>
      {label}
    </button>
  );
}

const TOY_EMOJI: Record<string, string> = { ball: "⚽", plush: "🧸", bubbles: "🫧", drum: "🥁", kite: "🪁" };

export function ToyIcon({ id, wiggle = false }: { id: string; wiggle?: boolean }) {
  return (
    <span aria-hidden="true" className={wiggle ? "inline-block animate-[pet-wiggle_0.4s_ease-in-out_infinite]" : "inline-block"}>
      {TOY_EMOJI[id] ?? "🎁"}
    </span>
  );
}
