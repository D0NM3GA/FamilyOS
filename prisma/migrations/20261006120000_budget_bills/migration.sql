-- CreateEnum
CREATE TYPE "FinCategoryKind" AS ENUM ('SPEND', 'INCOME', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinCategorySource" AS ENUM ('AUTO', 'RULE', 'PERSON');

-- CreateEnum
CREATE TYPE "FinLinkSource" AS ENUM ('AUTO', 'PERSON');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('KEEP', 'CANCEL', 'HIDDEN');

-- AlterTable
ALTER TABLE "fin_transaction" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "categorySource" "FinCategorySource",
ADD COLUMN     "merchantKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "purchaseId" TEXT,
ADD COLUMN     "purchaseLinkedBy" "FinLinkSource";

-- CreateTable
CREATE TABLE "fin_category" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "kind" "FinCategoryKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "budgetCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rule" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_mark" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "RecurringStatus" NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_mark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_category_jarId_key_key" ON "fin_category"("jarId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "category_rule_jarId_key_key" ON "category_rule"("jarId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_mark_jarId_key_key" ON "recurring_mark"("jarId", "key");

-- CreateIndex
CREATE INDEX "fin_transaction_jarId_merchantKey_idx" ON "fin_transaction"("jarId", "merchantKey");

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fin_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_category" ADD CONSTRAINT "fin_category_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "fin_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_mark" ADD CONSTRAINT "recurring_mark_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

