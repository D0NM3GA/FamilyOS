-- Phase 45.4: the "Finish setting up" checklist. A Prisma list is never null, so the column
-- can't be either (like household.disabledApps).
-- AlterTable
ALTER TABLE "household" ADD COLUMN     "setupReviewed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "setupCardHidden" BOOLEAN NOT NULL DEFAULT false;
