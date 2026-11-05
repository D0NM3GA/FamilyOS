import { Avatar } from "./avatar";

export function AvatarStack({
  people,
  size = 24,
}: {
  people: { id: string; label: string; hasPhoto: boolean }[];
  size?: number;
}) {
  return (
    <div className="flex">
      {people.map((person, i) => (
        <div
          key={person.id}
          title={person.label}
          aria-label={person.label}
          // z-index as a CSS custom property, not an inline `zIndex`: an inline z-index beats
          // every stylesheet rule, so hover:z-* would never win.
          className="relative z-(--z) rounded-full ring-2 ring-card transition hover:z-[200] hover:-translate-y-0.5"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.35), "--z": people.length - i } as React.CSSProperties}
        >
          <Avatar personId={person.id} hasPhoto={person.hasPhoto} initial={person.label} size={size} />
        </div>
      ))}
    </div>
  );
}
