-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_DOSE';
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_MED_LOW';
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_SCHOOL';
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_DATE';
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_CAR';
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_RECALL';

-- AlterTable
ALTER TABLE "vehicle" ADD COLUMN     "recallsCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reminder_prefs" (
    "personId" TEXT NOT NULL,
    "off" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quietStart" INTEGER,
    "quietEnd" INTEGER,
    "teamsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestEmail" BOOLEAN NOT NULL DEFAULT false,
    "digestTeams" BOOLEAN NOT NULL DEFAULT false,
    "digestLastOn" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_prefs_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "reminder_sent" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_sent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_sent_sentAt_idx" ON "reminder_sent"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_sent_personId_key_key" ON "reminder_sent"("personId", "key");

-- AddForeignKey
ALTER TABLE "reminder_prefs" ADD CONSTRAINT "reminder_prefs_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

