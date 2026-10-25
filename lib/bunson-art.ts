/**
 * Where Bunson's sprites live. The files are cached for a day and served stale for a week after
 * (next.config.ts), so new art must change the address: bump MASCOT_ART_VERSION whenever any
 * file in public/mascot changes, or browsers keep the old look, even mixing old and new frames.
 */
export const MASCOT_ART_VERSION = 4;

/** `name` is the file's base name, e.g. "bunson-idle". */
export function mascotArt(name: string): string {
  return `/mascot/${name}.png?v=${MASCOT_ART_VERSION}`;
}
