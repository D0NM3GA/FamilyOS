-- Phase 36: the apps a family turned off (Settings -> Apps). Empty means every app is on.
-- NOT NULL so the empty default always applies: background jobs filter with NOT (... @> ...),
-- which a NULL would silently fail.

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "disabledApps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
