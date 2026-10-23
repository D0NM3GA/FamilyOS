-- 2026-10-09: the nav rail has one fixed order for everyone (lib/apps.ts); per-person pins are gone.
ALTER TABLE "person" DROP COLUMN "navPins";
