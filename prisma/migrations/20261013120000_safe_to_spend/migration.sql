-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'ACCOUNTS_SET';
ALTER TYPE "JarEventKind" ADD VALUE 'CUSHION_SET';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'MONEY_LOW_BALANCE';

-- AlterTable
ALTER TABLE "fin_account" ADD COLUMN     "spending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "money_jar" ADD COLUMN     "cushionCents" INTEGER;

-- AlterTable
ALTER TABLE "money_jar_member" ADD COLUMN     "alertLowBalance" BOOLEAN NOT NULL DEFAULT true;
