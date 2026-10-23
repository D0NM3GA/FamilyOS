-- Phase 35: Make it yours. Each family picks the top bar color, what the kids earn, the
-- mascot and the Home Screen icon; every default is the app as it looked before.

-- CreateEnum
CREATE TYPE "AppIcon" AS ENUM ('BUNNY', 'LETTER');

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "appIcon" "AppIcon" NOT NULL DEFAULT 'BUNNY',
ADD COLUMN     "mascotName" TEXT,
ADD COLUMN     "mascotOn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rewardMany" TEXT,
ADD COLUMN     "rewardOne" TEXT,
ADD COLUMN     "rewardStore" TEXT,
ADD COLUMN     "themeColor" TEXT;

