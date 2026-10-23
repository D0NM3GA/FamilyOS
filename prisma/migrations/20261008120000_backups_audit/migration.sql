-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('HOUSEHOLD_BACKUP', 'MONEY_BACKUP', 'HOUSEHOLD_RESTORE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'BACKUP_MADE';
ALTER TYPE "NotificationKind" ADD VALUE 'BACKUP_RESTORED';

-- CreateTable
CREATE TABLE "backup_event" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" "BackupKind" NOT NULL,
    "includesMoney" BOOLEAN NOT NULL DEFAULT false,
    "jarCount" INTEGER NOT NULL DEFAULT 0,
    "fileSha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "snapshotSha256" TEXT,
    "notifiedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_event_householdId_createdAt_idx" ON "backup_event"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "backup_event" ADD CONSTRAINT "backup_event_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_event" ADD CONSTRAINT "backup_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
