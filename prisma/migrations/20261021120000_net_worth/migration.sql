-- Phase 34: net worth. Daily account balances (from the next sync on; no backfill) and
-- things owned or owed that the bank feed can't see, valued by hand.

-- CreateEnum
CREATE TYPE "FinHoldingKind" AS ENUM ('HOME', 'VEHICLE', 'OTHER_ASSET', 'LOAN');

-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'HOLDING_ADDED';
ALTER TYPE "JarEventKind" ADD VALUE 'HOLDING_VALUED';
ALTER TYPE "JarEventKind" ADD VALUE 'HOLDING_REMOVED';

-- CreateTable
CREATE TABLE "fin_balance_day" (
    "accountId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "balanceCents" INTEGER NOT NULL,

    CONSTRAINT "fin_balance_day_pkey" PRIMARY KEY ("accountId","day")
);

-- CreateTable
CREATE TABLE "fin_holding" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinHoldingKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_holding_value" (
    "holdingId" TEXT NOT NULL,
    "valuedOn" DATE NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_holding_value_pkey" PRIMARY KEY ("holdingId","valuedOn")
);

-- CreateIndex
CREATE INDEX "fin_holding_jarId_idx" ON "fin_holding"("jarId");

-- AddForeignKey
ALTER TABLE "fin_balance_day" ADD CONSTRAINT "fin_balance_day_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_holding" ADD CONSTRAINT "fin_holding_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_holding_value" ADD CONSTRAINT "fin_holding_value_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "fin_holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
