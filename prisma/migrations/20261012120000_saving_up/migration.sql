-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'ROLLOVER_SET';
ALTER TYPE "JarEventKind" ADD VALUE 'GOAL_SET';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'MONEY_PRICE_UP';

-- AlterTable
ALTER TABLE "fin_category" ADD COLUMN     "goalCents" INTEGER,
ADD COLUMN     "goalMonth" TEXT,
ADD COLUMN     "rollover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rolloverFrom" TEXT;
