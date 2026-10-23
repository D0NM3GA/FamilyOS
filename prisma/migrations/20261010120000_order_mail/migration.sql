-- CreateEnum
CREATE TYPE "MailRetailer" AS ENUM ('AMAZON', 'APPLE', 'PUBLIX');

-- CreateTable
CREATE TABLE "mail_order_scan" (
    "personId" TEXT NOT NULL,
    "jarId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cursor" TIMESTAMP(3),
    "lastScanAt" TIMESTAMP(3),
    "lastFound" INTEGER NOT NULL DEFAULT 0,
    "lastSkipped" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "retryAfterUntil" TIMESTAMP(3),

    CONSTRAINT "mail_order_scan_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "mail_order" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "personId" TEXT,
    "retailer" "MailRetailer" NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderedOn" DATE NOT NULL,
    "totalCents" INTEGER,
    "label" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "sourceHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchedTxnId" TEXT,
    "matchedBy" "FinLinkSource",
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_order_matchedTxnId_idx" ON "mail_order"("matchedTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "mail_order_jarId_retailer_orderNumber_key" ON "mail_order"("jarId", "retailer", "orderNumber");

-- AddForeignKey
ALTER TABLE "mail_order_scan" ADD CONSTRAINT "mail_order_scan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_order_scan" ADD CONSTRAINT "mail_order_scan_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_order" ADD CONSTRAINT "mail_order_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_order" ADD CONSTRAINT "mail_order_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_order" ADD CONSTRAINT "mail_order_matchedTxnId_fkey" FOREIGN KEY ("matchedTxnId") REFERENCES "fin_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
