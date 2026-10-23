import Image from "next/image";

export function Avatar({
  personId,
  hasPhoto,
  initial,
  size,
  className = "",
  colorClass = "bg-stone-700 text-white",
  shapeClass = "rounded-full",
  color,
}: {
  personId: string;
  hasPhoto: boolean;
  initial: string;
  size: number;
  className?: string;
  colorClass?: string;
  shapeClass?: string;
  /** Phase 19 person color (lib/person-color.ts). Overrides colorClass's colors when set. */
  color?: { bg: string; fg: string };
}) {
  if (hasPhoto) {
    return (
      <Image
        src={`/api/people/${personId}/photo`}
        alt=""
        width={size}
        height={size}
        unoptimized
        // Explicit inline size, not just width/height attrs: Tailwind's preflight sets
        // `img { height: auto }`, which lets a non-square source photo (Graph's fallback
        // /me/photo/$value endpoint doesn't guarantee square, unlike /me/photos/240x240)
        // stretch into an ellipse under rounded-full.
        style={{ width: size, height: size }}
        className={`shrink-0 object-cover ${shapeClass} ${className}`}
      />
    );
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        fontSize: Math.max(Math.round(size * 0.4), 10),
        ...(color ? { backgroundColor: color.bg, color: color.fg } : {}),
      }}
      className={`flex shrink-0 items-center justify-center font-semibold ${shapeClass} ${colorClass} ${className}`}
    >
      {initial.slice(0, 1).toUpperCase()}
    </span>
  );
}
