-- Phase 40.4: checking Entra for who is assigned to the app (lib/entra-check.ts).
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SignInEventKind" ADD VALUE 'ENTRA_ACCESS_ENDED';
ALTER TYPE "SignInEventKind" ADD VALUE 'ENTRA_ACCESS_RESTORED';

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "entraAccessEndedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "entra_check" (
    "householdId" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "outcome" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entra_check_pkey" PRIMARY KEY ("householdId")
);

-- AddForeignKey
ALTER TABLE "entra_check" ADD CONSTRAINT "entra_check_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

