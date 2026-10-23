-- CreateEnum
CREATE TYPE "BillCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE');

-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'BILL_ADDED';
ALTER TYPE "JarEventKind" ADD VALUE 'BILL_CHANGED';
ALTER TYPE "JarEventKind" ADD VALUE 'BILL_REMOVED';
ALTER TYPE "JarEventKind" ADD VALUE 'EXPORTED';

-- CreateTable
CREATE TABLE "manual_bill" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cadence" "BillCadence" NOT NULL,
    "nextDue" DATE NOT NULL,
    "matchKey" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_bill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manual_bill_jarId_idx" ON "manual_bill"("jarId");

-- AddForeignKey
ALTER TABLE "manual_bill" ADD CONSTRAINT "manual_bill_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_bill" ADD CONSTRAINT "manual_bill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

