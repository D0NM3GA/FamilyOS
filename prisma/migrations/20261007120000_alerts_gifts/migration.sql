-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'MONEY_BILL_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'MONEY_SYNC_BROKEN';
ALTER TYPE "NotificationKind" ADD VALUE 'MONEY_OVER_BUDGET';

-- AlterTable
ALTER TABLE "fin_transaction" ADD COLUMN     "giftById" TEXT,
ADD COLUMN     "giftCopiedFromId" TEXT,
ADD COLUMN     "giftHiddenFrom" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "giftRevealOn" DATE;

-- AlterTable
ALTER TABLE "money_jar_member" ADD COLUMN     "alertBills" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertOverBudget" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "alertSync" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "fin_alert_sent" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_alert_sent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_alert_sent_jarId_personId_key_key" ON "fin_alert_sent"("jarId", "personId", "key");

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_giftById_fkey" FOREIGN KEY ("giftById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_alert_sent" ADD CONSTRAINT "fin_alert_sent_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_alert_sent" ADD CONSTRAINT "fin_alert_sent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
