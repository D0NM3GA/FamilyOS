-- Phase 52: the household's statement date order, import records for undo, remembered layouts.
-- CreateEnum
CREATE TYPE "StatementDateOrder" AS ENUM ('AUTO', 'MONTH_FIRST', 'DAY_FIRST');

-- AlterTable
ALTER TABLE "fin_account" ADD COLUMN     "importLayouts" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "fin_transaction" ADD COLUMN     "importId" TEXT;

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "statementDateOrder" "StatementDateOrder" NOT NULL DEFAULT 'AUTO';

-- CreateTable
CREATE TABLE "fin_import" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "byPersonId" TEXT,
    "format" TEXT NOT NULL,
    "added" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_import_jarId_createdAt_idx" ON "fin_import"("jarId", "createdAt");

-- AddForeignKey
ALTER TABLE "fin_import" ADD CONSTRAINT "fin_import_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_import" ADD CONSTRAINT "fin_import_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_import" ADD CONSTRAINT "fin_import_byPersonId_fkey" FOREIGN KEY ("byPersonId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "fin_import"("id") ON DELETE SET NULL ON UPDATE CASCADE;

